import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  IconGripVertical, IconTrash, IconDownload, IconSnowflake, IconSun,
  IconPlus, IconCircleCheck, IconRefresh,
} from '@tabler/icons-react'
import { getPurchaseOrders, getPoLines, generateContainerPlan, confirmContainerPlan } from '../api/api'
import type { PurchaseOrder, PoLine, PackingPlanResult } from '../api/types'

// ── 로컬 타입 ────────────────────────────────────────────────────────────────
interface Pallet {
  id: string
  po_line_id: number
  product_code: string | null
  name_ja: string | null
  exporter_code: string | null
  tier_code: string
  boxes: number
  max_boxes: number
  weight_kg: number
}

// 슬롯 = null(빈칸) | string[](팔레트 ID 배열 — 혼재 시 2+개)
interface Container {
  id: string
  ctype: '40RF' | '40DRY' | '20RF' | '20DRY'
  label: string
  exporter_code: string | null
  tier_code: string
  max_pallets: number
  max_weight_t: number
  slots: (string[] | null)[]
}

// ── 상수 ────────────────────────────────────────────────────────────────────
const CSPEC = {
  '40RF':  { max_pallets: 20, max_weight_t: 26.0, tier: 'cold',    disp: "40' RF (냉장)",  cost_usd: 3000 },
  '40DRY': { max_pallets: 22, max_weight_t: 28.0, tier: 'ambient', disp: "40' DRY (상온)", cost_usd: 2200 },
  '20RF':  { max_pallets: 10, max_weight_t: 13.0, tier: 'cold',    disp: "20' RF (냉장)",  cost_usd: 2000 },
  '20DRY': { max_pallets: 10, max_weight_t: 14.0, tier: 'ambient', disp: "20' DRY (상온)", cost_usd: 1500 },
} as const

const BOXES_PER_PALLET = 39
const KG_PER_BOX       = 12.6

// 겨울 시즌 (12·1·2월): 냉장 품목 → DRY 컨테이너 허용
const WINTER_MONTHS = [12, 1, 2]

function tierLabel(code: string) {
  if (code === 'cold') return '냉장'
  return '상온'
}

// PO 라인 → 팔레트 목록 변환
function buildPallets(lines: PoLine[], exporterCode: string | null): Pallet[] {
  const result: Pallet[] = []
  lines.forEach((line, gi) => {
    const total = line.order_boxes
    const full  = Math.floor(total / BOXES_PER_PALLET)
    const rem   = total % BOXES_PER_PALLET
    const tier  = line.tier_code ?? 'cold'
    for (let i = 0; i < full; i++) {
      result.push({
        id: `p${gi + 1}-${String(i + 1).padStart(3, '0')}`,
        po_line_id: line.po_line_id,
        product_code: line.product_code,
        name_ja: line.name_ja,
        exporter_code: exporterCode,
        tier_code: tier,
        boxes: BOXES_PER_PALLET,
        max_boxes: BOXES_PER_PALLET,
        weight_kg: Math.round(BOXES_PER_PALLET * KG_PER_BOX),
      })
    }
    if (rem > 0) {
      result.push({
        id: `p${gi + 1}-${String(full + 1).padStart(3, '0')}`,
        po_line_id: line.po_line_id,
        product_code: line.product_code,
        name_ja: line.name_ja,
        exporter_code: exporterCode,
        tier_code: tier,
        boxes: rem,
        max_boxes: BOXES_PER_PALLET,
        weight_kg: Math.round(rem * KG_PER_BOX),
      })
    }
  })
  return result
}

// 빈 슬롯 없이 앞쪽으로 압착 (이동/제거 후 호출)
function compactSlots(slots: (string[] | null)[]): (string[] | null)[] {
  const occupied = slots.filter((s): s is string[] => s !== null && s.length > 0)
  const result: (string[] | null)[] = new Array(slots.length).fill(null)
  occupied.forEach((s, i) => { result[i] = s })
  return result
}

