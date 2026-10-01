// 封锁处置令领域模型

export interface AltOption {
  id: string
  label: string
  pathDetail: string
  station: string
  /** 接卸站资质档案结论 */
  stationQualified: boolean
  deltaKm: number
  note: string
}

export interface FrozenSnapshot {
  path: { id: string; name: string }[]
  permission: string
  permitNo: string
  frozenAt: number
}

export interface ItemHistory {
  at: number
  text: string
}

/** 处置令内单张危险货物运输单的逐单核对状态 */
export interface BlockItem {
  routeId: string
  cargo: string
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  hitSegmentIds: string[]
  hitNames: string[]
  frozen: FrozenSnapshot
  permitValid: boolean
  alternatives: AltOption[]
  alternativeId: string
  /** 替代路径核对 */
  routeChecked: boolean
  /** 接卸站资质核对：null 未核对 */
  stationQualified: boolean | null
  countersignDone: boolean
  countersignBy: string
  status: '待处理' | '已放行'
  releasedAt: number
  /** 许可失效或路径改动触发的退回重算轮次 */
  revision: number
  updatedAt: number
  history: ItemHistory[]
}

export interface BlockadeOrder {
  /** 令号 */
  id: string
  sectionSegmentId: string
  sectionName: string
  rangeText: string
  reason: string
  startedAt: number
  createdAt: number
  items: BlockItem[]
  version: number
  savedAt: number
}

export interface SessionState {
  id: string
  name: string
  draft: BlockadeOrder | null
  /** 本席保存所基于的服务端版本（乐观锁） */
  baseVersion: number
  busy: boolean
  /** 演练用：下一次提交模拟网络写入失败 */
  failNext: boolean
  error: string
  conflict: string
  stale: string
  /** 自基线以来本席改动过的运输单 */
  dirty: Record<string, boolean>
}

export interface SegmentOption {
  id: string
  name: string
  from: string
  to: string
}

export interface BlockadeView {
  server: BlockadeOrder | null
  sessions: SessionState[]
  activeId: string
  segments: SegmentOption[]
  loadingSegments: boolean
}

export function canRelease(it: BlockItem): boolean {
  return it.status !== '已放行'
    && it.permitValid
    && !!it.alternativeId
    && it.routeChecked
    && it.stationQualified === true
    && it.countersignDone
}

export function fmt(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
