import { useEffect, useMemo, useState } from 'react'
import {
  IconPlus, IconCopy, IconAlertTriangle, IconShoppingCart,
  IconSnowflake, IconSun, IconChevronRight,
} from '@tabler/icons-react'
import {
  getKanbanBoard, getPlanRuns, moveKanbanLine, createPOsFromPlan,
  getExporters,
} from '../api/api'
import type { KanbanLine, PlanRun, Exporter } from '../api/types'
import { useSearchParams } from 'react-router-dom'

// ── 타입 정의 ────────────────────────────────────────────────────────────────
type CardStatus = 'scheduled' | 'qty_requested' | 'confirmed' | 'backlog'
type CardType   = 'spot' | 'pb' | 'supplies'

interface SpotCard {
  plan_line_id: number
  product_id:   number
  product_code: string | null
  name_ja:      string | null
  tier_code:    string | null
  order_ym:     string
  exporter_id:  number | null
  exporter_code: string | null
  order_boxes:  number
  order_layers: number
  alert:        string | null
  po_id:        number | null
  po_no:        string | null
  status:       CardStatus
  type:         CardType
  kr_qty:       number | null
}

// ── 상수 ────────────────────────────────────────────────────────────────────
const TYPE_META: Record<CardType, { label: string; cls: string }> = {
  spot:     { label: '스팟',  cls: 'chip-info'    },
  pb:       { label: 'PB',    cls: 'chip-warning'  },
  supplies: { label: '비품',  cls: 'chip-default'  },
}

const STATUS_META: Record<CardStatus, { label: string; cls: string }> = {
  backlog:       { label: '예정',      cls: 'chip-default' },
  scheduled:     { label: '일정확정',  cls: 'chip-info'    },
  qty_requested: { label: '수량요청',  cls: 'chip-warning' },
  confirmed:     { label: '확정',      cls: 'chip-success' },
}

const NEXT_ACTION: Record<CardStatus, { label: string; persona: string; target: string } | null> = {
  backlog:       { label: '일정 확정 (JP)', persona: 'JP', target: 'scheduled'     },
  scheduled:     { label: '수량 입력 → 요청', persona: 'KR', target: 'qty_requested' },
  qty_requested: { label: '수량 확정 (JP)', persona: 'JP', target: 'confirmed'     },
  confirmed:     null,
}

const PERSONA_STYLE: Record<string, React.CSSProperties> = {
  JP: { background: '#e0f2fe', color: '#0369a1', border: '0.5px solid #7dd3fc' },
  KR: { background: '#fef3c7', color: '#92400e', border: '0.5px solid #fcd34d' },
}

// ── API column → CardStatus マッピング ───────────────────────────────────────
function colToStatus(col: string): CardStatus {
  if (col === 'scheduled')        return 'scheduled'
  if (col === 'pending_approval') return 'qty_requested'
  if (col === 'confirmed')        return 'confirmed'
  return 'backlog'
}

// col forward mapping for moveKanbanLine
const STATUS_TO_COL: Record<string, string> = {
  backlog:       'scheduled',
  scheduled:     'pending_approval',
  qty_requested: 'confirmed',
  confirmed:     'confirmed',
}

// infer card type from product_code prefix (stub — real impl may use a type field)
function inferType(code: string | null): CardType {
  if (!code) return 'spot'
  if (code.startsWith('PB')) return 'pb'
  if (code.startsWith('S'))  return 'supplies'
  return 'spot'
}

