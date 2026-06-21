import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  IconPlayerPlay, IconCheck, IconAlertTriangle,
  IconSearch, IconChevronLeft, IconChevronRight, IconSnowflake,
  IconUpload, IconX, IconCircleCheck, IconCircleX,
} from '@tabler/icons-react'
import {
  getPlanRuns, getPlanLines, getPlanSummary, runPlan, approvePlan,
  getDemandActual, getInventoryLots, getProducts,
  bulkUpsertDemandActual, registerInitialLots,
} from '../api/api'
import type {
  PlanRun, PlanLine, MonthSummary,
  DemandActualRead, InvLotRead, Product,
} from '../api/types'
import dayjs from 'dayjs'

// ── Upload: monthly report parser ─────────────────────────────────────────────
interface ParsedRow {
  code: string
  name: string
  eaPerBox: number
  shippedEa: number
  shippedBoxes: number   // 출고수량 / EA/BOX  (DemandActual)
  stockCt: number        // C/T 열 = 재고 박스수 (InventoryLot)
  matched: boolean
}
interface ParsedFile { ym: string; rows: ParsedRow[] }

async function parseMonthlyReport(file: File, productCodes: Set<string>): Promise<ParsedFile> {
  const buf = await file.arrayBuffer()
  const wb  = XLSX.read(buf, { type: 'array', codepage: 949 })  // 949 = EUC-KR / CP949
  const ws  = wb.Sheets[wb.SheetNames[0]]
  const raw: (string | number | undefined)[][] =
    XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })

  // ── extract YYYY-MM from first row: "... 2026/05/01  ~ 2026/05/31 ..."
  const firstRow = raw[0]?.join(',') ?? ''
  const ymMatch  = firstRow.match(/(\d{4})\/(\d{2})\/\d{2}/)
  const ym       = ymMatch ? `${ymMatch[1]}-${ymMatch[2]}` : ''

  // ── find header row containing "항목코드"
  let hdrIdx = -1
  for (let i = 0; i < Math.min(6, raw.length); i++) {
    if (raw[i]?.some(c => String(c).includes('항목코드'))) { hdrIdx = i; break }
  }
  if (hdrIdx < 0) throw new Error('파일에서 "항목코드" 열을 찾을 수 없습니다')

  const hdrs     = raw[hdrIdx].map(c => String(c).trim())
  const idx      = (name: string) => hdrs.findIndex(h => h === name || h.includes(name))
  const codeIdx  = idx('항목코드')
  const nameIdx  = idx('항목명')
  const eaBoxIdx = hdrs.findIndex(h => h === 'EA/BOX' || (h.includes('EA') && h.includes('BOX')))
  const shipIdx  = idx('출고수량')
  const ctIdx    = hdrs.findIndex(h => h === 'C/T')

  if (codeIdx < 0 || shipIdx < 0) throw new Error('"항목코드" 또는 "출고수량" 열을 찾을 수 없습니다')

  const parsed: ParsedRow[] = []
  for (let i = hdrIdx + 1; i < raw.length; i++) {
    const row  = raw[i]
    const code = String(row?.[codeIdx] ?? '').trim()
    if (!code || code.startsWith('합계') || code.startsWith('소계')) break

    const eaPerBox    = parseFloat(String(row[eaBoxIdx] ?? '1').replace(/,/g, '')) || 1
    const shippedEa   = parseFloat(String(row[shipIdx]  ?? '0').replace(/,/g, '')) || 0
    const shippedBoxes = Math.round(shippedEa / eaPerBox)
    const stockCt     = ctIdx >= 0 ? (parseInt(String(row[ctIdx] ?? '0').replace(/,/g, '')) || 0) : 0

    parsed.push({
      code, name: String(row[nameIdx] ?? '').trim(),
      eaPerBox, shippedEa, shippedBoxes, stockCt,
      matched: productCodes.has(code),
    })
  }

  return { ym, rows: parsed }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function addM(ym: string, n: number) {
  return dayjs(`${ym}-01`).add(n, 'month').format('YYYY-MM')
}
function fmtYm(ym: string) {
  return ym.slice(2, 4) + '.' + ym.slice(5, 7)   // "2026-07" → "26.07"
}
function num(v: number | null, blank = '—') {
  return v === null ? blank : v.toLocaleString()
}

