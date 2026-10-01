// 封锁处置令领域模型

export interface PathSeg {
  id: string
  name: string
  from: string
  to: string
  km: string
  risks: string[]
  level: string
}

export interface AltPath {
  id: string
  name: string
  km: string
  segments: { from: string; to: string; km: string }[]
}

export interface BillSeed {
  id: string
  cargo: string
  classCode: string // 品类资质代码，如 '3' / '8'
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  tonnage: number
  wagonCount: number
  permitNo: string
  permitValidUntil: string // ISO 日期
  path: PathSeg[]
  altPaths: AltPath[]
  needStations: string[] // 需核对接卸资质的车站
}

export interface StationInfo {
  name: string
  qualified: string[] // 具备的品类资质代码
}

export interface BlockageSection {
  line: string
  from: string
  to: string
}

export interface FrozenPermit {
  no: string
  validUntil: string
  status: '有效' | '失效'
  frozenAt: number
}

export interface FrozenPath {
  frozenAt: number
  segments: PathSeg[]
}

export interface Signer {
  role: string
  name: string
  at: number
}

export interface CheckResult {
  valid: boolean
  reason: string
}

export interface BillChecks {
  altPath: CheckResult & { selectedId: string | null }
  station: CheckResult & { results: { name: string; qualified: boolean }[] }
  permit: CheckResult
  countersign: CheckResult & { signers: Signer[] }
}

export interface AffectedBill {
  billId: string
  frozenPath: FrozenPath // 冻结的原路径（不可变更）
  frozenPermit: FrozenPermit // 冻结的许可（不可变更）
  checks: BillChecks
  status: 'pending' | 'released'
  release: { at: number; by: string } | null
  rollbackNote: string | null // 退回重算原因
  dirty?: boolean // 本地有未保存结论
  touched?: boolean // 本终端确实改动过（合并时用于保留本终端结论）
}

export interface BlockageOrder {
  id: string // 令号
  seq: number
  section: BlockageSection
  reason: string
  startedAt: string
  restoreAt: string
  dispatcher: string // 登记调度员
  createdAt: number
  updatedAt: number
  updatedBy: string // 最后保存人
  version: number // 乐观锁版本号
  bills: AffectedBill[]
}