// ── 단일 카드 컴포넌트 ───────────────────────────────────────────────────────
function SpotCardItem({
  card, planRunId, onAdvance,
}: {
  card: SpotCard
  planRunId: number
  onAdvance: () => void
}) {
  const [advancing, setAdvancing] = useState(false)
  const [holding,   setHolding]   = useState(false)

  const typeMeta   = TYPE_META[card.type]
  const statusMeta = STATUS_META[card.status]
  const nextAction = NEXT_ACTION[card.status]

  const isCold    = card.tier_code === 'cold'
  const isAmb     = card.tier_code === 'ambient'
  const isConfirmed = card.status === 'confirmed'

  const handleAdvance = async () => {
    if (!nextAction) return
    setAdvancing(true)
    try {
      await moveKanbanLine(planRunId, card.plan_line_id, STATUS_TO_COL[card.status])
      onAdvance()
    } catch { /* ignore */ }
    finally { setAdvancing(false) }
  }

  const sourceLine = [card.exporter_code, card.product_code].filter(Boolean).join(' · ')

  return (
    <div style={{
      background: '#fff',
      border: `0.5px solid ${isConfirmed ? 'var(--text-success)' : 'var(--border)'}`,
      borderLeft: `3px solid ${
        isConfirmed                   ? 'var(--text-success)' :
        card.status === 'qty_requested' ? 'var(--text-warning)' :
        card.status === 'scheduled'     ? 'var(--text-info)'    :
        'var(--border)'
      }`,
      borderRadius: 'var(--radius-md)',
      padding: '10px 12px',
      marginBottom: 8,
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
        <span className={`chip ${typeMeta.cls}`} style={{ fontSize: 10, padding: '1px 6px' }}>
          {typeMeta.label}
        </span>
        {/* tier icon */}
        <span style={{ display: 'inline-flex', alignItems: 'center', width: 16, height: 16,
          borderRadius: 4, background: isCold ? '#dbeafe' : isAmb ? '#dcfce7' : '#fef9c3',
          justifyContent: 'center' }}>
          {isCold
            ? <IconSnowflake size={9} color="#1d4ed8" />
            : <IconSun size={9} color="#ca8a04" />}
        </span>
        <span className={`chip ${statusMeta.cls}`} style={{ fontSize: 10, padding: '1px 6px' }}>
          {statusMeta.label}
        </span>
        <span style={{ flex: 1 }} />
        <button
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-tertiary)' }}
          onClick={() => navigator.clipboard?.writeText(card.product_code ?? '')}
        >
          <IconCopy size={12} />
        </button>
      </div>

      {/* Product name */}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
        {card.name_ja ?? card.product_code ?? '—'}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 8 }}>
        {sourceLine}
      </div>

      {/* Quantity panes */}
      {card.status !== 'backlog' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 2 }}>요청 (KR)</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {card.kr_qty != null ? `${card.kr_qty} CTN` : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
            </div>
          </div>
          <div style={{ background: isConfirmed ? '#f0fdf4' : 'var(--bg-secondary)', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginBottom: 2 }}>확정 (JP)</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: isConfirmed ? 'var(--text-success)' : undefined }}>
              {isConfirmed ? `${card.order_boxes} CTN` : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
            </div>
          </div>
        </div>
      )}

      {/* Alert */}
      {card.alert && (
        <div style={{ fontSize: 11, color: 'var(--text-warning)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <IconAlertTriangle size={11} /> {card.alert}
        </div>
      )}

      {/* PO link */}
      {card.po_no && (
        <div style={{ fontSize: 11, color: 'var(--text-success)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
          <IconShoppingCart size={11} /> {card.po_no}
        </div>
      )}

      {/* Action row */}
      {nextAction && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>다음:</span>
          <span style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 700,
            ...PERSONA_STYLE[nextAction.persona],
          }}>
            {nextAction.persona}
          </span>
          <button
            className="btn btn-info"
            style={{ fontSize: 11, padding: '3px 10px', flex: 1 }}
            onClick={handleAdvance}
            disabled={advancing}
          >
            {advancing ? '…' : nextAction.label}
          </button>
          <button
            className="btn"
            style={{ fontSize: 11, padding: '3px 8px', opacity: holding ? 1 : 0.7 }}
            onClick={() => setHolding(v => !v)}
          >
            {holding ? '보류 중' : '보류'}
          </button>
        </div>
      )}

      {isConfirmed && (
        <div style={{ fontSize: 11, color: 'var(--text-success)', textAlign: 'center', marginTop: 4 }}>
          ✓ PO 생성으로 합류 예정
        </div>
      )}
    </div>
  )
}