// ── PDF 패킹리스트 HTML 빌더 ─────────────────────────────────────────────────
function buildPackingListHTML(
  containers: Container[],
  palletMap: Map<string, Pallet>,
  order: PurchaseOrder | null,
): string {
  const date = new Date().toLocaleDateString('ko-KR')
  const totalPallets = containers.reduce((s, c) => s + c.slots.flatMap(sl => sl ?? []).length, 0)
  const totalBoxes   = containers.reduce((s, c) =>
    s + c.slots.flatMap(sl => sl ?? []).reduce((ss, pid) => ss + (palletMap.get(pid)?.boxes ?? 0), 0), 0)

  const containerBlocks = containers.map((c, ci) => {
    const allPids    = c.slots.flatMap(sl => sl ?? [])
    const palletCnt  = allPids.length
    const occupiedSl = c.slots.filter(s => s && s.length > 0).length
    const totalWkg   = allPids.reduce((s, pid) => s + (palletMap.get(pid)?.weight_kg ?? 0), 0)
    const spec       = CSPEC[c.ctype]
    const isCold     = c.tier_code === 'cold'
    const hdrBg      = isCold ? '#dbeafe' : '#fef3c7'

    const rows = c.slots.flatMap((pids, slotIdx) => {
      if (!pids || pids.length === 0) return []
      return pids.map((pid, pidIdx) => {
        const p = palletMap.get(pid)
        if (!p) return ''
        const slotCell = pidIdx === 0
          ? `<td rowspan="${pids.length}" style="text-align:center;vertical-align:middle;font-weight:700">${slotIdx + 1}</td>`
          : ''
        const isMerged = pids.length > 1
        const rowStyle = isMerged ? 'background:#faf5ff;color:#6b21a8' : ''
        const tierColor = p.tier_code === 'cold' ? '#1d4ed8' : '#92400e'
        return `<tr style="${rowStyle}">
          ${slotCell}
          <td style="font-family:monospace;font-size:8pt;color:#666">${p.id}</td>
          <td>${p.product_code ?? '—'}</td>
          <td style="max-width:120pt">${p.name_ja ?? '—'}</td>
          <td style="text-align:center;color:${tierColor}">${p.tier_code === 'cold' ? '냉장' : '상온'}</td>
          <td style="text-align:right">${p.boxes}</td>
          <td style="text-align:right">${p.weight_kg.toLocaleString()}</td>
        </tr>`
      })
    }).join('')

    return `<div style="page-break-inside:avoid;margin-bottom:16pt">
      <table>
        <thead>
          <tr>
            <th colspan="7" style="background:${hdrBg};text-align:left;padding:5pt 7pt">
              컨테이너 #${ci + 1} — ${spec.disp} (${isCold ? '냉장' : '상온'})
              &nbsp;|&nbsp; 슬롯 ${occupiedSl}/${c.max_pallets}
              &nbsp;|&nbsp; 팔레트 ${palletCnt}개
              &nbsp;|&nbsp; 총 ${(totalWkg / 1000).toFixed(2)} t
              ${c.exporter_code ? `&nbsp;|&nbsp; ${c.exporter_code}` : ''}
            </th>
          </tr>
          <tr>
            <th style="width:30pt">슬롯</th>
            <th style="width:70pt">팔레트 ID</th>
            <th style="width:65pt">품목코드</th>
            <th>제품명 (일문)</th>
            <th style="width:36pt">온도</th>
            <th style="width:40pt">박스(C)</th>
            <th style="width:52pt">중량(kg)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Packing List — ${order?.po_no ?? ''}</title>
  <style>
    @page { size: A4; margin: 12mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Malgun Gothic','Noto Sans JP','Hiragino Sans',sans-serif; font-size: 10pt; color: #111; margin: 0; }
    h1 { font-size: 17pt; font-weight: 800; letter-spacing: 2pt; margin: 0 0 8pt; }
    .info { width: 100%; border-collapse: collapse; margin-bottom: 10pt; font-size: 9.5pt; }
    .info th { width: 70pt; background: #f4f4f4; padding: 3pt 5pt; border: 0.4pt solid #bbb; text-align: left; }
    .info td { padding: 3pt 5pt; border: 0.4pt solid #bbb; }
    .summary { background: #f8f8f8; border: 0.4pt solid #ccc; border-radius: 3pt; padding: 5pt 9pt; margin-bottom: 10pt; font-size: 9.5pt; }
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
    th, td { border: 0.4pt solid #aaa; padding: 3pt 4pt; }
    th { background: #f0f0f0; font-weight: 700; white-space: nowrap; }
    .footer { margin-top: 12pt; font-size: 7.5pt; color: #888; border-top: 0.4pt solid #ccc; padding-top: 4pt; }
  </style>
</head>
<body>
  <h1>PACKING LIST</h1>
  <table class="info">
    <tr>
      <th>PO No.</th><td><strong>${order?.po_no ?? '—'}</strong></td>
      <th>발주 연월</th><td>${order?.order_ym ?? '—'}</td>
    </tr>
    <tr>
      <th>수출자</th><td>${order?.exporter_code ?? '—'}</td>
      <th>출력일</th><td>${date}</td>
    </tr>
  </table>
  <div class="summary">
    총 팔레트 <strong>${totalPallets}</strong>개 &nbsp;·&nbsp;
    총 박스 <strong>${totalBoxes.toLocaleString()}</strong> CTN &nbsp;·&nbsp;
    컨테이너 <strong>${containers.length}</strong>개
    &nbsp;&nbsp;※ 보라색 행 = 1팔레트 혼재(복수 품목)
  </div>
  ${containerBlocks}
  <div class="footer">${order?.po_no ?? ''} &nbsp;|&nbsp; PurchaseMaster 자동 생성 · ${date}</div>
  <script>window.onload=()=>{ window.print() }</script>
</body>
</html>`
}

// ── 팔레트 카드 (왼쪽 패널 · 드래그 가능) ────────────────────────────────────
function PalletCard({ pallet, onDragStart }: {
  pallet: Pallet
  onDragStart: (e: React.DragEvent, id: string) => void
}) {
  const pct       = Math.round((pallet.boxes / pallet.max_boxes) * 100)
  const isPartial = pallet.boxes < pallet.max_boxes
  const isCold    = pallet.tier_code === 'cold'

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, pallet.id)}
      style={{
        background: '#fff', border: '0.5px solid var(--border-tertiary)',
        borderRadius: 'var(--radius-md)', padding: '8px 10px', marginBottom: 6,
        cursor: 'grab',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
        <IconGripVertical size={12} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
        <span
          className={`chip ${isCold ? 'chip-info' : 'chip-default'}`}
          style={{ fontSize: 9, padding: '1px 5px' }}
        >
          {tierLabel(pallet.tier_code)}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{pallet.id}</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {pallet.name_ja ?? pallet.product_code ?? '—'}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>
        {pallet.boxes}/{pallet.max_boxes} CTN · {pallet.weight_kg.toLocaleString()} kg
      </div>
      <div style={{ height: 3, background: 'var(--bg-secondary)', borderRadius: 99 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: isCold ? 'var(--text-info)' : 'var(--text-warning)', borderRadius: 99 }} />
      </div>
      {isPartial && (
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 3 }}>잔여 → 혼재 드롭 가능</div>
      )}
    </div>
  )
}

