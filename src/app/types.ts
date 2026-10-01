export type RiskLevel = '高' | '中' | '低'

export interface RiskSegment {
  id: string
  name: string
  from: string
  to: string
  km: string
  speed: string
  risks: string[]
  level: RiskLevel
  status: '待复核' | '已确认' | '需绕行'
  coordinates: [number, number][]
}

export interface RoutePackage {
  id: string
  cargo: string
  hazardClass: string
  trainCode: string
  origin: string
  destination: string
  tonnage: number
  wagonCount: number
  permit: string
  permission: '有效' | '缺失' | '待补充'
  score: number
  updatedAt: string
  segments: RiskSegment[]
}

export interface ReviewComment {
  id: string
  segmentId: string
  role: string
  author: string
  content: string
  status: '待确认' | '已接受' | '已退回'
}