// ── 메인 ─────────────────────────────────────────────────────────────────────
export default function KanbanPage() {
  const [searchParams] = useSearchParams()
  const [plans,      setPlans]      = useState<PlanRun[]>([])
  const [exporters,  setExporters]  = useState<Exporter[]>([])
  const [selectedId, setSelectedId] = useState<number | undefined>()
  const [cards,      setCards]      = useState<SpotCard[]>([])
  const [loading,    setLoading]    = useState(false)
  const [creatingPO, setCreatingPO] = useState(false)

  // filter state
  const [exporterTab, setExporterTab] = useState<number | 'all'>('all')
  const [typeFilter,  setTypeFilter]  = useState<CardType | 'all'>('all')

  useEffect(() => {
    Promise.all([getPlanRuns(), getExporters()]).then(([pr, ex]) => {
      setPlans(pr.data)
      setExporters(ex.data)
      const paramId = searchParams.get('plan_run_id')
      if (paramId) setSelectedId(Number(paramId))
      else if (pr.data.length > 0) setSelectedId(pr.data[0].plan_run_id)
    })
  }, [])

  const loadCards = () => {
    if (!selectedId) return
    setLoading(true)
    getKanbanBoard(selectedId).then(r => {
      const flat: SpotCard[] = []
      r.data.columns.forEach(col => {
        col.lines.forEach((line: KanbanLine) => {
          flat.push({
            plan_line_id:  line.plan_line_id,
            product_id:    line.product_id,
            product_code:  line.product_code,
            name_ja:       line.name_ja,
            tier_code:     line.tier_code,
            order_ym:      line.order_ym,
            exporter_id:   line.exporter_id,
            exporter_code: line.exporter_code,
            order_boxes:   line.order_boxes,
            order_layers:  line.order_layers,
            alert:         line.alert,
            po_id:         line.po_id,
            po_no:         line.po_no,
            status:        colToStatus(col.column),
            type:          inferType(line.product_code),
            kr_qty:        col.column === 'pending_approval' || col.column === 'confirmed' ? line.order_boxes : null,
          })
        })
      })
      setCards(flat)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { loadCards() }, [selectedId])

  // 수출자 탭 목록
  const exporterTabs = useMemo(() => {
    const ids = new Set(cards.map(c => c.exporter_id).filter(Boolean))
    return exporters.filter(e => ids.has(e.exporter_id))
  }, [cards, exporters])

  // 필터 적용
  const filteredCards = useMemo(() => cards.filter(c => {
    if (exporterTab !== 'all' && c.exporter_id !== exporterTab) return false
    if (typeFilter  !== 'all' && c.type !== typeFilter)           return false
    return true
  }), [cards, exporterTab, typeFilter])

  // 열 그룹화: 미배정 + 연월별
  const columns = useMemo(() => {
    const backlogCards = filteredCards.filter(c => c.status === 'backlog')
    const monthMap = new Map<string, SpotCard[]>()

    filteredCards
      .filter(c => c.status !== 'backlog')
      .forEach(c => {
        if (!monthMap.has(c.order_ym)) monthMap.set(c.order_ym, [])
        monthMap.get(c.order_ym)!.push(c)
      })

    const monthCols = [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, cs]) => {
        const yy = ym.slice(2, 4)
        const mm = ym.slice(5, 7)
        const label = `${yy}년 ${mm}월`
        const confirmedBoxes = cs.filter(c => c.status === 'confirmed').reduce((s, c) => s + c.order_boxes, 0)
        return { ym, label, cards: cs, confirmedBoxes }
      })

    return { backlogCards, monthCols }
  }, [filteredCards])

  const currentPlan = plans.find(p => p.plan_run_id === selectedId)

  const handleCreatePOs = async () => {
    if (!selectedId) return
    setCreatingPO(true)
    try { await createPOsFromPlan(selectedId); loadCards() }
    finally { setCreatingPO(false) }
  }

  const boardCount = cards.length
  const exporterName = exporterTab !== 'all'
    ? (exporters.find(e => e.exporter_id === exporterTab)?.code ?? '')
    : '전체'

  return (
    <div className="page">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">스팟 선정</h1>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
            모듈 2 · 컵업 상태기계로 카드를 확정 → PO로 합류
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" style={{ fontSize: 12 }}>
            <IconPlus size={13} /> 카드 추가
          </button>
          {currentPlan?.status === 'APPROVED' && (
            <button className="btn btn-primary" onClick={handleCreatePOs} disabled={creatingPO} style={{ fontSize: 12 }}>
              {creatingPO ? '생성 중…' : '확정분 PO로 보내기'} <IconChevronRight size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── 계획 선택 + 수출자 탭 ────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        {plans.length > 1 && (
          <select className="pm-select" value={selectedId ?? ''} onChange={e => setSelectedId(Number(e.target.value))}>
            {plans.map(p => (
              <option key={p.plan_run_id} value={p.plan_run_id}>
                {p.run_ym} v{p.version}
              </option>
            ))}
          </select>
        )}

        {/* Exporter board tabs */}
        <div style={{
          display: 'flex', background: '#fff', border: '0.5px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: '3px 4px', gap: 2,
        }}>
          <button
            onClick={() => setExporterTab('all')}
            style={{
              padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: exporterTab === 'all' ? 'var(--bg-info)' : 'transparent',
              color: exporterTab === 'all' ? 'var(--text-info)' : 'var(--text-secondary)',
              fontSize: 12, fontFamily: 'var(--font)', fontWeight: exporterTab === 'all' ? 600 : 400,
            }}
          >
            전체 보드 <span style={{ fontSize: 11, opacity: 0.7 }}>{boardCount}</span>
          </button>
          {exporterTabs.map(ex => {
            const cnt = cards.filter(c => c.exporter_id === ex.exporter_id).length
            return (
              <button
                key={ex.exporter_id}
                onClick={() => setExporterTab(ex.exporter_id)}
                style={{
                  padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: exporterTab === ex.exporter_id ? 'var(--bg-info)' : 'transparent',
                  color: exporterTab === ex.exporter_id ? 'var(--text-info)' : 'var(--text-secondary)',
                  fontSize: 12, fontFamily: 'var(--font)', fontWeight: exporterTab === ex.exporter_id ? 600 : 400,
                }}
              >
                {ex.code} 보드 <span style={{ fontSize: 11, opacity: 0.7 }}>{cnt}</span>
              </button>
            )
          })}
        </div>

        {/* Type filter chips */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
          {(['all', 'spot', 'pb', 'supplies'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              style={{
                padding: '4px 12px', borderRadius: 20, border: '0.5px solid var(--border)',
                background: typeFilter === t ? 'var(--bg-secondary)' : '#fff',
                fontWeight: typeFilter === t ? 600 : 400,
                color: typeFilter === t ? 'var(--text-primary)' : 'var(--text-tertiary)',
                fontSize: 12, fontFamily: 'var(--font)', cursor: 'pointer',
              }}
            >
              {t === 'all' ? '전체' : t === 'spot' ? '스팟' : t === 'pb' ? 'PB' : '비품'}
            </button>
          ))}
        </div>

        {/* Status summary */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 11, color: 'var(--text-tertiary)' }}>
          <span>확정 <strong style={{ color: 'var(--text-success)' }}>{filteredCards.filter(c => c.status === 'confirmed').length}</strong></span>
          <span>수량요청 <strong style={{ color: 'var(--text-warning)' }}>{filteredCards.filter(c => c.status === 'qty_requested').length}</strong></span>
          <span>대기 <strong>{filteredCards.filter(c => c.status === 'scheduled' || c.status === 'backlog').length}</strong></span>
        </div>
      </div>

      {/* ── 상태 흐름 표시 ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        background: '#fff', border: '0.5px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: '7px 14px',
        marginBottom: 12, fontSize: 11, overflowX: 'auto',
      }}>
        <span style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>상태 흐름:</span>
        {[
          { label: '예정', cls: 'chip-default', right: null },
          { label: '일정확정·JP', cls: 'chip-info', right: 'JP' },
          { label: '수량요청·KR-JP', cls: 'chip-warning', right: null },
          { label: '확정·JP', cls: 'chip-success', right: 'JP' },
        ].map((s, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
            {i > 0 && <span style={{ color: 'var(--text-tertiary)' }}>→</span>}
            <span className={`chip ${s.cls}`} style={{ fontSize: 10, padding: '2px 7px' }}>{s.label}</span>
          </span>
        ))}
        <span style={{ color: 'var(--text-tertiary)', marginLeft: 8, whiteSpace: 'nowrap' }}>
          · PB는 일정 게이트 생략 · 비품은 M4 적재 단계에서 수량 확정
        </span>
      </div>

      {/* ── Kanban board ─────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>로딩 중…</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
          {/* 미배정 열 */}
          <div style={{ minWidth: 220, width: 220, flexShrink: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8, padding: '0 2px',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>미배정</span>
              <span className="chip chip-default" style={{ fontSize: 11 }}>
                {columns.backlogCards.length}
              </span>
            </div>
            {columns.backlogCards.length === 0 ? (
              <div style={{
                background: '#fff', border: '0.5px dashed var(--border)', borderRadius: 'var(--radius-md)',
                padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12,
              }}>
                카드 없음
              </div>
            ) : columns.backlogCards.map(c => (
              <SpotCardItem key={c.plan_line_id} card={c} planRunId={selectedId!} onAdvance={loadCards} />
            ))}
          </div>

          {/* 월별 열 */}
          {columns.monthCols.map(col => (
            <div key={col.ym} style={{ minWidth: 240, width: 240, flexShrink: 0 }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 8, padding: '0 2px',
              }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{col.label}</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span className="chip chip-default" style={{ fontSize: 11 }}>{col.cards.length}</span>
                  {col.confirmedBoxes > 0 && (
                    <span className="chip chip-success" style={{ fontSize: 11 }}>
                      확정 {col.confirmedBoxes} CTN
                    </span>
                  )}
                </div>
              </div>
              {col.cards.length === 0 ? (
                <div style={{
                  background: '#fff', border: '0.5px dashed var(--border)', borderRadius: 'var(--radius-md)',
                  padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12,
                }}>
                  카드 없음
                </div>
              ) : col.cards.map(c => (
                <SpotCardItem key={c.plan_line_id} card={c} planRunId={selectedId!} onAdvance={loadCards} />
              ))}
            </div>
          ))}

          {/* 빈 달 채우기 (최소 4컬럼 보장) */}
          {columns.monthCols.length === 0 && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12, paddingTop: 40 }}>
              {!selectedId ? '계획을 선택하세요.' : '스팟 카드가 없습니다.'}
            </div>
          )}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
        ※ 카드를 컵업 간 드래그해 월을 변경하세요. 확정(CONFIRMED) 카드는 잠겨있으며, 일정확정/수량요청 카드를 미배정으로 되돌리면 일정이 해제되어 DRAFT로 돌아갑니다.
      </p>
    </div>
  )
}
