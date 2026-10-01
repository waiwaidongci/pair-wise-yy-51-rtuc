import { inject, Injectable } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { BehaviorSubject, firstValueFrom } from 'rxjs'
import type { RoutePackage } from '../types'
import {
  type AltOption,
  type BlockItem,
  type BlockadeOrder,
  type BlockadeView,
  type SegmentOption,
  type SessionState,
  fmt,
} from './types'

const SERVER_KEY = 'fx.server.v1'
const SESSION_KEY = 'fx.sessions.v1'
const SEQ_KEY = 'fx.seq.v1'
const DISPATCHERS = ['值班员 张峰', '调度员 李澜', '调度员 王澈', '调度员 赵航']

interface StoredSessions {
  ids: string[]
  names: Record<string, string>
  activeId: string
  failNext: Record<string, boolean>
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** 按封锁区段配置的替代径路方案（演练数据） */
const ALT_BANK: Record<string, AltOption[]> = {
  'S-203': [
    { id: 'A203-1', label: '天平线绕行（经陇县）', pathDetail: '天水 → 陇县 → 千阳 → 宝鸡西', station: '宝鸡西（危货 2 类/3 类接卸）', stationQualified: true, deltaKm: 38, note: '增加 38 km，避开西峡水源保护区与长隧道' },
    { id: 'A203-2', label: '天宝大绕行（经凤县）', pathDetail: '天水 → 凤县 → 黄牛铺 → 宝鸡西', station: '黄牛铺临时停留点（无危货接卸资质）', stationQualified: false, deltaKm: 116, note: '接卸站不具备第 3 类易燃液体资质，不予采用' },
  ],
  'S-207': [
    { id: 'A207-1', label: '京九通道分流', pathDetail: '郑州北 → 开封 → 商丘北 → 虞城县', station: '商丘北（危货接卸资质齐全）', stationQualified: true, deltaKm: 24, note: '增加 24 km，绕开郑州北至商丘人口密集段' },
    { id: 'A207-2', label: '新石线临时折角', pathDetail: '郑州北 → 新乡 → 兖州 → 商丘', station: '兖州站（第 8 类接卸资质过期待复审）', stationQualified: false, deltaKm: 172, note: '接卸站资质复审中，不能作为接卸点' },
  ],
  'S-304': [
    { id: 'A304-1', label: '侯月通道绕行', pathDetail: '三门峡西 → 侯马 → 月山 → 洛阳东', station: '洛阳东（全类别危货接卸）', stationQualified: true, deltaKm: 52, note: '增加 52 km，避开跨河桥限速点' },
  ],
}

const DEFAULT_ALTS: AltOption[] = [
  { id: 'A-DEF-1', label: '相邻干线分流方案', pathDetail: '经相邻干线分流，按调度日班计划交接', station: '前方技术站（危货接卸资质核验通过）', stationQualified: true, deltaKm: 30, note: '标准绕行方案' },
]

/**
 * 封锁处置令服务。
 * - “服务端”以 localStorage 模拟，保存走版本号 CAS：后到者收到 409 并按令号重订。
 * - 每个调度席位保留各自草稿，写入失败只保留/重试本席结论，不影响已放行单。
 */
@Injectable({ providedIn: 'root' })
export class BlockadeService {
  private readonly http = inject(HttpClient)
  private packages: RoutePackage[] | null = null

  private server$ = new BehaviorSubject<BlockadeOrder | null>(this.readServer())
  private sessions$ = new BehaviorSubject<SessionState[]>(this.readSessions())
  private activeId$ = new BehaviorSubject<string>('A')
  private segments$ = new BehaviorSubject<SegmentOption[]>([])
  private loadingSegments$ = new BehaviorSubject<boolean>(false)

  readonly view$ = new BehaviorSubject<BlockadeView>(this.snapshot())

