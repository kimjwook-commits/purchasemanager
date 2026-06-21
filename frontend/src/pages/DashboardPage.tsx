import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  IconSnowflake, IconSun, IconAlertTriangle, IconArrowRight,
  IconReceipt, IconChevronRight,
} from '@tabler/icons-react'
import {
  getPlanRuns, getPlanSummary, getPlanAlerts,
  getShipments, getPurchaseOrders,
} from '../api/api'
import type { PlanRun, MonthSummary } from '../api/types'

export default function DashboardPage() {
  const navigate = useNavigate()
  const [latestPlan, setLatestPlan] = useState<PlanRun | null>(null)
  const [coldPallets,    setColdPallets]    = useState(0)
  const [ambientPallets, setAmbientPallets] = useState(0)
  const [alertCount,     setAlertCount]     = useState(0)
  const [overStockCount, setOverStockCount] = useState(0)
  const [poCount,        setPoCount]        = useState(0)
  const [shipCount,      setShipCount]      = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPlanRuns().then(async r => {
      const plans = r.data
      if (plans.length === 0) { setLoading(false); return }
      const latest = plans[0]
      setLatestPlan(latest)

      const [sumRes, alertRes, poRes, shipRes] = await Promise.all([
        getPlanSummary(latest.plan_run_id),
        getPlanAlerts(latest.plan_run_id),
        getPurchaseOrders({ plan_run_id: latest.plan_run_id }),
        getShipments(),
      ])

      const months: MonthSummary[] = sumRes.data.months ?? []
      setColdPallets(months.reduce((s, m) => s + (m.cold_pallets ?? 0), 0))
      setAmbientPallets(months.reduce((s, m) => s + (m.ambient_pallets ?? 0) + (m.room_pallets ?? 0), 0))
      setAlertCount(alertRes.data.length)
      setOverStockCount(Math.max(0, months.reduce((s, m) => s + (m.alert_count ?? 0), 0) - alertRes.data.length))
      setPoCount(poRes.data.length)
      setShipCount(shipRes.data.filter(s => s.status !== 'DELIVERED').length)
    }).finally(() => setLoading(false))
  }, [])

  const planStatus = latestPlan?.status ?? ''
  const currentYm  = latestPlan?.run_ym  ?? '—'
  const ym         = currentYm !== '—' ? `${currentYm.slice(0, 4)}년 ${currentYm.slice(5, 7)}월` : '—'

  const planLabel =
    planStatus === 'APPROVED' ? '발주 검토 완료' :
    planStatus === 'RUNNING'  ? '발주 검토 진행 중' :
    planStatus === 'DRAFT'    ? '초안 작성 중' : '계획 없음'

  const coldContainers    = coldPallets    > 0 ? Math.ceil(coldPallets    / 22) : 0
  const ambientContainers = ambientPallets > 0 ? Math.ceil(ambientPallets / 22) : 0

  const pipeline = [
    {
      badge: 'M1', label: '발주·예측',
      sub: planStatus === 'APPROVED' ? '완료' : planStatus === 'RUNNING' ? '진행 중' : '—',
      active: !!planStatus && planStatus !== 'DRAFT',
      done:   planStatus === 'APPROVED',
      onClick: () => navigate('/forecast'),
    },
    {
      badge: 'M2', label: '스팟 선정',
      sub: planStatus === 'APPROVED' ? '진행 중' : '대기',
      active: planStatus === 'APPROVED',
      done:   false,
      onClick: () => navigate('/sku-board'),
    },
    {
      badge: 'M3', label: 'PO 생성',
      sub: poCount > 0 ? `${poCount}건` : '—',
      active: poCount > 0,
      done:   false,
      onClick: () => navigate('/purchase-orders'),
    },
    {
      badge: 'M4', label: '적재 구성',
      sub: '—',
      active: false, done: false,
      onClick: () => navigate('/pallet-plan'),
    },
    {
      badge: 'M5', label: '운송·통관',
      sub: shipCount > 0 ? `${shipCount}건` : '—',
      active: shipCount > 0,
      done:   false,
      onClick: () => navigate('/shipments'),
    },
    {
      badge: 'M6', label: '입고',
      sub: '—',
      active: false, done: false,
      onClick: undefined,
    },
  ]

  return (
    <div className="page">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">대시보드</h1>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
            {loading ? '로딩 중…' : `${ym} 회차 — ${planLabel}`}
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => navigate('/forecast')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
        >
          발주 계획 열기 <IconArrowRight size={15} />
        </button>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        {/* 예상 발주액 */}
        <div className="stat-tile" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 12, top: 12, opacity: 0.08 }}>
            <IconReceipt size={48} />
          </div>
          <div className="label">예상 발주액 (KRW)</div>
          <div className="value" style={{ fontSize: 30 }}>—</div>
          <div className="sub">공급가 등록 후 산출</div>
        </div>

        {/* 냉장 파렛트 */}
        <div className="stat-tile" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 12, top: 12, opacity: 0.1, color: '#3b82f6' }}>
            <IconSnowflake size={48} />
          </div>
          <div className="label">냉장 파렛트</div>
          <div className="value" style={{ fontSize: 30, color: 'var(--text-info)' }}>
            {loading ? '…' : coldPallets.toFixed(1)}
          </div>
          <div className="sub">
            예상 40ft 냉장 × {coldContainers || '—'}
          </div>
        </div>

        {/* 상온 파렛트 */}
        <div className="stat-tile" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 12, top: 12, opacity: 0.1, color: '#f59e0b' }}>
            <IconSun size={48} />
          </div>
          <div className="label">상온 파렛트</div>
          <div className="value" style={{ fontSize: 30, color: '#c2860a' }}>
            {loading ? '…' : ambientPallets.toFixed(1)}
          </div>
          <div className="sub">
            예상 40ft 상온 × {ambientContainers || '—'}
          </div>
        </div>

        {/* 결품 위험 */}
        <div className="stat-tile" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 12, top: 12, opacity: 0.1, color: '#ef4444' }}>
            <IconAlertTriangle size={48} />
          </div>
          <div className="label">결품 위험 SKU</div>
          <div className="value" style={{ fontSize: 30, color: alertCount > 0 ? 'var(--text-danger)' : undefined }}>
            {loading ? '…' : alertCount}
          </div>
          <div className="sub">
            타당성 위반 {alertCount} · 과재고 {overStockCount}
          </div>
        </div>
      </div>

      {/* ── Pipeline ───────────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>이번 회차 파이프라인</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
            M1(레귤러)·M2(스팟) → M3(PO) → M4(파렛트) → M5(운송) → M6(입고)
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
          {pipeline.map((step, i) => (
            <button
              key={step.badge}
              onClick={step.onClick}
              style={{
                textAlign: 'left',
                background: step.active ? (step.done ? 'var(--bg-success)' : '#eff6ff') : 'var(--bg-secondary)',
                border: `0.5px solid ${step.active ? (step.done ? 'var(--text-success)' : 'var(--text-info)') : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
                cursor: step.onClick ? 'pointer' : 'default',
                fontFamily: 'var(--font)',
                transition: 'opacity 0.1s',
              }}
            >
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 4 }}>
                {step.badge}
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: step.active ? (step.done ? 'var(--text-success)' : 'var(--text-info)') : 'var(--text-secondary)' }}>
                {step.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{step.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Info boxes ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>컨테이너 가이드</div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.7 }}>
            40ft 냉장은 PLT당 $40로 20ft($50)보다 유리. 상온 SKU를 냉장 빈 슬롯에 백필해 자투리를 회수.
          </p>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>평활화 토글</div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.7 }}>
            SKU 주기는 유지하되 시작 월을 분산(LPT). 월 결제액 변동을 크게 낮춤. 냉장 자투리와 균형 필요.
          </p>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>타당성 규칙</div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 6px', lineHeight: 1.7 }}>
            R + L ≤ 유통기한. 생주류는 사실상 월/격월 사이클.
          </p>
          <div style={{ fontSize: 12, fontWeight: 600, color: alertCount > 0 ? 'var(--text-danger)' : 'var(--text-success)' }}>
            위반 {alertCount} SKU
          </div>
        </div>
      </div>
    </div>
  )
}
