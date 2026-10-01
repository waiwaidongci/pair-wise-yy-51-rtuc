import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { MatTableModule } from '@angular/material/table'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatSelectModule } from '@angular/material/select'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatDividerModule } from '@angular/material/divider'
import { RouteState } from '../store/route.reducer'
import * as RouteActions from '../store/route.actions'
import type { RoutePackage } from '../types'

@Component({
  selector: 'app-workspace',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatProgressBarModule, MatDividerModule],
  template: `
    <main class="page">
      <div class="page-head"><div><p class="eyebrow">运输许可与路径编组</p><h1>危险货物运输路径审批</h1><p>核对货物类别、编组、许可与区段约束，生成可比较的候选路径。</p></div><div><button mat-stroked-button (click)="createAlternative()">生成替代方案</button> <button mat-flat-button color="primary" (click)="refresh()">重新校验</button></div></div>
      <div class="grid-4">
        <article class="card metric"><span>待审批路径</span><strong>{{ (state$ | async)?.routes?.length || 0 }}</strong><small>今日新增 2 条</small></article>
        <article class="card metric"><span>高风险区段</span><strong class="risk-high">{{ highRiskCount }}</strong><small>需安全与应急会签</small></article>
        <article class="card metric"><span>许可缺失</span><strong class="risk-mid">1</strong><small>不得进入审批通过态</small></article>
        <article class="card metric"><span>当前草案</span><strong>v{{ (state$ | async)?.version }}</strong><small>修改均进入审计记录</small></article>
      </div>
      @if ((state$ | async)?.loading) { <mat-progress-bar mode="indeterminate" /> }
      <div class="grid-2">
        <section class="card table-wrap">
          <div class="toolbar"><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>货物类别</mat-label><mat-select><mat-option>全部类别</mat-option><mat-option>第 3 类 易燃液体</mat-option><mat-option>第 8 类 腐蚀品</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>审批状态</mat-label><mat-select><mat-option>全部状态</mat-option><mat-option>待安全复核</mat-option><mat-option>待应急复核</mat-option></mat-select></mat-form-field><span class="spacer"></span><button mat-stroked-button>导出审批包</button></div>
          <table mat-table [dataSource]="(state$ | async)?.routes || []">
            <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>运输单</th><td mat-cell *matCellDef="let row"><b>{{row.id}}</b><small class="block">{{row.updatedAt}}</small></td></ng-container>
            <ng-container matColumnDef="cargo"><th mat-header-cell *matHeaderCellDef>货物 / 车次</th><td mat-cell *matCellDef="let row"><b>{{row.cargo}}</b><small class="block">{{row.hazardClass}} · {{row.trainCode}}</small></td></ng-container>
            <ng-container matColumnDef="route"><th mat-header-cell *matHeaderCellDef>起终点</th><td mat-cell *matCellDef="let row">{{row.origin}} → {{row.destination}}</td></ng-container>
            <ng-container matColumnDef="permission"><th mat-header-cell *matHeaderCellDef>许可</th><td mat-cell *matCellDef="let row"><span [class.risk-high]="row.permission!=='有效'">{{row.permission}}</span></td></ng-container>
            <ng-container matColumnDef="score"><th mat-header-cell *matHeaderCellDef>风险分</th><td mat-cell *matCellDef="let row"><b [class.risk-high]="row.score>=70" [class.risk-mid]="row.score>=45 && row.score<70">{{row.score}}</b> / 100</td></ng-container>
            <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button color="primary" (click)="select(row)">审核</button></td></ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.selected-row]="row.id === selectedId"></tr>
          </table>
        </section>
        <aside class="card">
          <h2>规则引擎结论</h2>
          @for (route of (state$ | async)?.routes || []; track route.id) {
            <div class="rule" [class.active]="route.id === selectedId"><div><b>{{route.trainCode}}</b><span>{{route.segments.length}} 个运行区段</span></div><strong [class.risk-high]="route.score >= 70" [class.risk-mid]="route.score < 70">{{route.score >= 70 ? '高风险' : '需复核' }}</strong></div>
          }
          <mat-divider />
          <h3>强制校验项</h3>
          <p>✓ 罐车编组隔离与押运资质</p><p class="risk-high">! S-203 水源地保护段缺少属地放行函</p><p>✓ 替代路径具备接卸条件</p>
          <button mat-flat-button color="primary" style="width:100%" (click)="createAlternative()">要求补充替代方案</button>
        </aside>
      </div>
    </main>
  `,
  styles: [`
    h2,h3{margin:0 0 12px}.table-wrap{overflow:auto}.block{display:block;color:#7a8798;margin-top:3px}.selected-row{background:#eff6ff}.rule{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid #edf0f5}.rule span{display:block;color:#7a8798;font-size:12px;margin-top:4px}.rule.active{padding-left:10px;border-left:3px solid #2563eb}.rule strong{font-size:12px}.toolbar{margin-bottom:10px}.toolbar mat-form-field{width:160px}
  `],
})
export class WorkspaceComponent implements OnInit {
  private readonly store = inject(Store<{ routes: RouteState }>)
  readonly state$ = this.store.select('routes')
  readonly columns = ['id', 'cargo', 'route', 'permission', 'score', 'action']
  selectedId = ''
  highRiskCount = 0

  constructor() { this.state$.subscribe((state) => { this.selectedId = state.selectedRouteId; this.highRiskCount = state.routes.flatMap((route: RoutePackage) => route.segments).filter((segment: RoutePackage['segments'][number]) => segment.level === '高').length }) }
  ngOnInit() { this.refresh() }
  refresh() { this.store.dispatch(RouteActions.loadRoutes()) }
  select(row: RoutePackage) { this.store.dispatch(RouteActions.selectRoute({ id: row.id })) }
  createAlternative() { this.store.dispatch(RouteActions.createAlternative()) }
}