  constructor() {
    const stored = this.readSessionMeta()
    this.activeId$.next(stored.activeId || 'A')
    window.addEventListener('storage', (e) => {
      if (e.key === SERVER_KEY) {
        this.server$.next(this.readServer())
        // 其他标签页写入：本席若未改动则直接跟随最新进度；改动过则保留结论并标注基线过期
        for (const s of this.sessions$.value) {
          if (!s.draft) continue
          const latest = this.server$.value
          const dirtyCount = Object.keys(s.dirty).length
          if (latest) {
            if (dirtyCount === 0) {
              s.draft = clone(latest)
              s.baseVersion = latest.version
            } else if (s.baseVersion < latest.version) {
              s.stale = `其他调度员已保存令号 ${latest.id}（v${latest.version}），请保存以合并您的改动`
            }
          }
        }
      }
      if (e.key === SESSION_KEY) {
        // 席位配置（新增席位/演练开关）跨标签同步
        const meta = this.readSessionMeta()
        const drafts = new Map(this.sessions$.value.map((s) => [s.id, s]))
        const next = meta.ids.map((id) => drafts.get(id) ?? this.freshSession(id, meta.names[id] || id))
        this.sessions$.next(next)
        if (!meta.ids.includes(this.activeId$.value)) this.activeId$.next(meta.activeId)
      }
      this.persistSessions()
      this.emit()
    })
  }

  // ---------- 初始化 / 区段目录 ----------

  async ensurePackages(): Promise<void> {
    if (this.packages) return
    this.loadingSegments$.next(true)
    this.emit()
    try {
      const res = await firstValueFrom(this.http.get<{ items: RoutePackage[] }>('route-data.json'))
      this.packages = res.items
    } catch {
      try {
        const res = await fetch('route-data.json')
        this.packages = (await res.json()).items as RoutePackage[]
      } catch {
        this.packages = []
      }
    }
    this.segments$.next(this.buildSegmentOptions(this.packages))
    this.loadingSegments$.next(false)
    this.emit()
  }

  private buildSegmentOptions(pkgs: RoutePackage[]): SegmentOption[] {
    const seen = new Set<string>()
    const out: SegmentOption[] = []
    for (const p of pkgs) {
      for (const seg of p.segments) {
        if (seen.has(seg.id)) continue
        seen.add(seg.id)
        out.push({ id: seg.id, name: seg.name, from: seg.from, to: seg.to })
      }
    }
    return out
  }

  // ---------- 席位 ----------

  active(): SessionState {
    return this.sessions$.value.find((s) => s.id === this.activeId$.value) ?? this.sessions$.value[0]
  }

  switchSeat(id: string) {
    const meta = this.readSessionMeta()
    meta.activeId = id
    this.writeSessionMeta(meta)
    this.activeId$.next(id)
    this.emit()
  }

  addSeat() {
    const meta = this.readSessionMeta()
    const idx = meta.ids.length
    const id = String.fromCharCode(65 + idx) // A B C D
    if (meta.ids.includes(id) || idx >= DISPATCHERS.length) return
    meta.ids.push(id)
    meta.names[id] = DISPATCHERS[idx]
    this.writeSessionMeta(meta)
    const sessions = [...this.sessions$.value, this.freshSession(id, DISPATCHERS[idx])]
    this.sessions$.next(sessions)
    this.activeId$.next(id)
    this.persistSessions()
    this.emit()
  }

  toggleFailNext(id: string) {
    const meta = this.readSessionMeta()
    meta.failNext[id] = !meta.failNext[id]
    this.writeSessionMeta(meta)
    this.mutateSession(id, (s) => { s.failNext = !!meta.failNext[id] })
  }

  private freshSession(id: string, name: string): SessionState {
    return {
      id, name, draft: clone(this.server$.value),
      baseVersion: this.server$.value?.version ?? 0,
      busy: false, failNext: false, error: '', conflict: '', stale: '', dirty: {},
    }
  }

  // ---------- 登记封锁区段：自动列出受影响运输单并冻结 ----------