// ── 슬롯 컴포넌트 ─────────────────────────────────────────────────────────────
function SlotCell({
  idx, pallets, containerId, containerTierCode, allowColdInDry,
  onDrop, onRemovePallet,
}: {
  idx: number
  pallets: Pallet[]                  // 0=빈칸, 1=단일, 2+=혼재
  containerId: string
  containerTierCode: string
  allowColdInDry: boolean            // 겨울 시즌: 냉장→DRY 허용
  onDrop: (e: React.DragEvent, containerId: string, slotIdx: number) => void
  onRemovePallet: (containerId: string, slotIdx: number, palletId: string) => void
}) {
  const [over,    setOver]    = useState(false)
  const [blocked, setBlocked] = useState(false)

  const isColdDrag = (e: React.DragEvent) => e.dataTransfer.types.includes('pallet/cold')

  const handleDragOver = (e: React.DragEvent) => {
    // 냉장 팔레트 → 상온 컨테이너: 겨울 시즌 제외 차단
    if (isColdDrag(e) && containerTierCode !== 'cold' && !allowColdInDry) {
      setBlocked(true); setOver(false)
      return  // preventDefault 미호출 → drop 이벤트 발생 안 함
    }
    // 혼재 슬롯에 추가 불가능한지 확인: types에 boxes 정보 없으므로 낙관적 허용
    e.preventDefault()
    setBlocked(false); setOver(true)
  }
  const handleDragLeave = () => { setOver(false); setBlocked(false) }
  const handleDrop = (e: React.DragEvent) => {
    setOver(false); setBlocked(false)
    onDrop(e, containerId, idx)
  }

  const totalBoxes   = pallets.reduce((s, p) => s + p.boxes, 0)
  const totalWeightKg = pallets.reduce((s, p) => s + p.weight_kg, 0)
  const pct          = Math.round((totalBoxes / BOXES_PER_PALLET) * 100)
  const isMerged     = pallets.length > 1
  const isSingleCold = pallets.length === 1 && pallets[0].tier_code === 'cold'

  if (pallets.length > 0) {
    const borderColor = blocked ? 'var(--text-danger)'
      : isMerged ? '#9333ea'
      : isSingleCold ? 'var(--text-info)' : 'var(--text-warning)'
    const bg = blocked ? '#fff1f2'
      : isMerged ? '#faf5ff'
      : isSingleCold ? '#eff6ff' : '#fffbeb'

    return (
      <div
        style={{ border: `1.5px solid ${borderColor}`, borderRadius: 6, padding: '5px 7px', position: 'relative', minHeight: 60, background: bg }}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        draggable
        onDragStart={e => {
          const pids = pallets.map(p => p.id)
          e.dataTransfer.setData('text/plain', JSON.stringify({ palletIds: pids, srcContainer: containerId, srcSlot: idx }))
          // 냉장 팔레트가 하나라도 있으면 pallet/cold 설정
          if (pallets.some(p => p.tier_code === 'cold')) {
            e.dataTransfer.setData('pallet/cold', '')
          } else {
            e.dataTransfer.setData('pallet/ambient', '')
          }
        }}
      >
        {isMerged && (
          <div style={{ fontSize: 9, color: '#7c3aed', fontWeight: 700, marginBottom: 3 }}>혼재 {pallets.length}품목</div>
        )}
        {pallets.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2 }}>
            <span style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'monospace', flexShrink: 0 }}>{p.id}</span>
            <span style={{ fontSize: 10, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {p.product_code ?? '—'}
            </span>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)', flexShrink: 0 }}>{p.boxes}C</span>
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', opacity: 0.45, flexShrink: 0 }}
              onClick={() => onRemovePallet(containerId, idx, p.id)}
            >
              <IconTrash size={9} />
            </button>
          </div>
        ))}
        <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginTop: 2 }}>{totalBoxes} CTN · {totalWeightKg} kg</div>
        <div style={{ height: 2, background: isMerged ? '#e9d5ff' : isSingleCold ? '#bfdbfe' : '#fde68a', borderRadius: 99, marginTop: 3 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: isMerged ? '#9333ea' : isSingleCold ? 'var(--text-info)' : 'var(--text-warning)', borderRadius: 99 }} />
        </div>
      </div>
    )
  }

  // 빈 슬롯
  return (
    <div
      onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
      style={{
        border: `0.5px ${blocked ? 'solid' : 'dashed'} ${blocked ? 'var(--text-danger)' : over ? 'var(--text-info)' : 'var(--border-secondary)'}`,
        borderRadius: 6, minHeight: 60,
        background: blocked ? '#fff1f2' : over ? '#eff6ff' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.1s, border-color 0.1s',
      }}
    >
      <span style={{ fontSize: 11, color: blocked ? 'var(--text-danger)' : over ? 'var(--text-info)' : 'var(--text-tertiary)', fontWeight: 500 }}>
        {blocked ? '✕' : idx + 1}
      </span>
    </div>
  )
}

