import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatSelectModule } from '@angular/material/select'
import { MatInputModule } from '@angular/material/input'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MatDividerModule } from '@angular/material/divider'
import { MatTooltipModule } from '@angular/material/tooltip'
import { Observable } from 'rxjs'
import { BlockadeService } from './blockade.service'
import { type BlockadeView, type BlockItem, type BlockadeOrder, type SessionState, canRelease, fmt } from './types'

@Component({
  selector: 'app-blockade',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatSelectModule,
    MatInputModule, MatProgressBarModule, MatDividerModule, MatTooltipModule,
  ],
  template: `
    @if (view$ | async; as view) {
    <main class="page">
      <div class="page-head">
        <div>
          <p class="eyebrow">线路临时封锁 · 危险货物运输单处置</p>
          <h1>封锁处置令</h1>
          <p>登记封锁区段后自动列出共用区段运输单，冻结原路径与许可；逐单独立核对替代路径、接卸站资质与会签，能过先放、不过留待处理。</p>
        </div>
        @if (view.server; as o) {
          <div class="order-tag">
            <b>{{ o.id }}</b>
            <small>服务端 v{{ o.version }} · 最近保存 {{ fmt(o.savedAt) }}</small>
          </div>
        }
      </div>

      @if (view.loadingSegments) { <mat-progress-bar mode="indeterminate" /> }

      <!-- 1. 登记封锁区段 -->
      @if (!view.server) {
        <section class="card register">
          <h2>① 登记封锁区段</h2>
          <div class="register-row">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>封锁区段（共用区段）</mat-label>
              <mat-select [(ngModel)]="segmentId" placeholder="选择封锁区段">
                @for (s of view.segments; track s.id) {
                  <mat-option [value]="s.id">{{ s.id }} · {{ s.name }}（{{ s.from }} → {{ s.to }}）</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="reason">
              <mat-label>封锁事由</mat-label>
              <input matInput [(ngModel)]="reason" placeholder="如：水害抢修 / 设备故障临时封锁" />
            </mat-form-field>
            <button mat-flat-button color="primary" [disabled]="!segmentId" (click)="register()">登记并自动列单</button>
          </div>
          <p class="hint">登记后系统按运输单逐张比对路径（不再人工翻单，避免漏掉共用区段），命中单立即冻结原路径与运输许可快照。</p>
        </section>
      } @else {
        <!-- 2. 调度席位（模拟两名调度员同时保存同一处置令） -->
        <section class="card seat-bar">
          <div class="seats">
            @for (s of view.sessions; track s.id) {
              <button class="seat" [class.on]="s.id === view.activeId" (click)="svc.switchSeat(s.id)">
                <span class="seat-id">{{ s.id }}</span>
                <span class="seat-name">{{ s.name }}</span>
                @if (s.busy) { <small class="saving">保存中…</small> }
                @else if (s.draft && s.baseVersion !== view.server!.version) { <small class="behind">基线 v{{ s.baseVersion }} 过期</small> }
                @else { <small class="insync">已同步 v{{ s.baseVersion }}</small> }
              </button>
            }
            <button class="seat add" (click)="svc.addSeat()" [disabled]="view.sessions.length >= 4" matTooltip="再开一个调度席位，模拟两人同令并行处置">＋ 调度席位</button>
          </div>
          <div class="seat-tools">
            <label class="fail-toggle">
              <input type="checkbox" [checked]="activeSeat(view)?.failNext" (change)="svc.toggleFailNext(activeSeat(view)!.id)" />
              下次保存模拟写入失败（演练重试）
            </label>
          </div>
        </section>

        <!-- 处置令概要 -->
        <section class="card order-head">
          <div>
            <h2>封锁范围：{{ view.server.sectionName }}</h2>
            <p>{{ view.server.rangeText }} · 事由：{{ view.server.reason }}</p>
            <p class="hint">封锁起始 {{ fmt(view.server.startedAt) }} · 原路径/许可在登记时刻冻结，不受后续修改影响</p>
          </div>
          <div class="metrics-inline">
            <div><strong>{{ view.server.items.length }}</strong><span>受影响单</span></div>
            <div><strong class="risk-low">{{ count(view.server, '已放行') }}</strong><span>已放行</span></div>
            <div><strong class="risk-mid">{{ count(view.server, '待会签') }}</strong><span>待会签</span></div>
            <div><strong class="risk-high">{{ count(view.server, '待处理') }}</strong><span>待处理</span></div>
          </div>
        </section>

        @if (activeSeat(view); as seat) {
          <!-- 席位级状态条 -->
          @if (seat.error) {
            <div class="banner error">
              <span>⚠ {{ seat.error }}</span>
              <button mat-flat-button color="warn" (click)="save()">重试保存（按令号 {{ view.server.id }}）</button>
            </div>
          }
          @if (seat.conflict) {
            <div class="banner conflict">
              <span>🔀 {{ seat.conflict }}</span>
              <button mat-flat-button color="primary" (click)="save()">确认合并并保存</button>
            </div>
          }
          @if (seat.stale && !seat.conflict) {
            <div class="banner stale"><span>ℹ {{ seat.stale }}</span><button mat-stroked-button (click)="save()">查看并合并</button></div>
          }
          @if (seat.busy) { <mat-progress-bar mode="indeterminate" /> }

          <!-- 3. 逐单核对 -->
          <div class="items">
            @for (it of seat.draft?.items ?? []; track it.routeId) {
              <section class="card item" [class.released]="it.status === '已放行'">
                <header class="item-head">
                  <div class="item-title">
                    <span class="dot" [class.ok]="it.status === '已放行'" [class.wait]="it.status !== '已放行'"></span>
                    <div>
                      <b>{{ it.routeId }}</b>
                      <small>{{ it.cargo }} · {{ it.hazardClass }} · 车次 {{ it.trainCode }} · {{ it.origin }} → {{ it.destination }}</small>
                    </div>
                  </div>
                  <div class="item-badges">
                    <span class="badge" [class.bad]="!it.permitValid" [class.good]="it.permitValid">{{ it.permitValid ? '许可有效' : '许可失效' }}</span>
                    <span class="badge" [class.good]="it.status === '已放行'" [class.warn]="it.status !== '已放行'">{{ it.status }}{{ it.status === '已放行' ? ' · ' + fmt(it.releasedAt) : '' }}</span>
                    @if (it.revision > 0) { <span class="badge rev">退回重算 ×{{ it.revision }}</span> }
                  </div>
                </header>

                <div class="item-body">
                  <!-- 冻结的原路径与许可 -->
                  <div class="frozen">
                    <h4>🔒 冻结快照（登记时锁定）</h4>
                    <ol>
                      @for (seg of it.frozen.path; track seg.id) {
                        <li [class.hit]="it.hitSegmentIds.includes(seg.id)">{{ seg.id }} {{ seg.name }}@if (it.hitSegmentIds.includes(seg.id)) { <b>〔封锁命中〕</b>}</li>
                      }
                    </ol>
                    <p>许可：{{ it.frozen.permitNo }} — <span [class.risk-low]="it.permitValid" [class.risk-high]="!it.permitValid">{{ it.frozen.permission }}</span></p>
                    <div class="frozen-actions">
                      <button mat-stroked-button color="warn" [disabled]="!it.permitValid || it.status === '已放行'" (click)="svc.invalidatePermit(it.routeId)">演练：通知许可失效</button>
                      <button mat-stroked-button [disabled]="it.permitValid" (click)="svc.renewPermit(it.routeId)">补发许可并核验</button>
                    </div>
                  </div>

                  <!-- 三项独立核对 -->
                  <div class="checks">
                    <h4>替代路径与接卸核对（本单独立，通过即可先放行，不拖累其他单）</h4>

                    <div class="check-row">
                      <span class="check-label">替代路径</span>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="alt-select">
                        <mat-label>选择替代径路</mat-label>
                        <mat-select [value]="it.alternativeId" (selectionChange)="svc.setAlternative(it.routeId, $event.value)" [disabled]="it.status === '已放行'">
                          @for (a of it.alternatives; track a.id) {
                            <mat-option [value]="a.id">{{ a.label }}（{{ a.deltaKm > 0 ? '+' : '' }}{{ a.deltaKm }} km）</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                      @if (selectedAlt(it); as a) {
                        <p class="alt-detail">{{ a.pathDetail }} · 接卸：{{ a.station }} — <span [class.risk-high]="!a.stationQualified" [class.risk-low]="a.stationQualified">{{ a.stationQualified ? '资质合格' : '资质不合格' }}</span><br /><small class="hint">{{ a.note }}</small></p>
                      }
                      <button mat-button color="primary" [disabled]="!it.alternativeId || it.routeChecked || it.status === '已放行'" (click)="svc.checkRoute(it.routeId)">{{ it.routeChecked ? '✓ 路径已核对' : '逐区段核对路径' }}</button>
                    </div>

                    <div class="check-row">
                      <span class="check-label">接卸站资质</span>
                      @if (it.stationQualified === null) {
                        <span class="muted">待核验（先选替代路径）</span>
                        <button mat-button color="primary" [disabled]="!it.alternativeId || it.status === '已放行'" (click)="svc.checkStation(it.routeId, true)">核验通过</button>
                        <button mat-button color="warn" [disabled]="!it.alternativeId || it.status === '已放行'" (click)="svc.checkStation(it.routeId, false)">核验不通过</button>
                      } @else if (it.stationQualified) {
                        <span class="risk-low">✓ 资质核验通过</span>
                      } @else {
                        <span class="risk-high">✗ 资质不通过，留待处理</span>
                        <button mat-button [disabled]="it.status === '已放行'" (click)="svc.checkStation(it.routeId, true)">改判通过</button>
                      }
                    </div>

                    <div class="check-row">
                      <span class="check-label">三方会签</span>
                      @if (!it.countersignDone) {
                        <span class="muted">安全 / 运营 / 应急待会签</span>
                        <button mat-button color="primary" [disabled]="it.status === '已放行'" (click)="svc.setCountersign(it.routeId, true)">完成会签</button>
                      } @else {
                        <span class="risk-low">✓ 已会签（{{ it.countersignBy }}）</span>
                        <button mat-button [disabled]="it.status === '已放行'" (click)="svc.setCountersign(it.routeId, false)">撤回</button>
                      }
                    </div>

                    <div class="check-row release-row">
                      <span class="check-label">放行</span>
                      <button mat-flat-button color="primary" [disabled]="!canRelease(it)" (click)="svc.release(it.routeId)">
                        {{ it.status === '已放行' ? '已放行（其他单不受影响）' : '核对齐备，立即放行' }}
                      </button>
                      @if (!canRelease(it) && it.status !== '已放行') {
                        <small class="muted">缺：{{ missing(it) }}</small>
                      }
                    </div>
                  </div>
                </div>

                <mat-divider />
                <details class="history">
                  <summary>处置记录（{{ it.history.length }}）· 最近更新 {{ fmt(it.updatedAt) }}</summary>
                  <ul>
                    @for (h of historyOf(it); track h.at) {
                      <li><small>{{ fmt(h.at) }}</small><span>{{ h.text }}</span></li>
                    }
                  </ul>
                </details>
              </section>
            }
          </div>

          <!-- 4. 保存 -->
          <section class="card save-bar">
            <div>
              <b>保存处置令 {{ view.server.id }}</b>
              <small>本席基线 v{{ seat.baseVersion }}，服务端当前 v{{ view.server.version }} · 乐观锁：后到者先看到当前进度，再按令号合并双方结论</small>
            </div>
            <div class="save-actions">
              <button mat-flat-button color="primary" [disabled]="seat.busy" (click)="save()">{{ seat.busy ? '保存中…' : '保存处置令' }}</button>
            </div>
          </section>

          <p class="hint demo-hint">
            并发演练：点「＋ 调度席位」加入 B；A、B 分别核对不同运输单后各自保存——后到者会看到服务端最新版本与逐单进度，合并后再次保存，不覆盖已放行单。
            勾选「下次保存模拟写入失败」：失败后各单已有结论保留在本席，按令号重试即可。全部结论按席位存盘，关掉页面重开仍可继续。
          </p>
        }
      }
    </main>
    }
  `,
  styles: [`
    h2 { margin: 0 0 12px; font-size: 18px; }
    h4 { margin: 0 0 8px; font-size: 13px; color: #334155; }
    .register-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .register-row mat-form-field { width: 340px; }
    .register-row .reason { flex: 1; min-width: 240px; }
    .hint { color: #667085; font-size: 12px; margin: 8px 0 0; }
    .order-tag { text-align: right; }
    .order-tag b { display: block; font-size: 20px; color: #2563eb; letter-spacing: .5px; }
    .order-tag small { color: #667085; }
    .seat-bar { display: flex; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin: 14px 0; }
    .seats { display: flex; gap: 8px; flex-wrap: wrap; }
    .seat { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; border: 1px solid #dbe3ee; background: #f8fafc; border-radius: 8px; padding: 8px 14px; cursor: pointer; min-width: 132px; }
    .seat.on { border-color: #2563eb; background: #eff6ff; box-shadow: inset 0 0 0 1px #2563eb; }
    .seat-id { font-weight: 800; color: #2563eb; }
    .seat-name { font-size: 13px; }
    .seat small { font-size: 11px; }
    .seat .saving { color: #d97706; } .seat .behind { color: #dc2626; } .seat .insync { color: #15803d; }
    .seat.add { justify-content: center; color: #2563eb; border-style: dashed; }
    .fail-toggle { font-size: 13px; color: #475569; display: flex; align-items: center; gap: 6px; }
    .order-head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
    .order-head p { margin: 4px 0 0; }
    .metrics-inline { display: flex; gap: 22px; }
    .metrics-inline div { text-align: center; }
    .metrics-inline strong { display: block; font-size: 26px; }
    .metrics-inline span { color: #667085; font-size: 12px; }
    .banner { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; }
    .banner.error { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; }
    .banner.conflict { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
    .banner.stale { background: #eff6ff; border: 1px solid #bfdbfe; color: #1d4ed8; }
    .items { display: flex; flex-direction: column; gap: 14px; }
    .item.released { border-left: 4px solid #15803d; }
    .item-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
    .item-title { display: flex; gap: 10px; align-items: center; }
    .item-title small { display: block; color: #667085; margin-top: 2px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .dot.ok { background: #15803d; } .dot.wait { background: #d97706; }
    .item-badges { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .badge { font-size: 12px; border-radius: 999px; padding: 3px 10px; background: #f1f5f9; color: #475569; }
    .badge.good { background: #dcfce7; color: #15803d; }
    .badge.bad { background: #fee2e2; color: #b91c1c; }
    .badge.warn { background: #fef3c7; color: #b45309; }
    .badge.rev { background: #fef3c7; color: #92400e; }
    .item-body { display: grid; grid-template-columns: minmax(280px, .9fr) minmax(0, 1.4fr); gap: 16px; }
    @media (max-width: 900px) { .item-body { grid-template-columns: 1fr; } }
    .frozen { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 10px 12px; }
    .frozen ol { margin: 6px 0; padding-left: 20px; }
    .frozen li { font-size: 13px; padding: 2px 0; color: #475569; }
    .frozen li.hit { color: #dc2626; font-weight: 700; }
    .frozen p { font-size: 13px; margin: 6px 0; }
    .frozen-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
    .check-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; flex-wrap: wrap; }
    .check-label { width: 84px; color: #475569; font-size: 13px; font-weight: 700; }
    .alt-select { width: 300px; }
    .alt-detail { margin: 0; font-size: 12px; color: #475569; flex: 1; min-width: 220px; }
    .muted { color: #94a3b8; font-size: 13px; }
    .release-row { border-bottom: none; }
    .history { margin-top: 10px; }
    .history summary { cursor: pointer; font-size: 13px; color: #2563eb; }
    .history ul { list-style: none; padding: 0; margin: 8px 0 0; }
    .history li { display: flex; gap: 10px; padding: 4px 0; font-size: 13px; }
    .history li small { color: #94a3b8; min-width: 150px; }
    .save-bar { position: sticky; bottom: 12px; margin-top: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; box-shadow: 0 6px 20px #1018281f; z-index: 5; }
    .save-bar small { display: block; color: #667085; margin-top: 3px; }
    .demo-hint { margin-top: 10px; line-height: 1.7; }
  `],
})
export class BlockadeComponent implements OnInit {
  readonly svc = inject(BlockadeService)
  readonly view$: Observable<BlockadeView> = this.svc.view$
  readonly canRelease = canRelease
  readonly fmt = fmt