const TIER_LABEL: Record<string, string> = { cold: '냉장', ambient: '상온', room: '상냉장' }
const N_MONTHS = 12
const COL_PROD  = 192
const COL_SINV  = 82
const COL_SALES = 68
const COL_ORD   = 68
const COL_INV   = 74

// ── component ─────────────────────────────────────────────────────────────────
export default function ForecastPage() {
  const todayYm = useMemo(() => dayjs().format('YYYY-MM'), [])

  const [plans, setPlans]         = useState<PlanRun[]>([])
  const [selected, setSelected]   = useState<PlanRun | null>(null)
  const [lines, setLines]         = useState<PlanLine[]>([])
  const [summary, setSummary]     = useState<MonthSummary[]>([])
  const [demandData, setDemandData] = useState<DemandActualRead[]>([])
  const [lots, setLots]           = useState<InvLotRead[]>([])
  const [products, setProducts]   = useState<Product[]>([])
  const [centerYm, setCenterYm]   = useState(todayYm)
  const [search, setSearch]       = useState('')
  const [loading, setLoading]     = useState(true)
  const [running, setRunning]     = useState(false)
  const [showRunModal, setShowRunModal] = useState(false)
  const [runYm, setRunYm]         = useState(dayjs().format('YYYY-MM'))
  const scrollRef                 = useRef<HTMLDivElement>(null)

  // ── upload modal state ───────────────────────────────────────────────────
  const [showUpload, setShowUpload]     = useState(false)
  const [uploadTab, setUploadTab]       = useState<'actual' | 'stock'>('actual')
  const [parsedFile, setParsedFile]     = useState<ParsedFile | null>(null)
  const [uploadYm, setUploadYm]         = useState('')
  const [uploadMsg, setUploadMsg]       = useState<{ ok: boolean; text: string } | null>(null)
  const [uploading, setUploading]       = useState(false)
  const fileInputRef                    = useRef<HTMLInputElement>(null)

  // ── load plan list ──────────────────────────────────────────────────────────
  const loadPlans = () => {
    setLoading(true)
    getPlanRuns()
      .then(r => {
        setPlans(r.data)
        if (r.data.length > 0) {
          setSelected(r.data[0])
          setCenterYm(r.data[0].run_ym)
        }
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => { loadPlans() }, [])

  // ── load detail data when plan selected ───────────────────────────────────
  useEffect(() => {
    if (!selected) return
    const ymFrom = addM(centerYm, -6)
    Promise.all([
      getPlanLines(selected.plan_run_id),
      getPlanSummary(selected.plan_run_id),
      getDemandActual({ ym_from: ymFrom }),
      getInventoryLots({ status: 'AVAILABLE' }),
      getProducts({ size: 200 }),
    ]).then(([lRes, sRes, dRes, invRes, pRes]) => {
      setLines(lRes.data ?? [])
      setSummary(sRes.data.months ?? [])
      setDemandData(dRes.data ?? [])
      setLots(invRes.data ?? [])
      setProducts(pRes.data?.items ?? [])
    })
  }, [selected])

  // ── scroll buttons ───────────────────────────────────────────────────────
  const scroll = (d: 'left' | 'right') =>
    scrollRef.current?.scrollBy({ left: d === 'left' ? -280 : 280, behavior: 'smooth' })

  // ── display months: centerYm-1 … centerYm+4 ──────────────────────────────
  const displayMonths = useMemo(
    () => Array.from({ length: N_MONTHS }, (_, i) => addM(centerYm, i - 1)),
    [centerYm],
  )

  // ── data maps ─────────────────────────────────────────────────────────────
  const invMap = useMemo(() => {
    const m = new Map<number, number>()
    lots.forEach(l => m.set(l.product_id, (m.get(l.product_id) ?? 0) + l.qty_boxes))
    return m
  }, [lots])

  const demandMap = useMemo(() => {
    const m = new Map<number, Map<string, number>>()
    demandData.forEach(d => {
      if (!m.has(d.product_id)) m.set(d.product_id, new Map())
      m.get(d.product_id)!.set(d.ym, d.qty_boxes)
    })
    return m
  }, [demandData])

  const avgDemandMap = useMemo(() => {
    const m = new Map<number, number>()
    products.forEach(p => {
      const dm = demandMap.get(p.product_id)
      const vals = dm ? [...dm.values()].filter(v => v > 0) : []
      m.set(p.product_id, vals.length
        ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
        : 0)
    })
    return m
  }, [products, demandMap])

  // plan lines by order_ym
  const orderByOym = useMemo(() => {
    const m = new Map<number, Map<string, { boxes: number; alert: string | null }>>()
    lines.forEach(l => {
      if (!m.has(l.product_id)) m.set(l.product_id, new Map())
      m.get(l.product_id)!.set(l.order_ym, { boxes: l.order_boxes, alert: l.alert })
    })
    return m
  }, [lines])

  // arrivals by expected_arrival_ym (for inventory calc)
  const arrivalMap = useMemo(() => {
    const m = new Map<number, Map<string, number>>()
    lines.forEach(l => {
      if (!m.has(l.product_id)) m.set(l.product_id, new Map())
      const prev = m.get(l.product_id)!.get(l.expected_arrival_ym) ?? 0
      m.get(l.product_id)!.set(l.expected_arrival_ym, prev + l.order_boxes)
    })
    return m
  }, [lines])

  // ── build rows ───────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const q = search.toLowerCase()
    const filtered = q
      ? products.filter(p =>
          p.product_code?.toLowerCase().includes(q) ||
          p.name_ja?.toLowerCase().includes(q))
      : products

    return filtered.map(prod => {
      const startInv = invMap.get(prod.product_id) ?? 0
      const avgDem   = avgDemandMap.get(prod.product_id) ?? 0
      let runInv     = startInv

      const months = displayMonths.map(ym => {
        const isPast    = ym < todayYm
        const isCur     = ym === centerYm
        const isFcst    = ym > todayYm

        // 출고: actual if available, else avg for future
        const actualDem = demandMap.get(prod.product_id)?.get(ym)
        const sales     = actualDem !== undefined ? actualDem : (isFcst ? avgDem : null)
        const salesEst  = actualDem === undefined && isFcst   // estimated flag

        // 발주 (orders placed this month)
        const ord = orderByOym.get(prod.product_id)?.get(ym) ?? null

        // 재고 (running, only for current month onward)
        let inv: number | null = null
        if (!isPast) {
          const arrival = arrivalMap.get(prod.product_id)?.get(ym) ?? 0
          runInv = runInv + arrival - (sales ?? 0)
          inv = runInv
        }

        return { ym, isPast, isCur, isFcst, sales, salesEst, ord, inv }
      })

      return { prod, startInv, months }
    })
  }, [products, search, invMap, demandMap, avgDemandMap, orderByOym, arrivalMap,
      displayMonths, todayYm, centerYm])

  // ── totals ────────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    return displayMonths.map(ym => {
      let sales = 0, ord = 0, inv = 0, invCount = 0
      rows.forEach(r => {
        const m = r.months.find(x => x.ym === ym)
        if (!m) return
        sales += m.sales ?? 0
        ord   += m.ord?.boxes ?? 0
        if (m.inv !== null) { inv += Math.max(0, m.inv); invCount++ }
      })
      return { ym, sales, ord, inv: invCount > 0 ? inv : null }
    })
  }, [rows, displayMonths])

  const totalStartInv = useMemo(() =>
    [...invMap.values()].reduce((a, b) => a + b, 0), [invMap])

  // ── current plan summary stat (first order month) ─────────────────────────
  const firstOrderYm = useMemo(() => {
    const yms = [...new Set(lines.map(l => l.order_ym))].sort()
    return yms[0] ?? centerYm
  }, [lines, centerYm])
  const planStat = summary.find(s => s.order_ym === firstOrderYm)

  // ── center month options ──────────────────────────────────────────────────
  const centerOptions = useMemo(
    () => Array.from({ length: 12 }, (_, i) => addM(todayYm, i - 2)),
    [todayYm],
  )

  // ── upload handlers ───────────────────────────────────────────────────────
  const productCodeSet = useMemo(() => new Set(products.map(p => p.product_code)), [products])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadMsg(null)
    try {
      const result = await parseMonthlyReport(file, productCodeSet)
      setParsedFile(result)
      setUploadYm(result.ym)
    } catch (err: unknown) {
      setUploadMsg({ ok: false, text: String(err instanceof Error ? err.message : err) })
      setParsedFile(null)
    }
    e.target.value = ''
  }

  const handleUploadActual = async () => {
    if (!parsedFile || !uploadYm) return
    setUploading(true); setUploadMsg(null)
    try {
      const rows = parsedFile.rows
        .filter(r => r.shippedBoxes > 0)
        .map(r => ({ product_code: r.code, ym: uploadYm, qty_boxes: r.shippedBoxes }))
      const res = await bulkUpsertDemandActual(rows, true)
      const d   = res.data as { upserted?: number; skipped?: number }
      setUploadMsg({ ok: true, text: `완료: 등록/업데이트 ${d.upserted ?? 0}건, 미일치 ${d.skipped ?? 0}건` })
      // reload demand data
      const ymFrom = addM(centerYm, -6)
      getDemandActual({ ym_from: ymFrom }).then(r => setDemandData(r.data ?? []))
    } catch (err: unknown) {
      setUploadMsg({ ok: false, text: String(err instanceof Error ? err.message : err) })
    } finally { setUploading(false) }
  }

  const handleUploadStock = async () => {
    if (!parsedFile) return
    setUploading(true); setUploadMsg(null)
    const today = dayjs().format('YYYY-MM-DD')
    try {
      const rows = parsedFile.rows
        .filter(r => r.stockCt > 0)
        .map(r => {
          const prod = products.find(p => p.product_code === r.code)
          const zone = prod?.tier_code === 'cold' ? 'COLD' : 'AMBIENT'
          return {
            product_code: r.code,
            zone_code: zone,
            lot_no: `INIT-${r.code}-${dayjs().format('YYYYMM')}`,
            qty_boxes: r.stockCt,
            mfg_date: today,
          }
        })
      const res = await registerInitialLots(rows)
      setUploadMsg({ ok: true, text: `완료: 등록 ${res.data.created}건, 중복 건너뜀 ${res.data.skipped}건` })
      getInventoryLots({ status: 'AVAILABLE' }).then(r => setLots(r.data ?? []))
    } catch (err: unknown) {
      setUploadMsg({ ok: false, text: String(err instanceof Error ? err.message : err) })
    } finally { setUploading(false) }
  }

  // ── handlers ─────────────────────────────────────────────────────────────
  const handleRunPlan = async () => {
    setRunning(true)
    try {
      await runPlan(runYm)
      setShowRunModal(false)
      loadPlans()
    } finally { setRunning(false) }
  }
  const handleApprove = async () => {
    if (!selected) return
    await approvePlan(selected.plan_run_id)
    loadPlans()
  }

  // ── sticky column total width ─────────────────────────────────────────────
  const stickyW = COL_PROD + COL_SINV

  return (
    <div className="page">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 className="page-title">월별 발주 플래너</h1>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '2px 0 0' }}>
            출고(박스) · 발주(박스/CTN) · 재고(박스) 실시간 계산 — <span style={{ color: 'var(--text-danger)' }}>음수 재고 = 발주 필요</span>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Plan selector */}
          {plans.length > 0 && (
            <select
              className="pm-select"
              value={selected?.plan_run_id ?? ''}
              onChange={e => {
                const p = plans.find(x => x.plan_run_id === Number(e.target.value))
                if (p) { setSelected(p); setCenterYm(p.run_ym) }
              }}
            >
              {plans.map(p => (
                <option key={p.plan_run_id} value={p.plan_run_id}>
                  {p.run_ym} v{p.version} ({p.status})
                </option>
              ))}
            </select>
          )}
          {/* Approve */}
          {selected?.status === 'DRAFT' && (
            <button className="btn btn-success" onClick={handleApprove}>
              <IconCheck size={13} /> 계획 승인
            </button>
          )}
          {/* Upload actual */}
          <button className="btn" onClick={() => { setShowUpload(true); setParsedFile(null); setUploadMsg(null) }}>
            <IconUpload size={13} /> 실출고 업로드
          </button>
          {/* Run plan */}
          <button className="btn btn-info" onClick={() => setShowRunModal(true)}>
            <IconPlayerPlay size={13} /> 계획 실행
          </button>
          {/* Search */}
          <div style={{ position: 'relative' }}>
            <IconSearch size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
            <input
              className="pm-input"
              placeholder="코드 또는 상품명 검색"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 26, width: 180 }}
            />
          </div>
          {/* Center month */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>중심 월</span>
            <select
              className="pm-select"
              value={centerYm}
              onChange={e => setCenterYm(e.target.value)}
            >
              {centerOptions.map(ym => (
                <option key={ym} value={ym}>{fmtYm(ym)}</option>
              ))}
            </select>
          </div>
          {/* Scroll buttons */}
          <button className="btn" style={{ padding: '3px 8px' }} onClick={() => scroll('left')}><IconChevronLeft size={14} /></button>
          <button className="btn" style={{ padding: '3px 8px' }} onClick={() => scroll('right')}><IconChevronRight size={14} /></button>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      {!loading && (
        <div className="stats-grid">
          <div className="stat-tile">
            <div className="label">{firstOrderYm} 예상 팔레트</div>
            <div className="value">{planStat?.total_pallets ?? '—'} PLT</div>
            <div className="sub">냉장 {planStat?.cold_pallets ?? 0} · 상온 {planStat?.ambient_pallets ?? 0}</div>
          </div>
          <div className="stat-tile">
            <div className="label">컨테이너 (추정)</div>
            <div className="value">{planStat ? Math.ceil(planStat.total_pallets / 20) : '—'}개</div>
          </div>
          <div className="stat-tile">
            <div className="label">현재 재고</div>
            <div className="value">{totalStartInv.toLocaleString()} 박스</div>
          </div>
          <div className="stat-tile">
            <div className="label">표시 품목</div>
            <div className="value">{rows.length}</div>
          </div>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>로딩 중…</div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div ref={scrollRef} style={{ overflowX: 'scroll', overflowY: 'hidden' }}>
            <table
              className="pm-table"
              style={{
                width: stickyW + N_MONTHS * (COL_SALES + COL_ORD + COL_INV),
                tableLayout: 'fixed',
                userSelect: 'none',
              }}
            >
              <colgroup>
                <col style={{ width: COL_PROD }} />
                <col style={{ width: COL_SINV }} />
                {displayMonths.flatMap(ym => [
                  <col key={ym + '-s'} style={{ width: COL_SALES }} />,
                  <col key={ym + '-o'} style={{ width: COL_ORD }} />,
                  <col key={ym + '-i'} style={{ width: COL_INV }} />,
                ])}
              </colgroup>

              <thead>
                {/* Month group headers */}
                <tr>
                  <th
                    rowSpan={2}
                    style={{
                      position: 'sticky', left: 0, zIndex: 4,
                      background: 'var(--bg-primary)',
                      borderRight: '1px solid var(--border)',
                      paddingLeft: 12, textAlign: 'left',
                      minWidth: COL_PROD,
                    }}
                  >
                    상품
                  </th>
                  <th
                    rowSpan={2}
                    style={{
                      position: 'sticky', left: COL_PROD, zIndex: 4,
                      background: 'var(--bg-secondary)',
                      borderRight: '2px solid var(--border)',
                      textAlign: 'right', paddingRight: 8,
                      fontSize: 10, fontWeight: 400, color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    시작재고<br />(박스)
                  </th>
                  {displayMonths.map(ym => {
                    const isPast = ym < todayYm
                    const isCur  = ym === centerYm
                    return (
                      <th
                        key={ym}
                        colSpan={3}
                        style={{
                          textAlign: 'center',
                          background: isCur  ? 'var(--bg-info)' :
                                      isPast ? 'var(--bg-secondary)' : undefined,
                          color: isCur  ? 'var(--text-info)'  :
                                 isPast ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                          fontWeight: isCur ? 700 : 400,
                          borderBottom: isCur ? '2px solid var(--color-info)' : undefined,
                          letterSpacing: '0.05em',
                        }}
                      >
                        {fmtYm(ym)}
                        {isCur && <span style={{ marginLeft: 4, fontSize: 9 }}>▶</span>}
                        {isPast && <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.6 }}>실적</span>}
                      </th>
                    )
                  })}
                </tr>
                {/* Sub-column headers */}
                <tr>
                  {displayMonths.map(ym => {
                    const isPast = ym < todayYm
                    const isCur  = ym === centerYm
                    const hBg    = isCur ? 'var(--bg-info)' : isPast ? 'var(--bg-secondary)' : undefined
                    const hColor = isCur ? 'var(--text-info)' : undefined
                    return (
                      ['출고', '발주', '재고'].map(h => (
                        <th
                          key={ym + h}
                          style={{
                            textAlign: 'right', paddingRight: 8,
                            background: hBg, color: hColor,
                            fontWeight: 400, fontSize: 10,
                            borderRight: h === '재고' ? '1px solid var(--border-tertiary)' : undefined,
                          }}
                        >
                          {h}
                        </th>
                      ))
                    )
                  })}
                </tr>
              </thead>

              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={2 + N_MONTHS * 3} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
                      {search ? '검색 결과 없음' : '상품 데이터 없음'}
                    </td>
                  </tr>
                ) : rows.map(({ prod, startInv, months }) => {
                  const hasNegInv = months.some(m => m.inv !== null && m.inv < 0)

                  return (
                    <tr key={prod.product_id}>
                      {/* Product name — sticky */}
                      <td
                        style={{
                          position: 'sticky', left: 0, zIndex: 2,
                          background: hasNegInv ? 'var(--bg-danger)' : 'var(--bg-primary)',
                          borderRight: '1px solid var(--border)',
                          paddingLeft: 12,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          {prod.tier_code === 'cold' && (
                            <span className="chip chip-info" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, padding: '1px 4px' }}>
                              <IconSnowflake size={8} /> {TIER_LABEL.cold}
                            </span>
                          )}
                          {prod.tier_code && prod.tier_code !== 'cold' && (
                            <span className="chip chip-default" style={{ fontSize: 9, padding: '1px 4px' }}>
                              {TIER_LABEL[prod.tier_code] ?? prod.tier_code}
                            </span>
                          )}
                          {hasNegInv && <IconAlertTriangle size={10} style={{ color: 'var(--text-danger)', flexShrink: 0 }} />}
                        </div>
                        <div style={{ fontWeight: 500, fontSize: 12, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {prod.name_ja ?? prod.product_code}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                          {prod.product_code}
                        </div>
                      </td>

                      {/* Starting inventory — sticky */}
                      <td
                        style={{
                          position: 'sticky', left: COL_PROD, zIndex: 2,
                          background: 'var(--bg-secondary)',
                          borderRight: '2px solid var(--border)',
                          textAlign: 'right', paddingRight: 8,
                          fontWeight: 500,
                        }}
                      >
                        {startInv > 0 ? startInv.toLocaleString() : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </td>

                      {/* Month cells */}
                      {months.map(({ ym, isPast, isCur, salesEst, sales, ord, inv }) => {
                        const invNeg = inv !== null && inv < 0
                        const monthBg = isCur ? 'rgba(var(--rgb-info, 59,130,246),0.04)' : undefined

                        return (
                          <>
                            {/* 출고 */}
                            <td
                              key={ym + '-s'}
                              className="num"
                              style={{
                                paddingRight: 8,
                                background: monthBg,
                                color: isCur
                                  ? 'var(--text-info)'
                                  : isPast
                                    ? 'var(--text-primary)'
                                    : salesEst
                                      ? 'var(--text-tertiary)'
                                      : undefined,
                                fontWeight: isCur ? 600 : undefined,
                              }}
                            >
                              {num(sales)}
                              {salesEst && sales !== null && (
                                <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>예</span>
                              )}
                            </td>

                            {/* 발주 */}
                            <td
                              key={ym + '-o'}
                              className="num"
                              style={{
                                paddingRight: 8,
                                background: monthBg,
                                color: ord ? 'var(--text-info)' : undefined,
                                fontWeight: ord ? 600 : undefined,
                              }}
                            >
                              {ord ? ord.boxes.toLocaleString() : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                              {ord?.alert && (
                                <div style={{ fontSize: 9, color: 'var(--text-warning)' }}>!</div>
                              )}
                            </td>

                            {/* 재고 */}
                            <td
                              key={ym + '-i'}
                              className="num"
                              style={{
                                paddingRight: 8,
                                borderRight: '1px solid var(--border-tertiary)',
                                background: invNeg ? 'var(--bg-danger)' : monthBg,
                                color: invNeg ? 'var(--text-danger)' : 'var(--text-secondary)',
                                fontWeight: invNeg ? 600 : undefined,
                              }}
                            >
                              {inv === null
                                ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                                : inv.toLocaleString()}
                            </td>
                          </>
                        )
                      })}
                    </tr>
                  )
                })}

                {/* ── Totals row ─────────────────────────────────────────── */}
                {rows.length > 0 && (
                  <tr style={{ background: 'var(--bg-secondary)', fontWeight: 600, borderTop: '2px solid var(--border)' }}>
                    <td
                      style={{
                        position: 'sticky', left: 0, zIndex: 2,
                        background: 'var(--bg-secondary)',
                        borderRight: '1px solid var(--border)',
                        paddingLeft: 12, fontSize: 12,
                      }}
                    >
                      합계 ({rows.length}개 품목)
                    </td>
                    <td
                      style={{
                        position: 'sticky', left: COL_PROD, zIndex: 2,
                        background: 'var(--bg-secondary)',
                        borderRight: '2px solid var(--border)',
                        textAlign: 'right', paddingRight: 8,
                      }}
                    >
                      {totalStartInv.toLocaleString()}
                    </td>
                    {totals.map(({ ym, sales, ord, inv }) => {
                      const isCur = ym === centerYm
                      const monthBg = isCur ? 'rgba(59,130,246,0.06)' : undefined
                      return (
                        <>
                          <td key={ym + '-s'} className="num" style={{ paddingRight: 8, background: monthBg, color: isCur ? 'var(--text-info)' : undefined }}>
                            {sales.toLocaleString()}
                          </td>
                          <td key={ym + '-o'} className="num" style={{ paddingRight: 8, background: monthBg, color: ord > 0 ? 'var(--text-info)' : undefined }}>
                            {ord > 0 ? ord.toLocaleString() : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                          </td>
                          <td key={ym + '-i'} className="num" style={{ paddingRight: 8, borderRight: '1px solid var(--border-tertiary)', background: monthBg }}>
                            {inv !== null ? inv.toLocaleString() : '—'}
                          </td>
                        </>
                      )
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Upload actual modal ───────────────────────────────────────────── */}
      {showUpload && (
        <div className="modal-overlay" onClick={() => setShowUpload(false)}>
          <div
            className="modal-box"
            style={{ width: 680, maxWidth: '95vw' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-header">
              <span className="modal-title">실출고·재고 업로드</span>
              <button className="btn" style={{ padding: '2px 8px' }} onClick={() => setShowUpload(false)}>
                <IconX size={14} />
              </button>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
              {(['actual', 'stock'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => { setUploadTab(tab); setUploadMsg(null) }}
                  style={{
                    padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer',
                    fontFamily: 'var(--font)', fontSize: 12,
                    borderBottom: uploadTab === tab ? '2px solid var(--text-info)' : '2px solid transparent',
                    color: uploadTab === tab ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: uploadTab === tab ? 600 : 400,
                    marginBottom: -1,
                  }}
                >
                  {tab === 'actual' ? '📦 출고 실적 등록' : '🏭 기초 재고 등록'}
                </button>
              ))}
            </div>

            {/* Tab description */}
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.6 }}>
              {uploadTab === 'actual'
                ? '월별 재고현황 파일 (ESZ019R_DATEE.csv 등)을 업로드하면 출고수량(EA)을 EA/BOX로 나누어 DemandActual 박스 수로 등록합니다.'
                : '파일의 C/T(잔여재고 박스수) 열을 읽어 기초 재고(InventoryLot)를 등록합니다. 냉장 상품은 COLD존, 나머지는 AMBIENT존 자동 배정.'}
            </div>

            {/* File picker */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                <IconUpload size={13} /> 파일 선택
              </button>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                .csv, .xlsx, .xls 지원 (한국어 EUC-KR/UTF-8 자동 인식)
              </span>
            </div>

            {/* Parsed preview */}
            {parsedFile && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <div style={{ fontSize: 12 }}>
                    파일 파싱 완료 — <strong>{parsedFile.rows.length}</strong>개 품목,
                    매칭 <strong style={{ color: 'var(--text-success)' }}>{parsedFile.rows.filter(r => r.matched).length}</strong>건,
                    미매칭 <strong style={{ color: 'var(--text-danger)' }}>{parsedFile.rows.filter(r => !r.matched).length}</strong>건
                  </div>
                  {uploadTab === 'actual' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>등록 월</span>
                      <input
                        type="month"
                        className="pm-input"
                        value={uploadYm}
                        onChange={e => setUploadYm(e.target.value)}
                        style={{ width: 130 }}
                      />
                    </div>
                  )}
                </div>

                {/* Preview table */}
                <div style={{ maxHeight: 260, overflowY: 'auto', border: '0.5px solid var(--border)', borderRadius: 6, marginBottom: 12 }}>
                  <table className="pm-table" style={{ width: '100%', fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', paddingLeft: 8, width: 100 }}>항목코드</th>
                        <th style={{ textAlign: 'left', paddingLeft: 4 }}>상품명</th>
                        <th style={{ textAlign: 'right', paddingRight: 8, width: 80 }}>EA/BOX</th>
                        {uploadTab === 'actual' ? (
                          <>
                            <th style={{ textAlign: 'right', paddingRight: 8, width: 80 }}>출고(EA)</th>
                            <th style={{ textAlign: 'right', paddingRight: 8, width: 80 }}>출고(박스)</th>
                          </>
                        ) : (
                          <th style={{ textAlign: 'right', paddingRight: 8, width: 80 }}>재고(C/T)</th>
                        )}
                        <th style={{ textAlign: 'center', width: 52 }}>매칭</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedFile.rows.map((r, i) => (
                        <tr key={i} style={{ opacity: r.matched ? 1 : 0.5 }}>
                          <td style={{ paddingLeft: 8, fontFamily: 'monospace', fontSize: 10 }}>{r.code}</td>
                          <td style={{ paddingLeft: 4, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                          <td className="num" style={{ paddingRight: 8 }}>{r.eaPerBox}</td>
                          {uploadTab === 'actual' ? (
                            <>
                              <td className="num" style={{ paddingRight: 8 }}>{r.shippedEa.toLocaleString()}</td>
                              <td className="num" style={{ paddingRight: 8, fontWeight: 600 }}>{r.shippedBoxes}</td>
                            </>
                          ) : (
                            <td className="num" style={{ paddingRight: 8, fontWeight: 600 }}>{r.stockCt}</td>
                          )}
                          <td style={{ textAlign: 'center' }}>
                            {r.matched
                              ? <IconCircleCheck size={13} color="var(--text-success)" />
                              : <IconCircleX size={13} color="var(--text-danger)" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Result message */}
            {uploadMsg && (
              <div style={{
                padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 12,
                background: uploadMsg.ok ? 'var(--bg-success)' : 'var(--bg-danger)',
                color: uploadMsg.ok ? 'var(--text-success)' : 'var(--text-danger)',
              }}>
                {uploadMsg.text}
              </div>
            )}

            <div className="modal-footer">
              <button className="btn" onClick={() => setShowUpload(false)}>닫기</button>
              <button
                className="btn btn-primary"
                disabled={!parsedFile || uploading}
                onClick={uploadTab === 'actual' ? handleUploadActual : handleUploadStock}
              >
                {uploading ? '등록 중…' : uploadTab === 'actual' ? '출고 실적 등록' : '기초 재고 등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Run plan modal ────────────────────────────────────────────────── */}
      {showRunModal && (
        <div className="modal-overlay" onClick={() => setShowRunModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">발주계획 실행</span>
              <button className="btn" style={{ padding: '2px 8px' }} onClick={() => setShowRunModal(false)}>✕</button>
            </div>
            <div className="form-field">
              <label className="form-label">계획 기준월</label>
              <input type="month" className="pm-input" value={runYm} onChange={e => setRunYm(e.target.value)} />
              <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>해당 월부터 12개월 rolling 계획이 생성됩니다.</p>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowRunModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={handleRunPlan} disabled={running}>
                {running ? '실행 중…' : '실행'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
