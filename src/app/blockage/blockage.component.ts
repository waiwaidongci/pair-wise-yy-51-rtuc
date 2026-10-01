import { Component, OnDestroy, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatCardModule } from '@angular/material/card'
import { MatButtonModule } from '@angular/material/button'
import { MatChipsModule } from '@angular/material/chips'
import { MatIconModule } from '@angular/material/icon'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatCheckboxModule } from '@angular/material/checkbox'
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar'
import { MatTooltipModule } from '@angular/material/tooltip'
import { Subscription } from 'rxjs'
import { AffectedBill, BillSeed, BlockageOrder } from './models'
import { BlockageService } from './blockage.service'
import { ROLES, STATIONS } from './blockage-data'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

@Component({
  selector: 'app-blockage',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressBarModule,
    MatCheckboxModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">应急调度 · 封锁处置</div>
          <h1>封锁处置令</h1>
          <p>登记封锁区段后自动列出受影响运输单，先冻结原路径与许可；逐单核对替代路径、接卸站资质、会签，达标先放行，待处理不拖累已完成单。</p>
        </div>
        <div class="dispatcher">
          <span>值班调度员</span>
          <select [(ngModel)]="service.dispatcherName">
            <option>值班调度员</option>
            <option>调度员 周敏</option>
            <option>调度员 李峥</option>
          </select>
        </div>
      </div>

      <div class="layout">
        <aside class="side">
          <mat-card class="panel">
            <mat-card-title>登记封锁区段</mat-card-title>
            <mat-card-content>
              <div class="form">
                <label>线路名称
                  <input [(ngModel)]="form.line" placeholder="如：陇海线" />
                </label>
                <label>封锁区段（from）
                  <input [(ngModel)]="form.from" list="station-list" placeholder="如：天水" />
                </label>
                <label>封锁区段（to）
                  <input [(ngModel)]="form.to" list="station-list" placeholder="如：宝鸡西" />
                </label>
                <datalist id="station-list">
                  @for (s of stations; track s.name) { <option [value]="s.name"></option> }
                </datalist>
                <label>封锁原因
                  <input [(ngModel)]="form.reason" placeholder="如：水害落石，线路临时封锁" />
                </label>
                <label>开始时间
                  <input type="datetime-local" [(ngModel)]="form.startedAt" />
                </label>
                <label>预计恢复
                  <input type="datetime-local" [(ngModel)]="form.restoreAt" />
                </label>
                <button mat-flat-button color="primary" (click)="create()" [disabled]="!form.from || !form.to">
                  <mat-icon>add_task</mat-icon> 生成处置令
                </button>
              </div>
            </mat-card-content>
          </mat-card>

          <mat-card class="panel">
            <mat-card-title>处置令（可跨页面接续）</mat-card-title>
            <mat-card-content>
              @if (!orders.length) {
                <p class="empty">暂无处置令。登记封锁区段后自动生成，关闭页面再开仍可继续处理。</p>
              }
              @for (o of orders; track o.id) {
                <button class="order-row" [class.active]="o.id === selectedId" (click)="select(o.id)">
                  <div class="order-id">{{ o.id }}</div>
                  <div class="order-sec">{{ o.section.from }} → {{ o.section.to }}</div>
                  <div class="order-progress">
                    <span [class.done]="releasedCount(o) === o.bills.length && o.bills.length > 0">
                      {{ releasedCount(o) }}/{{ o.bills.length }} 单放行
                    </span>
                    <small>v{{ o.version }} · {{ o.updatedBy }}</small>
                  </div>
                </button>
              }
            </mat-card-content>
          </mat-card>
        </aside>

        <section class="main">
          @if (!selected) {
            <mat-card class="panel empty-main">
              <mat-icon>block</mat-icon>
              <p>请在左侧登记封锁区段。系统将自动比对各运输单路径中的共用区段，列出受影响运输单并冻结其原路径与许可。</p>
            </mat-card>
          } @else {
            <!-- 处置令头 -->
            <mat-card class="panel order-head">
              <div class="oh-top">
                <div>
                  <div class="oh-id">{{ selected.id }}</div>
                  <div class="oh-sec">
                    <mat-chip highlighted>{{ selected.section.line }}</mat-chip>
                    <b>{{ selected.section.from }}</b> → <b>{{ selected.section.to }}</b>
                  </div>
                </div>
                <div class="oh-meta">
                  <div>登记：{{ selected.dispatcher }}</div>
                  <div>开始：{{ selected.startedAt }}</div>
                  <div>预计恢复：{{ selected.restoreAt }}</div>
                  <div class="oh-version">当前 v{{ selected.version }} · 最后保存 {{ selected.updatedBy }}</div>
                </div>
              </div>
              <div class="oh-reason">封锁原因：{{ selected.reason }}</div>
              <div class="freeze-note">
                <mat-icon>ac_unit</mat-icon>
                <span>受影响运输单的原路径区段与许可证号已<b>冻结存档</b>，不可变更；仅可在此基础上核对替代路径、接卸站资质与会签。任何一单退回重算不影响其他单的放行结论。</span>
              </div>
            </mat-card>

            <!-- 进度与协同操作 -->
            <mat-card class="panel progress-panel">
              <div class="stats">
                <div class="stat"><small>受影响</small><b>{{ selected.bills.length }}</b><span>单</span></div>
                <div class="stat ok"><small>已放行</small><b>{{ releasedCount(selected) }}</b><span>单</span></div>
                <div class="stat wait"><small>待处理</small><b>{{ selected.bills.length - releasedCount(selected) }}</b><span>单</span></div>
              </div>
              <mat-progress-bar mode="determinate" [value]="selected.bills.length ? releasedCount(selected) / selected.bills.length * 100 : 0"></mat-progress-bar>
              <div class="actions">
                <button mat-flat-button color="primary" (click)="save()" [disabled]="saving">
                  <mat-icon>save</mat-icon> 保存处置令
                </button>
                <button mat-stroked-button (click)="releaseAll()">
                  <mat-icon>done_all</mat-icon> 放行全部达标单
                </button>
                <button mat-stroked-button (click)="simulateOther()">
                  <mat-icon>group</mat-icon> 模拟另一调度员同时保存
                </button>
                <mat-checkbox [(ngModel)]="service.simulateFailure" matTooltip="勾选后首次写入会失败，系统保留各单结论并按令号自动重试">模拟写入失败（验证重试）</mat-checkbox>
                <span class="save-state">
                  @if (saving) { 正在保存… } @else { 结论自动保留在本机，重开页面可接续 }
                </span>
              </div>
            </mat-card>

            <!-- 逐单卡片 -->
            @for (bill of selected.bills; track bill.billId) {
              <mat-card class="bill" [class.released]="bill.status === 'released'" [class.rolled]="bill.rollbackNote">
                <div class="bill-head">
                  <div class="bh-id">{{ bill.billId }}</div>
                  <mat-chip>{{ seedOf(bill).cargo }}</mat-chip>
                  <mat-chip>{{ seedOf(bill).hazardClass }}</mat-chip>
                  <mat-chip>车次 {{ seedOf(bill).trainCode }}</mat-chip>
                  <span class="bh-route">{{ seedOf(bill).origin }} → {{ seedOf(bill).destination }}</span>
                  <span class="spacer"></span>
                  <span class="badge" [class.released]="bill.status === 'released'">
                    {{ bill.status === 'released' ? '已放行' : '待处理' }}
                  </span>
                </div>

                @if (bill.rollbackNote) {
                  <div class="rollback"><mat-icon>history</mat-icon> {{ bill.rollbackNote }}</div>
                }

                <!-- 冻结原路径 -->
                <div class="frozen">
                  <div class="frozen-title"><mat-icon>ac_unit</mat-icon> 冻结原路径 <small>冻结于 {{ fmtTime(bill.frozenPath.frozenAt) }}</small></div>
                  <div class="seg-flow">
                    @for (seg of bill.frozenPath.segments; track seg.id; let last = $last) {
                      <span class="seg" [class.blocked]="isBlocked(seg)" [class.normal]="!isBlocked(seg)">
                        <b>{{ seg.from }}—{{ seg.to }}</b> <small>{{ seg.km }}km</small>
                        @if (isBlocked(seg)) { <em>封锁 · 已冻结</em> }
                      </span>
                      @if (!last) { <span class="arrow">→</span> }
                    }
                  </div>
                </div>

                <!-- 冻结许可 -->
                <div class="frozen permit">
                  <div class="frozen-title"><mat-icon>ac_unit</mat-icon> 冻结许可</div>
                  <div class="permit-row">
                    <span>许可证号：{{ bill.frozenPermit.no }}</span>
                    <span>有效期至 {{ bill.frozenPermit.validUntil }}</span>
                    <mat-chip [class.ok-chip]="bill.frozenPermit.status === '有效'" [class.bad-chip]="bill.frozenPermit.status === '失效'">
                      {{ bill.frozenPermit.status }}
                    </mat-chip>
                  </div>
                </div>

                <!-- 四项核对 -->
                <div class="checks">
                  <div class="check" [class.pass]="bill.checks.altPath.valid" [class.fail]="!bill.checks.altPath.valid">
                    <div class="check-title">① 替代路径</div>
                    @if (seedOf(bill).altPaths.length === 0) {
                      <div class="why">无可用替代路径</div>
                    }
                    @for (alt of seedOf(bill).altPaths; track alt.id) {
                      <label class="alt-opt">
                        <input type="radio" [name]="bill.billId + '-alt'" [checked]="bill.checks.altPath.selectedId === alt.id"
                               (change)="chooseAlt(bill, alt.id)" />
                        <span>{{ alt.name }} <small>{{ alt.km }}km</small></span>
                        @if (!altSelectable(alt, bill)) { <em class="why">仍经封锁区段/不到达</em> }
                      </label>
                    }
                    <div class="result" [class.ok]="bill.checks.altPath.valid" [class.bad]="!bill.checks.altPath.valid">{{ bill.checks.altPath.reason }}</div>
                  </div>

                  <div class="check" [class.pass]="bill.checks.station.valid" [class.fail]="!bill.checks.station.valid">
                    <div class="check-title">② 接卸站资质</div>
                    @for (r of bill.checks.station.results; track r.name) {
                      <mat-chip [class.ok-chip]="r.qualified" [class.bad-chip]="!r.qualified">{{ r.name }} {{ r.qualified ? '✓' : '✗' }}</mat-chip>
                    }
                    <div class="result" [class.ok]="bill.checks.station.valid" [class.bad]="!bill.checks.station.valid">{{ bill.checks.station.reason }}</div>
                  </div>

                  <div class="check" [class.pass]="bill.checks.permit.valid" [class.fail]="!bill.checks.permit.valid">
                    <div class="check-title">③ 许可核对</div>
                    <div class="result-line">状态：{{ bill.frozenPermit.status }} · 有效期至 {{ bill.frozenPermit.validUntil }}</div>
                    <div class="result" [class.ok]="bill.checks.permit.valid" [class.bad]="!bill.checks.permit.valid">{{ bill.checks.permit.reason }}</div>
                    <div class="mini-actions">
                      <button mat-button (click)="setPermit(bill, '失效')">模拟许可失效</button>
                      <button mat-button (click)="setPermit(bill, '有效')">重新核验</button>
                    </div>
                  </div>

                  <div class="check" [class.pass]="bill.checks.countersign.valid" [class.fail]="!bill.checks.countersign.valid">
                    <div class="check-title">④ 会签（安全 / 运营 / 应急）</div>
                    @for (s of bill.checks.countersign.signers; track s.role) {
                      <mat-chip class="sign-chip">{{ s.role }} · {{ s.name }} <small>{{ fmtTime(s.at) }}</small></mat-chip>
                    }
                    @if (missingRoles(bill).length) {
                      <div class="mini-actions">
                        @for (role of missingRoles(bill); track role) {
                          <button mat-stroked-button (click)="sign(bill, role)">{{ role }}会签</button>
                        }
                      </div>
                    }
                    <div class="result" [class.ok]="bill.checks.countersign.valid" [class.bad]="!bill.checks.countersign.valid">{{ bill.checks.countersign.reason }}</div>
                  </div>
                </div>

                <div class="bill-foot">
                  @if (bill.status === 'released') {
                    <span class="released-note"><mat-icon>verified</mat-icon> 已于 {{ fmtTime(bill.release!.at) }} 由 {{ bill.release!.by }} 放行</span>
                  } @else {
                    <span class="pending-note">待处理：{{ failReasons(bill).join('；') }}</span>
                    <span class="spacer"></span>
                    <button mat-flat-button color="primary" [disabled]="!allPass(bill)" (click)="release(bill)">
                      <mat-icon>outgoing_mail</mat-icon> 放行
                    </button>
                  }
                </div>
              </mat-card>
            }
          }
        </section>
      </div>
    </div>
  `,
  styles: [`
    .layout { display: grid; grid-template-columns: 330px minmax(0, 1fr); gap: 16px; align-items: start; }
    .side { display: flex; flex-direction: column; gap: 14px; position: sticky; top: 84px; }
    .panel { padding: 16px; }
    .panel mat-card-title { font-size: 16px; margin-bottom: 12px; }
    .form { display: flex; flex-direction: column; gap: 10px; }
    .form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #667085; }
    .form input { padding: 8px 10px; border: 1px solid #d5dde8; border-radius: 6px; font-size: 14px; }
    .empty { color: #98a2b3; font-size: 13px; margin: 0; }
    .order-row { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 10px 12px; margin-bottom: 8px;
      border: 1px solid #e1e7ef; border-radius: 8px; background: #f8fafc; cursor: pointer; font: inherit; }
    .order-row.active { border-color: #2563eb; background: #eff4ff; }
    .order-id { font-weight: 700; color: #1d4ed8; font-size: 14px; }
    .order-sec { font-size: 13px; color: #344054; }
    .order-progress { display: flex; justify-content: space-between; font-size: 12px; color: #667085; }
    .order-progress .done { color: #15803d; font-weight: 700; }
    .empty-main { padding: 40px; text-align: center; color: #667085; }
    .empty-main mat-icon { font-size: 40px; width: 40px; height: 40px; color: #98a2b3; }
    .order-head .oh-top { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .oh-id { font-size: 20px; font-weight: 800; color: #1d4ed8; }
    .oh-sec { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 16px; }
    .oh-meta { font-size: 13px; color: #475569; text-align: right; display: flex; flex-direction: column; gap: 2px; }
    .oh-version { color: #64748b; }
    .oh-reason { margin-top: 8px; font-size: 13px; color: #475569; }
    .freeze-note { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; padding: 10px 12px; background: #f0f6ff;
      border: 1px solid #d6e6ff; border-radius: 8px; font-size: 13px; color: #334155; }
    .freeze-note mat-icon { color: #2563eb; font-size: 18px; width: 18px; height: 18px; }
    .progress-panel { margin: 14px 0; }
    .stats { display: flex; gap: 26px; margin-bottom: 10px; }
    .stat { display: flex; align-items: baseline; gap: 6px; }
    .stat small { color: #667085; }
    .stat b { font-size: 26px; }
    .stat.ok b { color: #15803d; }
    .stat.wait b { color: #b45309; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 12px; }
    .save-state { font-size: 12px; color: #667085; }
    .bill { margin-bottom: 14px; padding: 16px; border-left: 4px solid #f59e0b; }
    .bill.released { border-left-color: #16a34a; background: #f6fef9; }
    .bill.rolled { border-left-color: #dc2626; }
    .bill-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .bh-id { font-weight: 800; color: #0f172a; }
    .bh-route { font-size: 13px; color: #475569; }
    .spacer { flex: 1; }
    .badge { padding: 3px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: #fef3c7; color: #b45309; }
    .badge.released { background: #dcfce7; color: #15803d; }
    .rollback { display: flex; gap: 6px; align-items: center; margin-top: 8px; padding: 8px 10px; background: #fef2f2;
      border: 1px solid #fecaca; border-radius: 6px; font-size: 13px; color: #b91c1c; }
    .frozen { margin-top: 10px; padding: 10px 12px; background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 8px; }
    .frozen.permit { background: #f8fafc; }
    .frozen-title { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 8px; }
    .frozen-title mat-icon { font-size: 16px; width: 16px; height: 16px; color: #0ea5e9; }
    .frozen-title small { font-weight: 400; color: #94a3b8; }
    .seg-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .seg { display: inline-flex; flex-direction: column; gap: 2px; padding: 6px 10px; border-radius: 6px; font-size: 13px; }
    .seg.normal { background: #e2e8f0; color: #334155; }
    .seg.blocked { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
    .seg small { color: inherit; opacity: .75; }
    .seg em { font-style: normal; font-size: 11px; font-weight: 700; }
    .arrow { color: #94a3b8; }
    .permit-row { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; font-size: 13px; color: #334155; }
    .checks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .check { border: 1px solid #e1e7ef; border-radius: 8px; padding: 10px 12px; }
    .check.pass { border-color: #bbf7d0; background: #f0fdf4; }
    .check.fail { border-color: #fecaca; background: #fef2f2; }
    .check-title { font-size: 13px; font-weight: 700; margin-bottom: 8px; color: #0f172a; }
    .check mat-chip { margin: 2px 4px 2px 0; font-size: 12px; }
    .ok-chip { background: #dcfce7 !important; color: #15803d !important; }
    .bad-chip { background: #fee2e2 !important; color: #b91c1c !important; }
    .alt-opt { display: flex; align-items: center; gap: 6px; font-size: 13px; margin: 4px 0; cursor: pointer; }
    .alt-opt .why { color: #b91c1c; font-size: 12px; }
    .why { font-size: 13px; color: #b91c1c; }
    .result { margin-top: 6px; font-size: 12px; font-weight: 600; }
    .result.ok { color: #15803d; }
    .result.bad { color: #b91c1c; }
    .result-line { font-size: 13px; color: #334155; margin-bottom: 4px; }
    .mini-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .mini-actions button { font-size: 12px; line-height: 1.6; }
    .sign-chip { background: #e0e7ff !important; color: #3730a3 !important; }
    .sign-chip small { color: #6366f1; }
    .bill-foot { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #e1e7ef; }
    .released-note { display: flex; align-items: center; gap: 6px; color: #15803d; font-weight: 700; font-size: 14px; }
    .pending-note { font-size: 13px; color: #b45309; }
    .dispatcher { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #475569; }
    .dispatcher select { padding: 6px 10px; border: 1px solid #d5dde8; border-radius: 6px; }
    @media (max-width: 1100px) { .layout { grid-template-columns: 1fr; } .side { position: static; } .checks { grid-template-columns: 1fr; } }
  `],
})
export class BlockageComponent implements OnInit, OnDestroy {
  service = inject(BlockageService)
  private snackBar = inject(MatSnackBar)
  private sub?: Subscription

  orders: BlockageOrder[] = []
  selected: BlockageOrder | null = null
  selectedId: string | null = null
  saving = false
  stations = STATIONS

  form = {
    line: '陇海线',
    from: '天水',
    to: '宝鸡西',
    reason: '西峡水源保护区段水害落石，线路临时封锁',
    startedAt: toLocalInput(new Date()),
    restoreAt: toLocalInput(new Date(Date.now() + 4 * 3600 * 1000)),
  }

  ngOnInit(): void {
    this.sub = new Subscription()
    this.sub.add(
      this.service.orders$.subscribe((list) => {
        this.orders = list
        if (this.selectedId) this.selected = list.find((o) => o.id === this.selectedId) ?? null
        if (!this.selected && list.length) this.select(list[list.length - 1].id)
      }),
    )
    this.sub.add(this.service.saving$.subscribe((s) => (this.saving = s)))
    this.sub.add(
      this.service.toast$.subscribe((t) => this.snackBar.open(t.text, '关闭', { duration: 5000 })),
    )
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe()
  }

  select(id: string): void {
    this.selectedId = id
    this.selected = this.orders.find((o) => o.id === id) ?? null
  }

  create(): void {
    const order = this.service.createOrder({ ...this.form })
    this.select(order.id)
  }

  seedOf(bill: AffectedBill): BillSeed {
    return this.service.seeds.find((b) => b.id === bill.billId)!
  }

  isBlocked(seg: { from: string; to: string }): boolean {
    if (!this.selected) return false
    const s = this.selected.section
    return (seg.from === s.from && seg.to === s.to) || (seg.from === s.to && seg.to === s.from)
  }

  altSelectable(alt: { id: string }, bill: AffectedBill): boolean {
    return this.service.altValid(this.seedOf(bill), alt.id, this.selected!.section)
  }

  missingRoles(bill: AffectedBill): string[] {
    return ROLES.filter((r) => !bill.checks.countersign.signers.some((s) => s.role === r))
  }

  allPass(bill: AffectedBill): boolean {
    return this.service.allPass(bill, this.selected!.section)
  }

  failReasons(bill: AffectedBill): string[] {
    const c = bill.checks
    const r: string[] = []
    if (!c.altPath.valid) r.push(c.altPath.reason)
    if (!c.station.valid) r.push(c.station.reason)
    if (!c.permit.valid) r.push(c.permit.reason)
    if (!c.countersign.valid) r.push(c.countersign.reason)
    return r
  }

  releasedCount(o: BlockageOrder): number {
    return o.bills.filter((b) => b.status === 'released').length
  }

  chooseAlt(bill: AffectedBill, altId: string): void {
    this.service.chooseAlt(this.selected!.id, bill.billId, altId)
  }
  sign(bill: AffectedBill, role: string): void {
    this.service.sign(this.selected!.id, bill.billId, role)
  }
  setPermit(bill: AffectedBill, status: '有效' | '失效'): void {
    this.service.setPermitStatus(this.selected!.id, bill.billId, status)
  }
  release(bill: AffectedBill): void {
    this.service.release(this.selected!.id, bill.billId)
  }
  releaseAll(): void {
    this.service.releaseAll(this.selected!.id)
  }
  save(): void {
    if (this.selected) void this.service.save(this.selected)
  }
  simulateOther(): void {
    if (this.selected) this.service.simulateOtherDispatcher(this.selected.id)
  }

  fmtTime(ts: number): string {
    const d = new Date(ts)
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
}