  register(segmentId: string, reason: string): BlockadeOrder {
    const seg = this.segments$.value.find((x) => x.id === segmentId)
    if (!seg) throw new Error('请选择封锁区段')
    const now = Date.now()
    const seq = this.nextSeq()
    const d = new Date(now)
    const id = `FX-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(seq).padStart(3, '0')}`
    const pkgs = this.packages ?? []
    const items: BlockItem[] = pkgs
      .filter((p) => p.segments.some((sg) => sg.id === segmentId))
      .map((p) => this.buildItem(p, [segmentId], now))

    const order: BlockadeOrder = {
      id,
      sectionSegmentId: segmentId,
      sectionName: seg.name,
      rangeText: `${seg.from} 至 ${seg.to}（${segmentId}）`,
      reason: reason || '线路临时封锁',
      startedAt: now,
      createdAt: now,
      items,
      version: 1,
      savedAt: now,
    }
    this.server$.next(order)
    this.writeServer(order)
    // 所有席位接到同一令
    this.sessions$.next(this.sessions$.value.map((s) => ({
      ...this.freshSession(s.id, s.name),
      failNext: s.failNext,
    })))
    this.persistSessions()
    this.emit()
    return order
  }

  private buildItem(p: RoutePackage, hitIds: string[], now: number): BlockItem {
    const hitSegs = p.segments.filter((s) => hitIds.includes(s.id))
    const alternatives = this.alternativesFor(hitIds)
    return {
      routeId: p.id,
      cargo: p.cargo,
      hazardClass: p.hazardClass,
      trainCode: p.trainCode,
      origin: p.origin,
      destination: p.destination,
      hitSegmentIds: hitIds,
      hitNames: hitSegs.map((s) => s.name),
      frozen: {
        path: p.segments.map((s) => ({ id: s.id, name: s.name })),
        permission: p.permission,
        permitNo: p.permit,
        frozenAt: now,
      },
      permitValid: p.permission === '有效',
      alternatives,
      alternativeId: '',
      routeChecked: false,
      stationQualified: null,
      countersignDone: false,
      countersignBy: '',
      status: '待处理',
      releasedAt: 0,
      revision: 0,
      updatedAt: now,
      history: [{ at: now, text: `封锁命中 ${hitSegs.map((s) => s.name).join('、')}，原路径与许可已冻结` }],
    }
  }

  private alternativesFor(hitIds: string[]): AltOption[] {
    const out: AltOption[] = []
    for (const hid of hitIds) {
      const bank = ALT_BANK[hid] ?? DEFAULT_ALTS
      for (const a of bank) out.push({ ...a, id: `${hid}:${a.id}` })
    }
    return out
  }

  // ---------- 逐单核对（各单独立、结论互不拖累） ----------

  setAlternative(routeId: string, altId: string) {
    this.editItem(routeId, (it, order) => {
      const prev = it.alternativeId
      it.alternativeId = altId
      it.routeChecked = false
      it.stationQualified = null
      const opt = it.alternatives.find((a) => a.id === altId)
      if (prev && prev !== altId) {
        it.revision += 1
        it.history.push({ at: Date.now(), text: `替代路径变更为「${opt?.label}」，路径/接卸核对结论退回重算（第 ${it.revision} 次）` })
      } else if (!prev) {
        it.history.push({ at: Date.now(), text: `选定替代路径「${opt?.label}」，等待路径核对` })
      }
      void order
    })
  }

  checkRoute(routeId: string) {
    this.editItem(routeId, (it) => {
      it.routeChecked = true
      it.history.push({ at: Date.now(), text: '替代路径已逐区段核对通过' })
    })
  }

  checkStation(routeId: string, qualified: boolean) {
    this.editItem(routeId, (it) => {
      it.stationQualified = qualified
      it.history.push({ at: Date.now(), text: qualified
        ? `接卸站资质核验通过：${it.alternatives.find((a) => a.id === it.alternativeId)?.station ?? ''}`
        : '接卸站资质核验不通过，该单留在待处理' })
    })
  }

  setCountersign(routeId: string, done: boolean) {
    this.editItem(routeId, (it, seatName) => {
      it.countersignDone = done
      it.countersignBy = done ? seatName : ''
      it.history.push({ at: Date.now(), text: done ? `安全/运营/应急会签完成（${seatName}）` : '会签被撤回' })
    })
  }