// ── 컨테이너 패널 ─────────────────────────────────────────────────────────────
function ContainerPanel({ container, palletMap, allowColdInDry, onDrop, onRemovePallet, onDelete, onUpgrade }: {
  container: Container
  palletMap: Map<string, Pallet>
  allowColdInDry: boolean
  onDrop: (e: React.DragEvent, containerId: string, slotIdx: number) => void
  onRemovePallet: (containerId: string, slotIdx: number, palletId: string) => void
  onDelete: (id: string) => void
  onUpgrade: (id: string) => void
}) {
  // 슬롯 배열(string[])을 flatMap해서 전체 팔레트 ID 수집
  const allPids = container.slots.flatMap(s => s ?? [])
  const assignedSlots = container.slots.filter(Boolean).length
  const assignedPallets = allPids.length

  const totalWeightKg = allPids.reduce((s, pid) => s + (palletMap.get(pid)?.weight_kg ?? 0), 0)
  const totalWeightT  = totalWeightKg / 1000

  const hasCold = allPids.some(pid => (palletMap.get(pid)?.tier_code ?? '') === 'cold')
  const hasAmb  = allPids.some(pid => (palletMap.get(pid)?.tier_code ?? '') !== 'cold')
  const isMixed = hasCold && hasAmb

  const spec    = CSPEC[container.ctype]
  const isCold  = container.tier_code === 'cold'
  const is20ft  = container.ctype === '20RF' || container.ctype === '20DRY'

  const headerBg  = isCold ? '#eff6ff' : '#fffbeb'
  const headerClr = isCold ? '#1d4ed8' : '#92400e'
  const cntNo     = container.id.slice(1)
  const displayLabel = `${spec.disp} #${cntNo}${container.exporter_code ? ` · ${container.exporter_code}` : ''}${isMixed ? ' · 혼적' : ''}`

  return (
    <div style={{ background: '#fff', border: '0.5px solid var(--border-tertiary)', borderRadius: 'var(--radius-lg)', marginBottom: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: headerBg, borderBottom: '0.5px solid var(--border-tertiary)' }}>
        <div style={{ width: 20, height: 20, borderRadius: 5, background: isCold ? '#dbeafe' : '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {isCold ? <IconSnowflake size={11} color="#1d4ed8" /> : <IconSun size={11} color="#ca8a04" />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: headerClr, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayLabel}</div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>최대 {container.max_pallets} PL · {container.max_weight_t} t</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {is20ft && (
            <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => onUpgrade(container.id)} title="40ft 전환">40ft↑</button>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>PL/슬롯</div>
            <div style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {assignedPallets}/{assignedSlots}<span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>/{container.max_pallets}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>중량</div>
            <div style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {totalWeightT.toFixed(1)}<span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>t</span>
            </div>
          </div>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 3 }} onClick={() => onDelete(container.id)}>
            <IconTrash size={13} />
          </button>
        </div>
      </div>

      {/* Slot grid: 4 columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, padding: 10 }}>
        {container.slots.map((pids, i) => {
          const ps = (pids ?? []).map(pid => palletMap.get(pid)).filter(Boolean) as Pallet[]
          return (
            <SlotCell
              key={i}
              idx={i}
              pallets={ps}
              containerId={container.id}
              containerTierCode={container.tier_code}
              allowColdInDry={allowColdInDry}
              onDrop={onDrop}
              onRemovePallet={onRemovePallet}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function PalletPlanPage() {
  const [orders,       setOrders]       = useState<PurchaseOrder[]>([])
  const [poId,         setPoId]         = useState<number | null>(null)
  const [poLines,      setPoLines]      = useState<PoLine[]>([])
  const [palletMap,    setPalletMap]    = useState<Map<string, Pallet>>(new Map())
  const [containers,   setContainers]   = useState<Container[]>([])
  const [tierFilter,   setTierFilter]   = useState<'all' | 'cold' | 'ambient'>('all')
  const [loading,      setLoading]      = useState(false)
  const [confirming,   setConfirming]   = useState(false)
  const [confirmed,    setConfirmed]    = useState(false)
  const [containerSeq, setContainerSeq] = useState(1)

  const currentOrder = orders.find(o => o.po_id === poId) ?? null

  // 겨울 시즌 여부 (12·1·2월): 냉장 팔레트 → DRY 컨테이너 허용
  const isWinterSeason = useMemo(() => {
    if (!currentOrder?.order_ym) return false
    const month = parseInt(currentOrder.order_ym.slice(5, 7), 10)
    return WINTER_MONTHS.includes(month)
  }, [currentOrder])

  // 미배정 팔레트 (slots 배열 flatMap)
  const unassigned = useMemo(() => {
    const assigned = new Set(containers.flatMap(c => c.slots.flatMap(s => s ?? [])))
    return [...palletMap.values()].filter(p => !assigned.has(p.id))
  }, [palletMap, containers])

  const filteredUnassigned = useMemo(() => {
    if (tierFilter === 'all') return unassigned
    return unassigned.filter(p => tierFilter === 'cold' ? p.tier_code === 'cold' : p.tier_code !== 'cold')
  }, [unassigned, tierFilter])

  // Stats
  const stats = useMemo(() => {
    const totalPallets   = palletMap.size
    const assignedCount  = totalPallets - unassigned.length
    const coldPallets    = [...palletMap.values()].filter(p => p.tier_code === 'cold').length
    const ambPallets     = [...palletMap.values()].filter(p => p.tier_code !== 'cold').length
    const totalWeightKg  = [...palletMap.values()].reduce((s, p) => s + p.weight_kg, 0)
    const cntCount       = containers.length
    return { totalPallets, assignedCount, coldPallets, ambPallets, totalWeightKg, cntCount }
  }, [palletMap, unassigned, containers])

  // ── 데이터 로드 ────────────────────────────────────────────────────────────
  useEffect(() => {
    getPurchaseOrders({ po_status: 'CONFIRMED' }).then(r => {
      setOrders(r.data)
      if (r.data.length > 0) setPoId(r.data[0].po_id)
    })
  }, [])

  useEffect(() => {
    if (!poId) return
    setContainers([])
    setContainerSeq(1)
    setConfirmed(false)
    const order = orders.find(o => o.po_id === poId)
    getPoLines(poId).then(r => {
      setPoLines(r.data)
      const pallets = buildPallets(r.data, order?.exporter_code ?? null)
      const map = new Map<string, Pallet>()
      pallets.forEach(p => map.set(p.id, p))
      setPalletMap(map)
    })
  }, [poId])

  // ── 컨테이너 추가 ──────────────────────────────────────────────────────────
  const addContainer = useCallback((ctype: '40RF' | '40DRY' | '20RF' | '20DRY') => {
    const spec  = CSPEC[ctype]
    const order = orders.find(o => o.po_id === poId)
    const newC: Container = {
      id: `c${containerSeq}`, ctype, label: '',
      exporter_code: order?.exporter_code ?? null,
      tier_code: spec.tier,
      max_pallets: spec.max_pallets,
      max_weight_t: spec.max_weight_t,
      slots: new Array<string[] | null>(spec.max_pallets).fill(null),
    }
    setContainers(prev => [...prev, newC])
    setContainerSeq(n => n + 1)
  }, [containerSeq, poId, orders])

  // ── 자동 배치 ──────────────────────────────────────────────────────────────
  const handleAutoGenerate = async () => {
    if (!poId) return
    setLoading(true)
    try {
      const res = await generateContainerPlan(poId)
      applyPlanResult(res.data, poLines, currentOrder)
    } catch {
      localAutoAssign()
    } finally {
      setLoading(false)
    }
  }

  function applyPlanResult(plan: PackingPlanResult, lines: PoLine[], order: PurchaseOrder | null) {
    const pallets = buildPallets(lines, order?.exporter_code ?? null)
    const map = new Map<string, Pallet>()
    pallets.forEach(p => map.set(p.id, p))

    const palletsByLine = new Map<number, string[]>()
    pallets.forEach(p => {
      if (!palletsByLine.has(p.po_line_id)) palletsByLine.set(p.po_line_id, [])
      palletsByLine.get(p.po_line_id)!.push(p.id)
    })
    const lineCursor = new Map<number, number>()

    let seq = 1
    const newContainers: Container[] = plan.containers.map(cnt => {
      const is20       = cnt.container_type.includes('20')
      const isColdTier = (cnt.tier_code ?? 'cold') === 'cold'
      const ctype: '40RF' | '40DRY' | '20RF' | '20DRY' =
        is20 ? (isColdTier ? '20RF' : '20DRY') : (isColdTier ? '40RF' : '40DRY')
      const spec  = CSPEC[ctype]
      const slots: (string[] | null)[] = new Array(spec.max_pallets).fill(null)

      cnt.assignments.forEach(a => {
        const cursor = lineCursor.get(a.po_line_id) ?? 0
        const lps    = palletsByLine.get(a.po_line_id) ?? []
        for (let j = 0; j < a.pallets_in_container; j++) {
          const pid     = lps[cursor + j]
          const slotIdx = (a.pallet_start - 1) + j
          if (pid && slotIdx < slots.length) slots[slotIdx] = [pid]
        }
        lineCursor.set(a.po_line_id, cursor + a.pallets_in_container)
      })

      return {
        id: `c${seq++}`, ctype, label: '',
        exporter_code: order?.exporter_code ?? null,
        tier_code: cnt.tier_code ?? 'cold',
        max_pallets: spec.max_pallets,
        max_weight_t: spec.max_weight_t,
        slots,
      }
    })

    setPalletMap(map)
    setContainers(newContainers)
    setContainerSeq(seq)
  }

  // 로컬 폴백: 냉장 → RF, 빈 슬롯에 상온 백필, 남은 상온 → DRY
  function localAutoAssign() {
    const coldP  = [...palletMap.values()].filter(p => p.tier_code === 'cold')
    const ambP   = [...palletMap.values()].filter(p => p.tier_code !== 'cold')
    const exCode = currentOrder?.exporter_code ?? null

    const newContainers: Container[] = []
    let seq = 1

    const makeC = (ctype: '40RF' | '40DRY' | '20RF' | '20DRY'): Container => {
      const spec = CSPEC[ctype]
      const c: Container = {
        id: `c${seq++}`, ctype, label: '', exporter_code: exCode,
        tier_code: spec.tier, max_pallets: spec.max_pallets, max_weight_t: spec.max_weight_t,
        slots: new Array<string[] | null>(spec.max_pallets).fill(null),
      }
      newContainers.push(c)
      return c
    }

    const remSlots = (c: Container) => c.slots.filter(s => !s).length
    const fillFrom = (ids: string[], c: Container) => {
      while (ids.length > 0 && remSlots(c) > 0) {
        const i = c.slots.findIndex(s => !s)
        c.slots[i] = [ids.shift()!]
      }
    }

    let coldIds = coldP.map(p => p.id)
    let ambIds  = ambP.map(p => p.id)

    while (coldIds.length > 0) {
      const ctype: '40RF' | '20RF' = coldIds.length <= CSPEC['20RF'].max_pallets ? '20RF' : '40RF'
      const c = makeC(ctype)
      fillFrom(coldIds, c)
      fillFrom(ambIds, c)   // 상온 백필
    }

    while (ambIds.length > 0) {
      const ctype: '40DRY' | '20DRY' = ambIds.length <= CSPEC['20DRY'].max_pallets ? '20DRY' : '40DRY'
      const c = makeC(ctype)
      fillFrom(ambIds, c)
    }

    setContainers(newContainers)
    setContainerSeq(seq)
  }

  // ── 20ft → 40ft 전환 ────────────────────────────────────────────────────────
  const upgradeContainer = useCallback((id: string) => {
    setContainers(prev => prev.map(c => {
      if (c.id !== id) return c
      const newCtype: '40RF' | '40DRY' = c.ctype === '20RF' ? '40RF' : '40DRY'
      const spec      = CSPEC[newCtype]
      const newSlots: (string[] | null)[] = new Array(spec.max_pallets).fill(null)
      c.slots.forEach((pids, i) => { if (i < newSlots.length) newSlots[i] = pids })
      return { ...c, ctype: newCtype, tier_code: spec.tier, max_pallets: spec.max_pallets, max_weight_t: spec.max_weight_t, slots: newSlots }
    }))
  }, [])

  // ── 드래그 앤 드롭 ─────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, palletId: string) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ palletIds: [palletId], srcContainer: null, srcSlot: -1 }))
    const tier = palletMap.get(palletId)?.tier_code ?? 'cold'
    e.dataTransfer.setData(`pallet/${tier}`, '')
  }, [palletMap])

  const handleDrop = useCallback((e: React.DragEvent, tgtContainer: string, tgtSlot: number) => {
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'))
      // palletIds(배열) 또는 구형 palletId(단수) 지원
      const ids: string[] = data.palletIds ?? (data.palletId ? [data.palletId] : [])
      const { srcContainer, srcSlot } = data as { srcContainer: string | null; srcSlot: number }
      if (ids.length === 0) return

      setContainers(prev => {
        const tgt = prev.find(c => c.id === tgtContainer)
        if (!tgt) return prev

        // 냉장 → 상온 차단: 드래그된 팔레트 중 냉장이 하나라도 있으면 차단 (겨울 시즌 제외)
        const anyDraggedCold = ids.some(id => palletMap.get(id)?.tier_code === 'cold')
        if (anyDraggedCold && tgt.tier_code !== 'cold' && !isWinterSeason) return prev

        const next = prev.map(c => ({ ...c, slots: c.slots.map(s => s ? [...s] : null) as (string[] | null)[] }))
        const tgtMut = next.find(c => c.id === tgtContainer)!
        const tgtPids = tgtMut.slots[tgtSlot] ?? []

        // ── 혼재 슬롯(ids > 1) 드래그: 빈 슬롯에만 이동 허용 ─────────────
        if (ids.length > 1) {
          if (tgtPids.length > 0) return prev  // 이미 차 있는 슬롯엔 혼재 블록 드롭 불가
          // 소스에서 제거
          if (srcContainer && srcSlot >= 0) {
            const src = next.find(c => c.id === srcContainer)
            if (src) src.slots[srcSlot] = null
          }
          tgtMut.slots[tgtSlot] = [...ids]
        } else {
          // ── 단일 팔레트 ────────────────────────────────────────────────────
          const palletId = ids[0]
          const draggedPallet = palletMap.get(palletId)
          if (!draggedPallet) return prev

          const tgtBoxes  = tgtPids.reduce((s, pid) => s + (palletMap.get(pid)?.boxes ?? 0), 0)
          const isPartial = draggedPallet.boxes < BOXES_PER_PALLET
          const canMerge  = tgtPids.length > 0 && isPartial && (tgtBoxes + draggedPallet.boxes <= BOXES_PER_PALLET)

          const removeFromSrc = () => {
            if (srcContainer && srcSlot >= 0) {
              const src = next.find(c => c.id === srcContainer)
              if (src) {
                const remaining = (src.slots[srcSlot] ?? []).filter(p => p !== palletId)
                src.slots[srcSlot] = remaining.length > 0 ? remaining : null
              }
            }
          }

          if (canMerge) {
            removeFromSrc()
            tgtMut.slots[tgtSlot] = [...tgtPids, palletId]
          } else if (tgtPids.length === 0) {
            removeFromSrc()
            tgtMut.slots[tgtSlot] = [palletId]
          } else if (tgtPids.length === 1) {
            // 단일 팔레트 스왑
            const [displaced] = tgtPids
            tgtMut.slots[tgtSlot] = [palletId]
            if (srcContainer && srcSlot >= 0) {
              const src = next.find(c => c.id === srcContainer)
              if (src) {
                const srcRemaining = (src.slots[srcSlot] ?? []).filter(p => p !== palletId)
                src.slots[srcSlot] = srcRemaining.length > 0 ? srcRemaining : [displaced]
              }
            }
            // srcContainer가 없으면(미배정 패널) displaced는 미배정 상태로 남음
          }
          // 혼재 슬롯 초과: 이동 없음
        }

        // ── 압착: 소스 컨테이너 (항상), 대상 컨테이너 (다른 경우에만) ────────
        if (srcContainer && srcSlot >= 0) {
          const src = next.find(c => c.id === srcContainer)
          if (src) src.slots = compactSlots(src.slots)
        }
        if (!srcContainer || srcContainer !== tgtContainer) {
          tgtMut.slots = compactSlots(tgtMut.slots)
        }

        return next
      })
    } catch { /* ignore */ }
  }, [palletMap, isWinterSeason])

  const handleRemovePallet = useCallback((containerId: string, slotIdx: number, palletId: string) => {
    setContainers(prev => prev.map(c => {
      if (c.id !== containerId) return c
      const afterRemove = c.slots.map((pids, i) => {
        if (i !== slotIdx || !pids) return pids
        const remaining = pids.filter(pid => pid !== palletId)
        return remaining.length > 0 ? remaining : null
      })
      // 슬롯이 비면 이후 팔레트들을 앞으로 압착
      return { ...c, slots: compactSlots(afterRemove) }
    }))
  }, [])

  const handleDeleteContainer = useCallback((id: string) => {
    setContainers(prev => prev.filter(c => c.id !== id))
  }, [])

  const handleConfirm = async () => {
    if (!poId) return
    setConfirming(true)
    try { await confirmContainerPlan(poId); setConfirmed(true) }
    catch { /* ignore */ }
    finally { setConfirming(false) }
  }

  // ── 패킹리스트 PDF (인쇄 창) ────────────────────────────────────────────────
  const handleDownloadPackingList = () => {
    const html = buildPackingListHTML(containers, palletMap, currentOrder)
    const win  = window.open('', '_blank', 'width=900,height=700')
    if (!win) { alert('팝업이 차단되었습니다. 브라우저 팝업 허용 후 다시 시도하세요.'); return }
    win.document.write(html)
    win.document.close()
  }

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1 className="page-title">파렛트 · 컨테이너 적재</h1>
          <p style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '2px 0 0' }}>
            M4 · 팔레트를 드래그해 컨테이너에 배치 · 잔여 팔레트는 혼재 슬롯으로 합치기 가능
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {isWinterSeason && (
            <span className="chip chip-default" style={{ background: '#dbeafe', color: '#1d4ed8', fontSize: 11 }}>
              ❄️ 동절기 — 냉장 → DRY 허용
            </span>
          )}
          {orders.length > 0 && (
            <select className="pm-select" value={poId ?? ''} onChange={e => setPoId(Number(e.target.value))}>
              {orders.map(o => <option key={o.po_id} value={o.po_id}>{o.po_no}</option>)}
            </select>
          )}
          <button className="btn btn-info" onClick={handleAutoGenerate} disabled={loading || !poId}>
            <IconRefresh size={13} /> {loading ? '생성 중…' : '자동 생성'}
          </button>
          {containers.length > 0 && (
            <button className="btn btn-success" onClick={handleConfirm} disabled={confirming}>
              <IconCircleCheck size={13} /> {confirming ? '확정 중…' : '확정'}
            </button>
          )}
          <div style={{ display: 'flex', gap: 3 }}>
            {(['40RF', '40DRY', '20RF', '20DRY'] as const).map(ct => (
              <button key={ct} className="btn" style={{ fontSize: 10, padding: '4px 8px' }} onClick={() => addContainer(ct)}>
                <IconPlus size={10} /> {ct}
              </button>
            ))}
          </div>
          {containers.length > 0 && (
            <button className="btn" onClick={handleDownloadPackingList}>
              <IconDownload size={13} /> 패킹리스트
            </button>
          )}
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      {palletMap.size > 0 && (
        <div className="stats-grid" style={{ marginBottom: 12, flexShrink: 0 }}>
          <div className="stat-tile">
            <div className="label">전체 팔레트</div>
            <div className="value" style={{ fontSize: 28 }}>{stats.totalPallets}</div>
            <div className="sub">배치 {stats.assignedCount}/{stats.totalPallets}</div>
          </div>
          <div className="stat-tile">
            <div className="label">냉장 / 상온</div>
            <div className="value" style={{ fontSize: 28 }}>
              <span style={{ color: 'var(--text-info)' }}>{stats.coldPallets}</span>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 18 }}> / </span>
              <span style={{ color: '#c2860a' }}>{stats.ambPallets}</span>
            </div>
            <div className="sub">팔레트 수</div>
          </div>
          <div className="stat-tile">
            <div className="label">총 중량</div>
            <div className="value" style={{ fontSize: 28 }}>{(stats.totalWeightKg / 1000).toFixed(1)} t</div>
            <div className="sub">전체 합산</div>
          </div>
          <div className="stat-tile">
            <div className="label">컨테이너</div>
            <div className="value" style={{ fontSize: 28 }}>{stats.cntCount}</div>
            <div className="sub">
              {(['40RF','20RF','40DRY','20DRY'] as const)
                .map(ct => { const n = containers.filter(c => c.ctype === ct).length; return n > 0 ? `${ct}×${n}` : null })
                .filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        </div>
      )}

      {confirmed && (
        <div className="alert alert-success" style={{ marginBottom: 10, flexShrink: 0 }}>
          <IconCircleCheck size={13} /> 팔레트 계획이 확정되었습니다. 패킹리스트를 다운로드하세요.
        </div>
      )}
      {palletMap.size === 0 && !loading && (
        <div className="alert alert-info" style={{ flexShrink: 0 }}>
          확정(CONFIRMED) PO를 선택 후 "자동 생성" 버튼을 클릭하거나, 컨테이너를 추가해 직접 배치하세요.
        </div>
      )}

      {/* ── Main split layout ─────────────────────────────────────────────── */}
      {palletMap.size > 0 && (
        <div style={{ display: 'flex', gap: 0, flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* Left: 미배정 팔레트 */}
          <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', borderRight: '0.5px solid var(--border-tertiary)', borderRadius: 'var(--radius-lg) 0 0 var(--radius-lg)' }}>
            <div style={{ padding: '10px 12px 8px', borderBottom: '0.5px solid var(--border-tertiary)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>미배정 팔레트</span>
                <span className="chip chip-default">{unassigned.length}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['all', 'cold', 'ambient'] as const).map(t => (
                  <button key={t} onClick={() => setTierFilter(t)} style={{
                    padding: '3px 10px', borderRadius: 20,
                    border: '0.5px solid ' + (tierFilter === t ? 'var(--text-info)' : 'var(--border-secondary)'),
                    background: tierFilter === t ? 'var(--bg-info)' : '#fff',
                    color: tierFilter === t ? 'var(--text-info)' : 'var(--text-secondary)',
                    fontFamily: 'var(--font)', fontSize: 11, cursor: 'pointer', fontWeight: tierFilter === t ? 600 : 400,
                  }}>
                    {t === 'all' ? '전체' : t === 'cold' ? '냉장' : '상온'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
              {filteredUnassigned.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-tertiary)', fontSize: 12 }}>
                  {unassigned.length === 0 ? '✓ 모든 팔레트 배치 완료' : '해당 조건 없음'}
                </div>
              ) : filteredUnassigned.map(p => (
                <PalletCard key={p.id} pallet={p} onDragStart={handleDragStart} />
              ))}
            </div>
          </div>

          {/* Right: 컨테이너 (2열 그리드) */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
            {containers.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>컨테이너가 없습니다.</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {(['40RF', '40DRY', '20RF', '20DRY'] as const).map(ct => (
                    <button key={ct} className="btn btn-info" onClick={() => addContainer(ct)}>
                      <IconPlus size={13} /> {CSPEC[ct].disp} 추가
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, alignContent: 'start' }}>
                {containers.map(c => (
                  <ContainerPanel
                    key={c.id}
                    container={c}
                    palletMap={palletMap}
                    allowColdInDry={isWinterSeason}
                    onDrop={handleDrop}
                    onRemovePallet={handleRemovePallet}
                    onDelete={handleDeleteContainer}
                    onUpgrade={upgradeContainer}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
