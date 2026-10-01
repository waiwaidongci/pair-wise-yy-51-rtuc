import { Routes } from '@angular/router'
import { WorkspaceComponent } from './pages/workspace.component'
import { RiskMapComponent } from './pages/risk-map.component'
import { ApprovalComponent } from './pages/approval.component'
import { BlockageComponent } from './blockage/blockage.component'

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'blockage' },
  { path: 'blockage', component: BlockageComponent, title: '封锁处置令' },
  { path: 'workspace', component: WorkspaceComponent, title: '路径编组工作台' },
  { path: 'risk-map', component: RiskMapComponent, title: '风险地图复核' },
  { path: 'approval', component: ApprovalComponent, title: '多角色审批' },
]