  release(routeId: string) {
    this.editItem(routeId, (it) => {
      if (!it.permitValid || !it.alternativeId || !it.routeChecked || it.stationQualified !== true || !it.countersignDone) return
      it.status = '已放行'
      it.releasedAt = Date.now()
      it.history.push({ at: Date.now(), text: `三项核对齐备，按替代径路放行（${fmt(it.releasedAt)}）` })
    })
  }

  /** 演练：许可在途失效 → 该单退回重算 */
  invalidatePermit(routeId: string) {
    this.editItem(routeId, (it) => {
      it.permitValid = false
      it.frozen = { ...it.frozen, permission: '已失效' }
      it.status = '待处理'
      it.releasedAt = 0
      it.countersignDone = false
      it.countersignBy = ''
      it.revision += 1
      it.history.push({ at: Date.now(), text: `许可「${it.frozen.permitNo}」被通知失效，放行撤销并退回重算（第 ${it.revision} 次）` })
    })
  }

  renewPermit(routeId: string) {
    this.editItem(routeId, (it) => {
      it.permitValid = true
      it.frozen = { ...it.frozen, permission: '有效' }
      it.history.push({ at: Date.now(), text: '新许可已补发并核验有效，可重新核对会签' })
    })
  }

  private editItem(routeId: string, fn: (it: BlockItem, seatName: string) => void) {
    const seat = this.active()
    if (!seat.draft) return
    const idx = seat.draft.items.findIndex((x) => x.routeId === routeId)
    if (idx < 0) return
    const draft = clone(seat.draft)
    fn(draft.items[idx], seat.name)
    draft.items[idx].updatedAt = Date.now()
    seat.draft = draft
    seat.dirty[routeId] = true
    seat.error = ''
    // 本地草稿即时落盘：关掉页面重开仍能接着处理
    this.persistSessions()
    this.emit()
  }

  // ---------- 保存：CAS 乐观锁、冲突合并、失败按令号重试 ----------

  async save(): Promise<void> {
    const seat = this.active()
    if (!seat.draft || seat.busy) return
    seat.busy = true
    seat.error = ''
    this.emit()
    await new Promise((r) => setTimeout(r, 650))

    // 演练：模拟一次写入失败（网络/磁盘），各单已有结论保留在本席草稿，按令号重试
    if (seat.failNext) {
      const meta = this.readSessionMeta()
      meta.failNext[seat.id] = false
      this.writeSessionMeta(meta)
      seat.busy = false
      seat.failNext = false
      seat.error = `写入失败：令号 ${seat.draft.id} 提交时网络中断，各单核对结论已保留，请点击“重试保存（按令号）”`
      this.persistSessions()
      this.emit()
      return
    }

    const base = this.server$.value
    if (base && base.version !== seat.baseVersion) {
      // 409：后到者看到当前进度，并把本席各单结论 rebase 到最新版本之上
      const merged = this.rebase(clone(base), seat.draft)
      seat.draft = merged
      seat.baseVersion = base.version
      seat.conflict = `检测到并发保存：令号 ${base.id} 已推进到 v${base.version}，已按令号合并双方逐单结论，请再次保存`
      seat.busy = false
      this.persistSessions()
      this.emit()
      return
    }

    const next = clone(seat.draft)
    next.version = (base?.version ?? 0) + 1
    next.savedAt = Date.now()
    this.server$.next(next)
    this.writeServer(next)
    seat.baseVersion = next.version
    seat.draft = clone(next)
    seat.busy = false
    seat.error = ''
    seat.conflict = ''
    seat.stale = ''
    seat.dirty = {}
    this.persistSessions()
    this.emit()
  }

