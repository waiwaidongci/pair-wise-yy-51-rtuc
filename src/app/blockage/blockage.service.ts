import { Injectable } from '@angular/core'
import { BehaviorSubject, Subject } from 'rxjs'
import { AffectedBill, BillChecks, BillSeed, BlockageOrder, BlockageSection } from './models'
import { BILLS, ROLES, STATIONS } from './blockage-data'

const KEY = 'rail-blockage-orders-v1'

function matchesBlockage(seg: { from: string; to: string }, s: BlockageSection): boolean {
  // 共用区段：正反方向都算
  return (seg.from === s.from && seg.to === s.to) || (seg.from === s.to && seg.to === s.from)
}

function today(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

@Injectable({ providedIn: 'root' })
export class BlockageService {
  readonly seeds = BILLS
  private ordersSubject = new BehaviorSubject<BlockageOrder[]>(this.load())
  readonly orders$ = this.ordersSubject.asObservable()
  readonly saving$ = new BehaviorSubject<boolean>(false)
  readonly toast$ = new Subject<{ text: string; kind: 'info' | 'success' | 'warn' }>()

  simulateFailure = false // 模拟写入失败，验证“保留结论、按令号重试”
  dispatcherName = '值班调度员'

  constructor() {
    // 另一终端（另一标签页）保存后，本终端重开/刷新即可看到当前进度
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) {
        const list = this.readServer()
        this.ordersSubject.next(list)
        const latest = list[list.length - 1]
        if (latest) this.toast$.next({ text: `另一终端已保存处置令（当前 v${latest.version}），进度已同步`, kind: 'info' })
      }
    })
  }

  // ---------- 持久化 ----------

  private load(): BlockageOrder[] {
    const list = this.readServer()
    list.forEach((o) => o.bills.forEach((b) => this.revalidateOnLoad(b, o)))
    return list
  }

  private readServer(): BlockageOrder[] {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '[]')
    } catch {
      return []
    }
  }

  private currentOrder(id: string): BlockageOrder | undefined {
    return this.ordersSubject.value.find((o) => o.id === id)
  }

  private seedOf(billId: string): BillSeed {
    return BILLS.find((b) => b.id === billId)!
  }

  // ---------- 核对规则 ----------

  stationQualified(name: string, classCode: string): boolean {
    const s = STATIONS.find((x) => x.name === name)
    return !!s && s.qualified.includes(classCode)
  }

  altValid(seed: BillSeed, altId: string | null, section: BlockageSection): boolean {
    if (!altId) return false
    const alt = seed.altPaths.find((a) => a.id === altId)
    if (!alt || alt.segments.length === 0) return false
    if (alt.segments[0].from !== seed.origin) return false
    if (alt.segments[alt.segments.length - 1].to !== seed.destination) return false
    return !alt.segments.some((seg) => matchesBlockage(seg, section))
  }

  computeChecks(bill: AffectedBill, section: BlockageSection): BillChecks {
    const seed = this.seedOf(bill.billId)
    const selected = bill.checks.altPath.selectedId
    const alt = seed.altPaths.find((a) => a.id === selected)
    let altReason: string
    if (seed.altPaths.length === 0) altReason = '无可用替代路径，待处理'
    else if (!selected) altReason = '未选择替代路径'
    else if (!alt) altReason = '替代路径不存在'
    else if (alt.segments[0].from !== seed.origin) altReason = '替代路径未从发站引出'
    else if (alt.segments[alt.segments.length - 1].to !== seed.destination) altReason = '替代路径未到达到站'
    else if (alt.segments.some((seg) => matchesBlockage(seg, section))) altReason = '替代路径仍经封锁区段，不可用'
    else altReason = '替代路径可行，不经封锁区段'

    const results = seed.needStations.map((name) => ({ name, qualified: this.stationQualified(name, seed.classCode) }))
    const badStations = results.filter((r) => !r.qualified).map((r) => r.name)
    const stationReason = badStations.length ? `接卸站资质不足：${badStations.join('、')}` : '接卸站均具备该品类办理资质'

    const permitExpired = new Date(bill.frozenPermit.validUntil + 'T23:59:59') < today()
    const permitValid = bill.frozenPermit.status === '有效' && !permitExpired
    const permitReason =
      bill.frozenPermit.status === '失效' ? '许可已失效，退回重算' : permitExpired ? '许可有效期已过，退回重算' : '许可有效且在有效期内'

    const missingRoles = ROLES.filter((r) => !bill.checks.countersign.signers.some((s) => s.role === r))
    const csReason = missingRoles.length ? `待会签：${missingRoles.join('、')}` : '安全、运营、应急会签齐全'

    return {
      altPath: { valid: altReason === '替代路径可行，不经封锁区段', reason: altReason, selectedId: selected },
      station: { valid: badStations.length === 0, reason: stationReason, results },
      permit: { valid: permitValid, reason: permitReason },
      countersign: { valid: missingRoles.length === 0, reason: csReason, signers: [...bill.checks.countersign.signers] },
    }
  }

  allPass(bill: AffectedBill, section: BlockageSection): boolean {
    const c = this.computeChecks(bill, section)
    return c.altPath.valid && c.station.valid && c.permit.valid && c.countersign.valid
  }

  // 重开页面后：许可失效等变化要让该单退回重算
  private revalidateOnLoad(bill: AffectedBill, order: BlockageOrder): void {
    const wasReleased = bill.status === 'released'
    const expired = bill.frozenPermit.status === '失效' || new Date(bill.frozenPermit.validUntil + 'T23:59:59') < today()
    if (expired) bill.frozenPermit.status = '失效'
    bill.checks = this.computeChecks(bill, order.section)
    if (wasReleased && !this.allPass(bill, order.section)) {
      bill.status = 'pending'
      bill.release = null
      bill.rollbackNote = expired ? '许可有效期已过，退回重算' : '核对条件变化，退回重算'
    }
  }

  // ---------- 登记封锁、冻结 ----------

  createOrder(input: { line: string; from: string; to: string; reason: string; startedAt: string; restoreAt: string }): BlockageOrder {
    const seq = this.ordersSubject.value.reduce((m, o) => Math.max(m, o.seq), 0) + 1
    const id = `封令〔2026〕${String(seq).padStart(3, '0')} 号`
    const section: BlockageSection = { line: input.line || '临时封锁区段', from: input.from, to: input.to }
    const affected = BILLS.filter((b) => b.path.some((seg) => matchesBlockage(seg, section)))

    const bills: AffectedBill[] = affected.map((seed) => {
      const bill: AffectedBill = {
        billId: seed.id,
        frozenPath: { frozenAt: Date.now(), segments: seed.path.map((s) => ({ ...s })) },
        frozenPermit: { no: seed.permitNo, validUntil: seed.permitValidUntil, status: '有效', frozenAt: Date.now() },
        checks: {
          altPath: { valid: false, reason: '', selectedId: null },
          station: { valid: false, reason: '', results: [] },
          permit: { valid: false, reason: '' },
          countersign: { valid: false, reason: '', signers: [] },
        },
        status: 'pending',
        release: null,
        rollbackNote: null,
        dirty: true,
      }
      // 自动预选第一条可行替代路径
      const first = seed.altPaths.find((a) => this.altValid(seed, a.id, section))
      if (first) bill.checks.altPath.selectedId = first.id
      bill.checks = this.computeChecks(bill, section)
      return bill
    })

    const order: BlockageOrder = {
      id,
      seq,
      section,
      reason: input.reason,
      startedAt: input.startedAt,
      restoreAt: input.restoreAt,
      dispatcher: this.dispatcherName,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      updatedBy: this.dispatcherName,
      version: 1,
      bills,
    }
    const list = [...this.ordersSubject.value, order]
    localStorage.setItem(KEY, JSON.stringify(list))
    this.ordersSubject.next(list)
    return order
  }

  // ---------- 逐单核对（各单独立，互不拖累） ----------

  private mutate(orderId: string, billId: string, fn: (order: BlockageOrder, bill: AffectedBill) => void): void {
    const list = this.ordersSubject.value.map((o) => {
      if (o.id !== orderId) return o
      const order = structuredClone(o)
      const bill = order.bills.find((b) => b.billId === billId)!
      fn(order, bill)
      bill.dirty = true
      bill.touched = true
      return order
    })
    this.ordersSubject.next(list)
  }

  sign(orderId: string, billId: string, role: string): void {
    this.mutate(orderId, billId, (order, bill) => {
      if (bill.status === 'released') return
      if (bill.checks.countersign.signers.some((s) => s.role === role)) return
      bill.checks.countersign.signers.push({ role, name: this.dispatcherName, at: Date.now() })
      bill.checks = this.computeChecks(bill, order.section)
      bill.rollbackNote = null
    })
  }

  chooseAlt(orderId: string, billId: string, altId: string): void {
    this.mutate(orderId, billId, (order, bill) => {
      const changed = bill.checks.altPath.selectedId !== altId
      const wasReleased = bill.status === 'released'
      bill.checks.altPath.selectedId = altId
      // 会签针对替代路径：路径改动后原会签失效，需重新会签
      bill.checks.countersign.signers = []
      bill.checks = this.computeChecks(bill, order.section)
      if (wasReleased) {
        // 替代路径改动：已放行单退回重算
        bill.status = 'pending'
        bill.release = null
        bill.rollbackNote = '替代路径已改动，原放行退回重算；会签已失效，需重新会签'
      } else if (changed) {
        bill.rollbackNote = '替代路径已改动：原会签失效，退回重算'
      }
    })
  }

  setPermitStatus(orderId: string, billId: string, status: '有效' | '失效'): void {
    this.mutate(orderId, billId, (order, bill) => {
      bill.frozenPermit.status = status
      if (status === '失效' && bill.status === 'released') {
        bill.status = 'pending'
        bill.release = null
        bill.rollbackNote = '许可已失效，退回重算'
      } else {
        bill.rollbackNote = status === '失效' ? '许可已失效，退回重算' : '许可已重新核验'
      }
      bill.checks = this.computeChecks(bill, order.section)
    })
  }

  release(orderId: string, billId: string): void {
    this.mutate(orderId, billId, (order, bill) => {
      bill.checks = this.computeChecks(bill, order.section)
      if (this.allPass(bill, order.section)) {
        bill.status = 'released'
        bill.release = { at: Date.now(), by: this.dispatcherName }
        bill.rollbackNote = null
      }
    })
  }

  releaseAll(orderId: string): void {
    const order = this.currentOrder(orderId)
    if (!order) return
    order.bills.forEach((b) => {
      if (b.status === 'pending' && this.allPass(b, order.section)) this.release(orderId, b.billId)
    })
  }

  // ---------- 协同保存：乐观锁 + 合并 + 按令号重试 ----------

  async save(order: BlockageOrder, isRetry = false): Promise<void> {
    this.saving$.next(true)
    try {
      if (this.simulateFailure && !isRetry) {
        await new Promise((r) => setTimeout(r, 700))
        throw new Error('WRITE_FAILED')
      }
      const server = this.readServer()
      const srv = server.find((o) => o.id === order.id)
      let toSave: BlockageOrder
      let merged = false

      if (srv && srv.version > order.version) {
        // 后到者看到当前进度：以服务器最新版本为底；本终端确实改动过的单（touched）保留其结论，其余以服务器为准
        const local = this.currentOrder(order.id)!
        const bills = srv.bills.map((sb) => {
          const lb = local.bills.find((b) => b.billId === sb.billId)
          return lb && lb.touched ? { ...lb, dirty: false, touched: false } : { ...sb, dirty: false, touched: false }
        })
        toSave = { ...srv, bills, version: srv.version + 1, updatedAt: Date.now(), updatedBy: this.dispatcherName }
        merged = true
      } else {
        toSave = {
          ...order,
          version: (srv?.version ?? order.version) + 1,
          updatedAt: Date.now(),
          updatedBy: this.dispatcherName,
          bills: order.bills.map((b) => ({ ...b, dirty: false, touched: false })),
        }
      }

      const list = server.map((o) => (o.id === toSave.id ? toSave : o))
      if (!list.some((o) => o.id === toSave.id)) list.push(toSave)
      localStorage.setItem(KEY, JSON.stringify(list))
      this.ordersSubject.next(list)

      if (merged) {
        const released = toSave.bills.filter((b) => b.status === 'released').length
        this.toast$.next({
          text: `检测到 ${srv!.updatedBy} 已保存 v${srv!.version}，已合并其当前进度（${released} 单已放行）；按令号 ${toSave.id} 重试保存成功`,
          kind: 'success',
        })
      } else {
        this.toast$.next({ text: `处置令 ${toSave.id} 已保存（v${toSave.version}），重开页面可继续处理`, kind: 'success' })
      }
    } catch {
      // 写入失败：各单结论仍保留在内存中，按令号自动重试
      this.toast$.next({ text: '写入失败：各单已有结论已保留，正在按令号重试…', kind: 'warn' })
      await new Promise((r) => setTimeout(r, 900))
      return this.save(order, true)
    } finally {
      this.saving$.next(false)
    }
  }

  // 模拟另一名调度员在另一终端先保存
  simulateOtherDispatcher(orderId: string): void {
    const order = this.currentOrder(orderId)
    if (!order) return
    const other = '调度员 周敏'
    const server = this.readServer()
    const base = server.find((o) => o.id === orderId) ?? order
    const copy: BlockageOrder = structuredClone(base)
    copy.version = base.version + 1
    copy.updatedBy = other
    copy.updatedAt = Date.now()
    const target = copy.bills.find((b) => b.status === 'pending' && this.allPass(b, copy.section))
    if (target) {
      target.status = 'released'
      target.release = { at: Date.now(), by: other }
      target.rollbackNote = null
    }
    const list = server.map((o) => (o.id === orderId ? copy : o))
    if (!list.some((o) => o.id === orderId)) list.push(copy)
    localStorage.setItem(KEY, JSON.stringify(list))
    this.toast$.next({ text: `${other} 刚刚保存了 v${copy.version}（${target ? '已放行 1 单' : '无新放行'}），本终端后到保存将合并其进度`, kind: 'info' })
    setTimeout(() => this.save(order), 600)
  }
}
