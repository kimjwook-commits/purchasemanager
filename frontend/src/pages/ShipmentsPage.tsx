import { useEffect, useState } from 'react'
import {
  IconPackage, IconAnchor, IconTruck, IconShieldCheck,
  IconFileCheck, IconBuildingWarehouse, IconCircleCheck,
  IconCircle, IconLoader, IconPlus, IconAlertTriangle,
} from '@tabler/icons-react'
import { getShipments, getShipment } from '../api/api'
import type { ShipmentListItem, ShipmentDetail } from '../api/types'
import dayjs from 'dayjs'

const STEPS = [
  { key: 'departure',         label: '선적',   Icon: IconPackage },
  { key: 'arrival',           label: '도착',   Icon: IconAnchor },
  { key: 'inland',            label: '이송',   Icon: IconTruck },
  { key: 'inspection',        label: '검사',   Icon: IconShieldCheck },
  { key: 'customs_clearance', label: '통관',   Icon: IconFileCheck },
  { key: 'received',          label: '입고',   Icon: IconBuildingWarehouse },
]

const STATUS_CHIP: Record<string, string> = {
  CREATED:    'chip-default',
  IN_TRANSIT: 'chip-info',
  ARRIVED:    'chip-warning',
  INSPECTING: 'chip-warning',
  CLEARED:    'chip-success',
  RECEIVED:   'chip-success',
  CANCELLED:  'chip-danger',
}

const DOCS_CHECKLIST = [
  { group: '도착 · 공통 서류', items: [
    { key: 'invoice',    label: '인보이스 수령·등록' },
    { key: 'packing',   label: '패킹리스트 수령·등록' },
    { key: 'bl',        label: 'B/L 수령·등록' },
  ]},
  { group: '보세이송 준비', items: [
    { key: 'do',        label: 'D/O 등록·결부' },
    { key: 'bl2',       label: 'B/L 수령 등록' },
  ]},
  { group: '검사 전 준비', items: [
    { key: 'sample',    label: '항목별 검사 수량 확정' },
    { key: 'cert',      label: '위생증명서 수령' },
  ]},
  { group: '통관 전 준비', items: [
    { key: 'inspect_cert', label: '검체증 등록' },
    { key: 'import_cert',  label: '수입고시 등록' },
    { key: 'rcep',         label: 'RCEP 원산지 적용' },
    { key: 'po_export',    label: '수출자별 P/O' },
  ]},
]