  segmentId = ''
  reason = ''

  ngOnInit() {
    void this.svc.ensurePackages()
  }

  register() {
    if (!this.segmentId) return
    this.svc.register(this.segmentId, this.reason.trim())
  }

  save() {
    void this.svc.save()
  }

  activeSeat(view: BlockadeView): SessionState | undefined {
    return view.sessions.find((s) => s.id === view.activeId)
  }

  selectedAlt(it: BlockItem) {
    return it.alternatives.find((a) => a.id === it.alternativeId) ?? null
  }

  historyOf(it: BlockItem) {
    return [...it.history].reverse()
  }

  missing(it: BlockItem): string {
    const miss: string[] = []
    if (!it.permitValid) miss.push('许可有效')
    if (!it.alternativeId) miss.push('替代路径')
    if (!it.routeChecked) miss.push('路径核对')
    if (it.stationQualified !== true) miss.push('接卸资质')
    if (!it.countersignDone) miss.push('会签')
    return miss.join('、')
  }

  count(o: BlockadeOrder, kind: '已放行' | '待会签' | '待处理'): number {
    if (kind === '已放行') return o.items.filter((i) => i.status === '已放行').length
    if (kind === '待会签') return o.items.filter((i) => i.status === '待处理' && !i.countersignDone).length
    return o.items.filter((i) => i.status === '待处理').length
  }
}