  /**
   * 字段级合并：服务端为本（封锁范围、最新放行），本席改动过的单按 updatedAt 取胜，
   * 已放行结论不被旧草稿降级，写失败重试也复用本逻辑，保证已完成的单不被拖累。
   */
  private rebase(server: BlockadeOrder, local: BlockadeOrder): BlockadeOrder {
    const byLocal = new Map(local.items.map((i) => [i.routeId, i]))
    server.items = server.items.map((sv) => {
      const lo = byLocal.get(sv.routeId)
      if (!lo) return sv
      if (sv.status === '已放行' && lo.status !== '已放行') return sv
      const pickLocal = (lo.updatedAt ?? 0) > (sv.updatedAt ?? 0)
        && (sv.status !== '已放行' || lo.status === '已放行')
      return pickLocal ? lo : sv
    })
    return server
  }

  // ---------- 持久化（localStorage 模拟服务端 + 各席草稿） ----------

  private readServer(): BlockadeOrder | null {
    try { return JSON.parse(localStorage.getItem(SERVER_KEY) || 'null') } catch { return null }
  }
  private writeServer(o: BlockadeOrder) {
    localStorage.setItem(SERVER_KEY, JSON.stringify(o))
  }

  private readSessionMeta(): StoredSessions {
    try {
      const m = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as StoredSessions | null
      if (m && m.ids?.length) return m
    } catch { /* ignore */ }
    const init: StoredSessions = {
      ids: ['A'], names: { A: DISPATCHERS[0] }, activeId: 'A', failNext: {},
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(init))
    return init
  }
  private writeSessionMeta(m: StoredSessions) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(m))
  }

  private readSessions(): SessionState[] {
    const meta = this.readSessionMeta()
    return meta.ids.map((id, i) => {
      const fresh: SessionState = {
        id,
        name: meta.names[id] || DISPATCHERS[i] || id,
        draft: clone(this.server$.value),
        baseVersion: this.server$.value?.version ?? 0,
        busy: false,
        failNext: !!meta.failNext[id],
        error: '', conflict: '', stale: '', dirty: {},
      }
      // 关掉页面重开：恢复本席草稿、基线版本与各单已有结论
      try {
        const saved = JSON.parse(localStorage.getItem(this.draftKey(id)) || 'null') as
          | { draft: BlockadeOrder; baseVersion: number; dirty: Record<string, boolean>; error: string; conflict: string; stale: string }
          | null
        if (saved?.draft) {
          fresh.draft = saved.draft
          fresh.baseVersion = saved.baseVersion
          fresh.dirty = saved.dirty ?? {}
          // 瞬态报错只在明确写入失败时保留，便于重开后继续按令号重试
          fresh.error = saved.error ?? ''
          fresh.conflict = ''
          fresh.stale = ''
        }
      } catch { /* 草稿损坏则跟随服务端 */ }
      return fresh
    })
  }

  private persistSessions() {
    // 草稿随席位一起存盘（busy 为瞬态不持久化）
    for (const s of this.sessions$.value) {
      localStorage.setItem(this.draftKey(s.id), JSON.stringify({
        draft: s.draft, baseVersion: s.baseVersion, dirty: s.dirty,
        error: s.error, conflict: s.conflict, stale: s.stale,
      }))
    }
  }

  private draftKey(id: string) { return `fx.draft.${id}.v1` }

  private nextSeq(): number {
    const n = Number(localStorage.getItem(SEQ_KEY) || '0') + 1
    localStorage.setItem(SEQ_KEY, String(n))
    return n
  }

  private mutateSession(id: string, fn: (s: SessionState) => void) {
    const sessions = this.sessions$.value.map((s) => ({ ...s, draft: s.draft ? clone(s.draft) : null, dirty: { ...s.dirty } }))
    const target = sessions.find((s) => s.id === id)
    if (target) fn(target)
    this.sessions$.next(sessions)
    this.persistSessions()
    this.emit()
  }

  private snapshot(): BlockadeView {
    return {
      server: this.server$.value,
      sessions: this.sessions$.value,
      activeId: this.activeId$.value,
      segments: this.segments$.value,
      loadingSegments: this.loadingSegments$.value,
    }
  }
  private emit() { this.view$.next(this.snapshot()) }
}