function StepItem({ step, dateVal, isCurrent }: {
  step: typeof STEPS[0]; dateVal?: string | null; isCurrent: boolean
}) {
  const done = !!dateVal
  const Icon = step.Icon
  return (
    <div style={{
      flex: 1, minWidth: 56, position: 'relative', textAlign: 'center',
      borderRadius: 'var(--radius-md)', padding: '10px 4px 8px',
      border: isCurrent ? '2px solid var(--border-info)' : '0.5px solid var(--border-tertiary)',
      background: isCurrent ? 'var(--bg-info)' : undefined,
    }}>
      {isCurrent && (
        <div style={{
          position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)',
          fontSize: 9, background: 'var(--text-info)', color: '#fff',
          padding: '1px 6px', borderRadius: 6,
        }}>NOW</div>
      )}
      <div style={{
        width: 30, height: 30, borderRadius: '50%', margin: '0 auto 6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: done ? 'var(--text-info)' : undefined,
        border: !done ? '1px solid var(--border-secondary)' : undefined,
      }}>
        <Icon size={16} color={done ? '#fff' : 'var(--text-tertiary)'} />
      </div>
      <div style={{ fontSize: 11, fontWeight: done ? 500 : 400, color: done ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
        {step.label}
      </div>
      <div style={{ fontSize: 11, color: done ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
        {dateVal ? dayjs(dateVal).format('MM-DD') : '—'}
      </div>
    </div>
  )
}

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<ShipmentListItem[]>([])
  const [selected, setSelected] = useState<ShipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    getShipments()
      .then(r => {
        setShipments(r.data)
        if (r.data.length > 0) loadDetail(r.data[0].shipment_id)
      })
      .finally(() => setLoading(false))
  }, [])

  const loadDetail = (id: number) => {
    setDetailLoading(true)
    getShipment(id)
      .then(r => setSelected(r.data))
      .finally(() => setDetailLoading(false))
  }

  const toggleCheck = (key: string) =>
    setChecked(prev => ({ ...prev, [key]: !prev[key] }))

  const stepDates: Record<string, string | null | undefined> = selected ? {
    departure:         selected.departure_date,
    arrival:           selected.arrival_date,
    inland:            selected.inland_date,
    inspection:        selected.inspection_date,
    customs_clearance: selected.customs_clearance_date,
    received:          selected.received_date,
  } : {}

  const getCurrentStep = (s: ShipmentDetail) => {
    if (!s.departure_date) return 'departure'
    if (!s.arrival_date) return 'arrival'
    if (!s.inland_date) return 'inland'
    if (!s.inspection_date) return 'inspection'
    if (!s.customs_clearance_date) return 'customs_clearance'
    return 'received'
  }

  const currentStep = selected ? getCurrentStep(selected) : ''
  const pendingDocsCount = DOCS_CHECKLIST.flatMap(g => g.items).filter(i => !checked[i.key]).length

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">모듈 5 · 이송·검사·통관</h1>
        <button className="btn btn-info"><IconPlus size={13} /> 선박 추가</button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: shipment list */}
        <div style={{ flex: '0 0 180px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>로딩 중…</div>}
          {shipments.map(s => {
            const isSel = selected?.shipment_id === s.shipment_id
            return (
              <div
                key={s.shipment_id}
                onClick={() => loadDetail(s.shipment_id)}
                style={{
                  background: 'var(--bg-primary)',
                  border: isSel ? '2px solid var(--border-info)' : '0.5px solid var(--border-tertiary)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500 }}>V-{String(s.shipment_id).padStart(3, '0')}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{s.container_count} CNT</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {s.departure_date ?? '—'} → {s.arrival_date ?? '—'}
                </div>
                <div style={{ marginTop: 4 }}>
                  <span className={`chip ${STATUS_CHIP[s.status] ?? 'chip-default'}`}>{s.status}</span>
                </div>
              </div>
            )
          })}
          {!loading && shipments.length === 0 && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
              선적 없음. 모듈 4에서 팔레트 확정 후 선박을 추가하세요.
            </div>
          )}
        </div>

        {/* Right: detail */}
        {detailLoading ? (
          <div style={{ flex: 1, color: 'var(--text-tertiary)', fontSize: 12 }}>로딩 중…</div>
        ) : selected ? (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Schedule card */}
            <div className="card">
              <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ border: '0.5px solid var(--border-secondary)', borderRadius: 'var(--radius-md)', padding: '6px 12px', fontWeight: 500 }}>
                  V-{String(selected.shipment_id).padStart(3, '0')}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
                {STEPS.map(step => (
                  <div key={step.key}>
                    <div className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <step.Icon size={12} /> {step.label}
                    </div>
                    <div style={{ border: '0.5px solid var(--border-secondary)', borderRadius: 'var(--radius-md)', padding: '7px 10px', fontSize: 13, color: stepDates[step.key] ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                      {stepDates[step.key] ? dayjs(stepDates[step.key]!).format('YYYY-MM-DD') : '년. 월. 일.'}
                    </div>
                  </div>
                ))}
              </div>

              {/* Stepper */}
              <div style={{ borderTop: '0.5px solid var(--border-tertiary)', paddingTop: 14 }}>
                <div className="stepper">
                  {STEPS.map((step, idx) => (
                    <>
                      {idx > 0 && (
                        <div
                          key={`conn-${idx}`}
                          className="step-connector"
                          style={{ background: stepDates[STEPS[idx - 1].key] ? 'var(--text-info)' : 'var(--border-tertiary)' }}
                        />
                      )}
                      <StepItem
                        key={step.key}
                        step={step}
                        dateVal={stepDates[step.key]}
                        isCurrent={step.key === currentStep}
                      />
                    </>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 10 }}>
                  현재 단계: <span style={{ color: 'var(--text-info)', fontWeight: 500 }}>
                    {STEPS.find(s => s.key === currentStep)?.label ?? '완료'}
                  </span>
                </div>
              </div>
            </div>

            {/* Customs checklist */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontWeight: 500 }}>
                  V-{String(selected.shipment_id).padStart(3, '0')} · 통관 진행
                </span>
              </div>
              {pendingDocsCount > 0 && (
                <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                  <IconAlertTriangle size={13} style={{ flexShrink: 0 }} />
                  미완 서류 {pendingDocsCount}건 대기 — 완료 후 다음 단계로 진행됩니다.
                </div>
              )}

              {DOCS_CHECKLIST.map(group => {
                const allDone = group.items.every(i => checked[i.key])
                return (
                  <div key={group.group}>
                    <div style={{ fontSize: 12, fontWeight: 500, margin: '14px 0 6px', display: 'flex', alignItems: 'center', gap: 8, color: allDone ? 'var(--text-success)' : 'var(--text-secondary)' }}>
                      {allDone ? <IconCircleCheck size={14} /> : <IconLoader size={14} />}
                      {group.group}
                    </div>
                    {group.items.map(item => {
                      const done = checked[item.key]
                      return (
                        <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: `0.5px solid ${done ? 'var(--border-tertiary)' : 'var(--border-warning)'}`, borderRadius: 'var(--radius-md)', marginBottom: 6 }}>
                          {done
                            ? <IconCircleCheck size={14} color="var(--text-success)" />
                            : <IconCircle size={14} color="var(--text-warning)" />
                          }
                          <span style={{ flex: 1, fontSize: 12 }}>{item.label}</span>
                          <button
                            className={`btn ${done ? '' : 'btn-info'}`}
                            style={{ fontSize: 11, padding: '3px 12px' }}
                            onClick={() => toggleCheck(item.key)}
                          >
                            {done ? '완료' : '등록'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="card" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13, minHeight: 200 }}>
            선적을 선택하세요.
          </div>
        )}
      </div>
    </div>
  )
}
