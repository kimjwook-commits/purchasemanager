import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  IconPlayerPlay, IconCheck, IconAlertTriangle,
  IconSearch, IconChevronLeft, IconChevronRight, IconSnowflake,
  IconUpload, IconX, IconCircleCheck, IconCircleX,
  IconLock, IconLockOpen, IconDownload, IconSun,
  IconRefresh, IconShoppingCart,
} from '@tabler/icons-react'
import {
  getPlanRuns, getPlanLines, getPlanSummary, runPlan, approvePlan,
  getDemandActual, getInventoryLots, getProducts, getForecastDemand,
  bulkUpsertDemandActual, registerInitialLots, updatePlanLine, createPlanLine,
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

// 표준 사케 패키지 규격: volume_ml → 병/박스
function eaPerBox(prod: { bottles_per_box?: number; volume_ml?: number | null }): number {
  if (prod.bottles_per_box) return prod.bottles_per_box
  const ml = prod.volume_ml
  if (!ml) return 12
  if (ml >= 1800) return 6
  if (ml >= 700)  return 12
  if (ml >= 270)  return 24
  return 12
}

const TIER_LABEL: Record<string, string> = { cold: '생',   ambient: '일반', room: '상온' }
const TIER_CLS:   Record<string, string> = { cold: 'chip-info', ambient: 'chip-default', room: 'chip-warning' }
const N_MONTHS = 12
const COL_PROD  = 240
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
  const [forecastData, setForecastData] = useState<{ product_code: string; ym: string; qty_boxes: number }[]>([])
  const [lots, setLots]           = useState<InvLotRead[]>([])
  const [products, setProducts]   = useState<Product[]>([])
  const [centerYm, setCenterYm]   = useState(todayYm)
  const [search, setSearch]       = useState('')
  const [loading, setLoading]     = useState(true)
  const [running, setRunning]         = useState(false)
  const [forecasting, setForecasting] = useState(false)
  const [showRunModal, setShowRunModal] = useState(false)
  const [editMode, setEditMode]   = useState(false)
  const [editCell, setEditCell]   = useState<{ productId: number; ym: string; planLineId: number | null } | null>(null)
  const [editVal, setEditVal]     = useState('')
  const [runYm, setRunYm]         = useState(dayjs().format('YYYY-MM'))
  const scrollRef                 = useRef<HTMLDivElement>(null)

  // ── 간편 재고 업로드 state ───────────────────────────────────────────────
  const [simpleStockRows, setSimpleStockRows] = useState<{ product_code: string; qty_bottles: number; qty_boxes: number; matched: boolean; name_ja: string; zone_code: string }[]>([])
  const simpleStockRef = useRef<HTMLInputElement>(null)

  // ── 간편 출고실적 업로드 state ───────────────────────────────────────────
  const [simpleActualRows, setSimpleActualRows] = useState<{ product_code: string; ym: string; qty_boxes: number; matched: boolean; name_ja: string }[]>([])
  const simpleActualRef = useRef<HTMLInputElement>(null)

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

  // ── 상품·재고·실출고는 플랜 선택과 무관하게 항상 로드 ────────────────────────
  // 각 호출 독립 실행 — 하나 실패해도 나머지는 정상 로드
  useEffect(() => {
    getProducts({ size: 1000 }).then(r => setProducts(r.data?.items ?? []))
    getInventoryLots({ status: 'AVAILABLE' }).then(r => setLots(r.data ?? []))
    getDemandActual({ ym_from: addM(centerYm, -36) }).then(r => setDemandData(r.data ?? []))
    getForecastDemand({ horizon: 12 }).then(r => setForecastData(r.data ?? []))
  }, [centerYm])

  // ── 플랜 선택 시 플랜라인·서머리만 로드 ──────────────────────────────────────
  useEffect(() => {
    if (!selected) return
    Promise.all([
      getPlanLines(selected.plan_run_id),
      getPlanSummary(selected.plan_run_id),
    ]).then(([lRes, sRes]) => {
      setLines(lRes.data ?? [])
      setSummary(sRes.data.months ?? [])
    })
  }, [selected])

  // ── scroll buttons ───────────────────────────────────────────────────────
  const scroll = (d: 'left' | 'right') =>
    scrollRef.current?.scrollBy({ left: d === 'left' ? -280 : 280, behavior: 'smooth' })

  // ── display months: centerYm … centerYm+11 ───────────────────────────────
  const displayMonths = useMemo(
    () => Array.from({ length: N_MONTHS }, (_, i) => addM(centerYm, i)),
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

  // 예측 맵: product_code → ym → qty_boxes
  const forecastMap = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    forecastData.forEach(d => {
      if (!m.has(d.product_code)) m.set(d.product_code, new Map())
      m.get(d.product_code)!.set(d.ym, d.qty_boxes)
    })
    return m
  }, [forecastData])

  // plan lines by order_ym
  const orderByOym = useMemo(() => {
    const m = new Map<number, Map<string, { boxes: number; alert: string | null; planLineId: number }>>()
    lines.forEach(l => {
      if (!m.has(l.product_id)) m.set(l.product_id, new Map())
      m.get(l.product_id)!.set(l.order_ym, { boxes: l.order_boxes, alert: l.alert, planLineId: l.plan_line_id })
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
    const regular = products.filter(p => !p.product_type || p.product_type === 'regular')
    const filtered = q
      ? regular.filter(p =>
          p.product_code?.toLowerCase().includes(q) ||
          p.name_ja?.toLowerCase().includes(q))
      : regular

    return filtered.map(prod => {
      const startInv = invMap.get(prod.product_id) ?? 0   // 병수
      const avgDem   = avgDemandMap.get(prod.product_id) ?? 0  // 박스 단위
      const epb      = eaPerBox(prod)
      let runInv     = startInv                            // 병수로 롤링

      const months = displayMonths.map((ym, idx) => {
        const isPast    = ym < todayYm
        const isCur     = ym === centerYm
        const isFcst    = ym >= todayYm

        // 출고: actual > 알고리즘예측 > 단순평균 순서로 적용
        const actualDem   = demandMap.get(prod.product_id)?.get(ym)
        const forecastDem = forecastMap.get(prod.product_code)?.get(ym)
        const sales = actualDem !== undefined
          ? actualDem
          : (isFcst || isCur)
            ? (forecastDem !== undefined ? forecastDem : avgDem)
            : null
        const salesEst  = actualDem === undefined && (isFcst || isCur)

        const ord = orderByOym.get(prod.product_id)?.get(ym) ?? null

        // 재고(병수): 첫달=시작재고-출고, 이후=전월재고+전월발주*epb-출고
        const arrival = idx === 0 ? 0 : (arrivalMap.get(prod.product_id)?.get(ym) ?? 0)
        runInv = runInv + arrival * epb - (sales ?? 0) * epb
        const inv = runInv

        return { ym, isPast, isCur, isFcst, sales, salesEst, ord, inv }
      })

      return { prod, startInv, months }
    })
  }, [products, search, invMap, demandMap, avgDemandMap, forecastMap, orderByOym, arrivalMap,
      displayMonths, todayYm, centerYm])

  // ── totals (출고·재고=병수, 발주=박스수) ────────────────────────────────────
  const totals = useMemo(() => {
    return displayMonths.map(ym => {
      let sales = 0, ord = 0, inv = 0, invCount = 0
      rows.forEach(r => {
        const m = r.months.find(x => x.ym === ym)
        if (!m) return
        const epb = eaPerBox(r.prod)
        sales += (m.sales ?? 0) * epb
        ord   += m.ord?.boxes ?? 0
        if (m.inv !== null) { inv += Math.max(0, m.inv); invCount++ }
      })
      return { ym, sales, ord, inv: invCount > 0 ? inv : null }
    })
  }, [rows, displayMonths])

  const totalStartInv = useMemo(() => {
    let total = 0
    products.forEach(p => { total += invMap.get(p.product_id) ?? 0 })
    return total
  }, [invMap, products])

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
      // reload demand data + re-run forecast
      const ymFrom = addM(centerYm, -36)
      getDemandActual({ ym_from: ymFrom }).then(r => setDemandData(r.data ?? []))
      getForecastDemand({ horizon: 12 }).then(r => setForecastData(r.data ?? []))
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

  // ── 기초재고 템플릿 다운로드 ────────────────────────────────────────────────
  const downloadStockTemplate = () => {
    const regular = products.filter(p => !p.product_type || p.product_type === 'regular')
    const headers = ['SKU코드', '기초재고(병수)']
    const rows = regular.map(p => [p.product_code, ''])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{ wch: 16 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '기초재고')
    XLSX.writeFile(wb, `기초재고템플릿_${dayjs().format('YYYYMMDD')}.xlsx`)
  }

  // ── 출고실적 템플릿 다운로드 (피벗: 상품 세로 × 월 가로) ──────────────────
  const downloadActualTemplate = () => {
    const regular = products.filter(p => !p.product_type || p.product_type === 'regular')
    // 최근 36개월 (당월 포함, 2024년 초부터 커버)
    const months = Array.from({ length: 36 }, (_, i) => addM(todayYm, i - 35))
    const headers = ['SKU코드', ...months]
    const rows = regular.map(p => [p.product_code, ...months.map(() => '')])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
    ws['!cols'] = [{ wch: 16 }, ...months.map(() => ({ wch: 10 }))]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '출고실적')
    XLSX.writeFile(wb, `출고실적템플릿_${dayjs().format('YYYYMMDD')}.xlsx`)
  }

  // ── 출고실적 파일 파싱 (피벗 형식) ──────────────────────────────────────
  const handleActualTemplateFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploadMsg(null)
    try {
      const buf = await file.arrayBuffer()
      const wb  = XLSX.read(buf, { type: 'array' })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' }) as string[][]
      const hdr = raw[0]?.map(h => String(h).trim()) ?? []

      // SKU코드 열
      const codeIdx = hdr.findIndex(h => h.includes('SKU') || h.toLowerCase().includes('product') || h.includes('코드'))
      if (codeIdx < 0) throw new Error('"SKU코드" 열을 찾을 수 없습니다')

      // YYYY-MM 형식인 열들을 모두 찾아 월 컬럼으로 인식
      const monthCols = hdr
        .map((h, i) => ({ ym: h, i }))
        .filter(({ ym }) => /^\d{4}-\d{2}$/.test(ym))
      if (monthCols.length === 0) throw new Error('YYYY-MM 형식의 월 컬럼을 찾을 수 없습니다')

      const productMap = new Map(products.map(p => [p.product_code, p]))
      const parsed: typeof simpleActualRows = []

      for (const row of raw.slice(1)) {
        const product_code = String(row[codeIdx] ?? '').trim()
        if (!product_code) continue
        const prod = productMap.get(product_code)
        for (const { ym, i } of monthCols) {
          const qty_boxes = parseInt(String(row[i] ?? '').replace(/,/g, '')) || 0
          if (qty_boxes > 0) {
            parsed.push({
              product_code,
              ym,
              qty_boxes,
              matched: !!prod,
              name_ja: prod?.name_ja ?? '—',
            })
          }
        }
      }
      if (parsed.length === 0) throw new Error('등록할 데이터가 없습니다. 출고수량을 입력했는지 확인해주세요.')
      setSimpleActualRows(parsed)
    } catch (err) {
      setUploadMsg({ ok: false, text: String(err instanceof Error ? err.message : err) })
    }
    e.target.value = ''
  }

  const handleRegisterSimpleActual = async () => {
    const valid = simpleActualRows.filter(r => r.matched && r.qty_boxes > 0)
    if (valid.length === 0) return
    setUploading(true); setUploadMsg(null)
    try {
      const productMap = new Map(products.map(p => [p.product_code, p]))
      const res = await bulkUpsertDemandActual(valid.map(r => {
        const prod = productMap.get(r.product_code)
        const epb  = prod ? eaPerBox(prod) : 1
        return {
          product_code: r.product_code,
          ym: r.ym,
          qty_boxes: Math.round(r.qty_boxes / epb),   // 병수 → 박스 변환
        }
      }), true)
      const d = res.data
      setUploadMsg({ ok: true, text: `완료: 등록/업데이트 ${d.upserted ?? 0}건, 건너뜀 ${d.skipped ?? 0}건` })
      setSimpleActualRows([])
      const ymFrom = addM(centerYm, -36)
      getDemandActual({ ym_from: ymFrom }).then(r => setDemandData(r.data ?? []))
      getForecastDemand({ horizon: 12 }).then(r => setForecastData(r.data ?? []))
    } catch (err) {
      setUploadMsg({ ok: false, text: String(err instanceof Error ? err.message : err) })
    } finally { setUploading(false) }
  }

  // ── 간편 재고 파일 파싱 ─────────────────────────────────────────────────────
  const handleSimpleStockFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploadMsg(null)
    try {
      const buf = await file.arrayBuffer()
      const wb  = XLSX.read(buf, { type: 'array' })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' }) as string[][]
      const hdr = raw[0]?.map(h => String(h).trim()) ?? []
      const codeIdx = hdr.findIndex(h => h.includes('SKU') || h.toLowerCase().includes('product') || h.includes('코드'))
      const qtyIdx  = hdr.findIndex(h => h.includes('기초재고') || h.includes('병수') || h.includes('재고') || h.includes('수량'))
      if (codeIdx < 0 || qtyIdx < 0) throw new Error('"SKU코드"와 "기초재고(병수)" 열을 찾을 수 없습니다')
      const productMap = new Map(products.map(p => [p.product_code, p]))
      const parsed = raw.slice(1)
        .map(r => ({ product_code: String(r[codeIdx] ?? '').trim(), qty_bottles: parseInt(String(r[qtyIdx] ?? '0').replace(/,/g, '')) || 0 }))
        .filter(r => r.product_code)
        .map(r => {
          const prod = productMap.get(r.product_code)
          return {
            product_code: r.product_code,
            qty_bottles: r.qty_bottles,
            qty_boxes: r.qty_bottles,   // 병수 그대로 저장
            matched: !!prod,
            name_ja: prod?.name_ja ?? '—',
            zone_code: prod?.tier_code === 'cold' ? 'COLD' : 'AMBIENT',
          }
        })
      setSimpleStockRows(parsed)
    } catch (err) {
      setUploadMsg({ ok: false, text: String(err instanceof Error ? err.message : err) })
    }
    e.target.value = ''
  }

  const handleRegisterSimpleStock = async () => {
    const rows = simpleStockRows.filter(r => r.matched && r.qty_bottles > 0)
    if (rows.length === 0) return
    setUploading(true); setUploadMsg(null)
    try {
      const res = await registerInitialLots(rows.map(r => ({
        product_code: r.product_code,
        zone_code: r.zone_code,
        lot_no: `INIT-${r.product_code}-${dayjs().format('YYYYMM')}`,
        qty_boxes: r.qty_boxes,
        mfg_date: dayjs().format('YYYY-MM-DD'),
      })))
      setUploadMsg({ ok: true, text: `완료: 등록 ${res.data.created}건, 중복 건너뜀 ${res.data.skipped}건` })
      setSimpleStockRows([])
      getInventoryLots({ status: 'AVAILABLE' }).then(r => setLots(r.data ?? []))
    } catch (err) {
      setUploadMsg({ ok: false, text: String(err instanceof Error ? err.message : err) })
    } finally { setUploading(false) }
  }

  // ── handlers ─────────────────────────────────────────────────────────────
  const handleRunForecast = async () => {
    setForecasting(true)
    try {
      const r = await getForecastDemand({ horizon: 12 })
      setForecastData(r.data ?? [])
    } finally { setForecasting(false) }
  }

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

  const handleSaveEdit = async () => {
    if (!editCell || !selected) { setEditCell(null); return }
    const boxes = parseInt(editVal)
    if (isNaN(boxes) || boxes < 0) { setEditCell(null); return }
    try {
      if (editCell.planLineId !== null) {
        const res = await updatePlanLine(selected.plan_run_id, editCell.planLineId, { order_boxes: boxes })
        setLines(prev => prev.map(l =>
          l.plan_line_id === editCell.planLineId ? { ...l, order_boxes: res.data.order_boxes } : l
        ))
      } else {
        const res = await createPlanLine(selected.plan_run_id, {
          product_id: editCell.productId,
          order_ym: editCell.ym,
          order_boxes: boxes,
        })
        setLines(prev => [...prev, res.data])
      }
    } catch { /* 실패 시 원래 값 유지 */ }
    setEditCell(null)
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
            출고(병) · 발주(박스) · 재고(병) 실시간 계산 — <span style={{ color: 'var(--text-danger)' }}>음수 재고 = 발주 필요</span>
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
          <button className="btn" onClick={() => { setShowUpload(true); setParsedFile(null); setUploadMsg(null); setSimpleStockRows([]); setSimpleActualRows([]) }}>
            <IconUpload size={13} /> 실출고 업로드
          </button>
          {/* 출고예측 */}
          <button className="btn" onClick={handleRunForecast} disabled={forecasting}>
            <IconRefresh size={13} /> {forecasting ? '예측 중…' : '출고예측'}
          </button>
          {/* 발주예측 */}
          <button className="btn btn-info" onClick={() => setShowRunModal(true)}>
            <IconShoppingCart size={13} /> 발주예측
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
          {/* Edit mode toggle */}
          <button
            className={editMode ? 'btn btn-warning' : 'btn'}
            style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => { setEditMode(v => !v); setEditCell(null) }}
            title={editMode ? '수정 모드 ON — 클릭하면 잠금' : '클릭하면 발주량 수정 가능'}
          >
            {editMode ? <IconLockOpen size={13} /> : <IconLock size={13} />}
            {editMode ? '수정 ON' : '수정 잠금'}
          </button>
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
            <div className="value">{totalStartInv.toLocaleString()} 병</div>
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
                      background: 'var(--bg-secondary)',
                      borderRight: '2px solid var(--border)',
                      textAlign: 'right', paddingRight: 8,
                      fontSize: 10, fontWeight: 400, color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    시작재고<br />(병)
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
                      ['출고(병)', '발주(박스)', '재고(병)'].map(h => (
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
                  const nextYm = addM(centerYm, 1)
                  const hasNegInv = months.some(m => m.ym === nextYm && m.inv !== null && m.inv < 0)

                  const epb = eaPerBox(prod)
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
                          {prod.tier_code && (
                            <span
                              className={`chip ${TIER_CLS[prod.tier_code] ?? 'chip-default'}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, padding: '1px 4px' }}
                            >
                              {prod.tier_code === 'cold' && <IconSnowflake size={8} />}
                              {prod.tier_code === 'room'  && <IconSun size={8} />}
                              {TIER_LABEL[prod.tier_code] ?? prod.tier_code}
                            </span>
                          )}
                          {hasNegInv && <IconAlertTriangle size={10} style={{ color: 'var(--text-danger)', flexShrink: 0 }} />}
                        </div>
                        <div style={{ fontWeight: 500, fontSize: 12, marginTop: 2, wordBreak: 'break-word', lineHeight: 1.4 }}>
                          {prod.name_ja ?? prod.product_code}
                          {prod.volume_ml && (
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 4, fontWeight: 400 }}>
                              {prod.volume_ml}ml
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                          {prod.product_code}
                        </div>
                      </td>

                      {/* Starting inventory */}
                      <td
                        style={{
                          background: 'var(--bg-secondary)',
                          borderRight: '2px solid var(--border)',
                          textAlign: 'right', paddingRight: 8,
                          fontWeight: 500,
                        }}
                      >
                        {startInv > 0
                          ? <>{startInv.toLocaleString()}<span style={{ fontSize: 9, color: 'var(--text-tertiary)', marginLeft: 2 }}>병</span></>
                          : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </td>

                      {/* Month cells */}
                      {months.map(({ ym, isPast, isCur, salesEst, sales, ord, inv }) => {
                        const invNeg = inv !== null && inv < 0
                        const monthBg = isCur ? 'rgba(var(--rgb-info, 59,130,246),0.04)' : undefined

                        return (
                          <>
                            {/* 출고 (병수) */}
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
                              {num(sales !== null ? sales * epb : null)}
                              {salesEst && sales !== null && (
                                <span style={{ fontSize: 9, opacity: 0.6, marginLeft: 2 }}>예</span>
                              )}
                            </td>

                            {/* 발주 */}
                            {editCell?.productId === prod.product_id && editCell?.ym === ym ? (
                              <td
                                key={ym + '-o'}
                                className="num"
                                style={{ paddingRight: 4, paddingLeft: 4, background: 'var(--bg-info)' }}
                              >
                                <input
                                  type="number"
                                  min={0}
                                  autoFocus
                                  value={editVal}
                                  onChange={e => setEditVal(e.target.value)}
                                  onBlur={handleSaveEdit}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') handleSaveEdit()
                                    if (e.key === 'Escape') setEditCell(null)
                                  }}
                                  style={{
                                    width: '100%', textAlign: 'right',
                                    border: '1px solid var(--color-info)',
                                    borderRadius: 4, padding: '1px 4px',
                                    fontSize: 12, fontFamily: 'var(--font)',
                                    background: 'white',
                                  }}
                                />
                              </td>
                            ) : (
                              <td
                                key={ym + '-o'}
                                className="num"
                                onClick={() => {
                                  if (!editMode || isPast || !selected) return
                                  setEditCell({ productId: prod.product_id, ym, planLineId: ord?.planLineId ?? null })
                                  setEditVal(String(ord?.boxes ?? ''))
                                }}
                                style={{
                                  paddingRight: 8,
                                  background: isCur && ord ? 'rgba(var(--rgb-success,34,197,94),0.06)' : monthBg,
                                  color: ord
                                    ? isCur ? 'var(--text-success)' : 'var(--text-info)'
                                    : undefined,
                                  fontWeight: ord ? 600 : undefined,
                                  cursor: editMode && !isPast && selected ? 'text' : undefined,
                                  outline: editMode && !isPast && selected && !ord ? '1px dashed var(--border)' : undefined,
                                }}
                              >
                                {ord ? ord.boxes.toLocaleString() : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                                {ord?.alert && (
                                  <div style={{ fontSize: 9, color: 'var(--text-warning)' }}>!</div>
                                )}
                              </td>
                            )}

                            {/* 재고 (병수) */}
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
                              {inv.toLocaleString()}
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
                            {sales > 0 ? sales.toLocaleString() : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                          </td>
                          <td key={ym + '-o'} className="num" style={{ paddingRight: 8, background: monthBg, color: ord > 0 ? 'var(--text-info)' : undefined }}>
                            {ord > 0
                              ? <>{ord.toLocaleString()}<span style={{ fontSize: 9, color: 'var(--text-tertiary)', marginLeft: 2 }}>박스</span></>
                              : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
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
              <button className="btn" style={{ padding: '2px 8px' }} onClick={() => { setShowUpload(false); setSimpleStockRows([]); setSimpleActualRows([]) }}>
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
                ? '상품(세로) × 월(가로) 피벗 형식 템플릿을 다운로드해 해당 셀에 출고수량(병수)를 입력한 뒤 업로드하세요. 입력된 셀만 등록됩니다.'
                : '엑셀 템플릿을 다운로드해 기초재고(병수)를 기재한 뒤 업로드하세요. 냉장 상품 → COLD존, 나머지 → AMBIENT존 자동 배정.'}
            </div>

            {/* 출고실적 간편 업로드 (actual 탭) */}
            {uploadTab === 'actual' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <button className="btn btn-info" style={{ fontSize: 12 }} onClick={downloadActualTemplate}>
                    <IconDownload size={13} /> 엑셀 템플릿 다운로드
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    상품 세로 × 월 가로 형식 — 최근 12개월 포함, 해당 셀에 병수 입력
                  </span>
                </div>

                <input ref={simpleActualRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleActualTemplateFile} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <button className="btn btn-primary" onClick={() => simpleActualRef.current?.click()}>
                    <IconUpload size={13} /> 파일 선택
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>.xlsx / .xls / .csv 지원</span>
                </div>

                {simpleActualRows.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, marginBottom: 6 }}>
                      파싱 완료 —
                      총 <strong>{simpleActualRows.length}</strong>행 /
                      매칭 <strong style={{ color: 'var(--text-success)' }}>{simpleActualRows.filter(r => r.matched).length}</strong>건 /
                      미매칭 <strong style={{ color: 'var(--text-danger)' }}>{simpleActualRows.filter(r => !r.matched).length}</strong>건
                    </div>
                    <div style={{ maxHeight: 220, overflowY: 'auto', border: '0.5px solid var(--border)', borderRadius: 6, marginBottom: 10 }}>
                      <table className="pm-table" style={{ width: '100%', fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ paddingLeft: 8, width: 100 }}>SKU코드</th>
                            <th>상품명</th>
                            <th style={{ textAlign: 'center', width: 80 }}>년월</th>
                            <th style={{ textAlign: 'right', paddingRight: 8, width: 72 }}>병수</th>
                            <th style={{ textAlign: 'center', width: 48 }}>매칭</th>
                          </tr>
                        </thead>
                        <tbody>
                          {simpleActualRows.map((r, i) => (
                            <tr key={i} style={{ opacity: r.matched ? 1 : 0.45 }}>
                              <td style={{ paddingLeft: 8, fontFamily: 'monospace', fontSize: 10 }}>{r.product_code}</td>
                              <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name_ja}</td>
                              <td style={{ textAlign: 'center', fontSize: 11 }}>{r.ym}</td>
                              <td className="num" style={{ paddingRight: 8, fontWeight: 600 }}>{r.qty_boxes > 0 ? r.qty_boxes : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                              <td style={{ textAlign: 'center' }}>
                                {r.matched ? <IconCircleCheck size={13} color="var(--text-success)" /> : <IconCircleX size={13} color="var(--text-danger)" />}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="modal-footer" style={{ padding: 0, marginBottom: 12 }}>
                      <button className="btn" onClick={() => setSimpleActualRows([])}>초기화</button>
                      <button
                        className="btn btn-primary"
                        disabled={uploading || simpleActualRows.filter(r => r.matched && r.qty_boxes > 0).length === 0}
                        onClick={handleRegisterSimpleActual}
                      >
                        {uploading ? '등록 중…' : `출고실적 등록 (${simpleActualRows.filter(r => r.matched && r.qty_boxes > 0).length}건)`}
                      </button>
                    </div>
                  </>
                )}

                <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>또는 재고현황 파일(ESZ019R) 형식으로 업로드</div>
                </div>
              </div>
            )}

            {/* 기초 재고 간편 업로드 (stock 탭) */}
            {uploadTab === 'stock' && (
              <div style={{ marginBottom: 16 }}>
                {/* 템플릿 다운로드 */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <button className="btn btn-info" style={{ fontSize: 12 }} onClick={downloadStockTemplate}>
                    <IconDownload size={13} /> 엑셀 템플릿 다운로드
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    다운로드 → 기초재고(박스수) 열 기재 → 아래에 업로드
                  </span>
                </div>

                {/* 간편 파일 업로드 */}
                <input ref={simpleStockRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleSimpleStockFile} />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <button className="btn btn-primary" onClick={() => simpleStockRef.current?.click()}>
                    <IconUpload size={13} /> 파일 선택
                  </button>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>.xlsx / .xls / .csv 지원</span>
                </div>

                {/* 간편 파싱 결과 프리뷰 */}
                {simpleStockRows.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, marginBottom: 6 }}>
                      파싱 완료 —
                      매칭 <strong style={{ color: 'var(--text-success)' }}>{simpleStockRows.filter(r => r.matched).length}</strong>건 /
                      미매칭 <strong style={{ color: 'var(--text-danger)' }}>{simpleStockRows.filter(r => !r.matched).length}</strong>건 /
                      재고 0 <strong style={{ color: 'var(--text-tertiary)' }}>{simpleStockRows.filter(r => r.qty_bottles === 0).length}</strong>건
                    </div>
                    <div style={{ maxHeight: 220, overflowY: 'auto', border: '0.5px solid var(--border)', borderRadius: 6, marginBottom: 10 }}>
                      <table className="pm-table" style={{ width: '100%', fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th style={{ paddingLeft: 8, width: 100 }}>SKU코드</th>
                            <th>상품명</th>
                            <th style={{ textAlign: 'right', paddingRight: 8, width: 80 }}>기초재고(병)</th>
                            <th style={{ textAlign: 'center', width: 48 }}>매칭</th>
                          </tr>
                        </thead>
                        <tbody>
                          {simpleStockRows.map((r, i) => (
                            <tr key={i} style={{ opacity: r.matched ? 1 : 0.45 }}>
                              <td style={{ paddingLeft: 8, fontFamily: 'monospace', fontSize: 10 }}>{r.product_code}</td>
                              <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name_ja}</td>
                              <td className="num" style={{ paddingRight: 8, fontWeight: 600 }}>{r.qty_bottles > 0 ? r.qty_bottles.toLocaleString() : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                              <td style={{ textAlign: 'center' }}>
                                {r.matched ? <IconCircleCheck size={13} color="var(--text-success)" /> : <IconCircleX size={13} color="var(--text-danger)" />}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="modal-footer" style={{ padding: 0, marginBottom: 12 }}>
                      <button className="btn" onClick={() => setSimpleStockRows([])}>초기화</button>
                      <button
                        className="btn btn-primary"
                        disabled={uploading || simpleStockRows.filter(r => r.matched && r.qty_bottles > 0).length === 0}
                        onClick={handleRegisterSimpleStock}
                      >
                        {uploading ? '등록 중…' : `기초 재고 등록 (${simpleStockRows.filter(r => r.matched && r.qty_bottles > 0).length}건)`}
                      </button>
                    </div>
                  </>
                )}

                <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>또는 재고현황 파일(ESZ019R) 형식으로 업로드</div>
                </div>
              </div>
            )}

            {/* File picker (ESZ019R 형식 / actual 탭) */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <button className="btn" onClick={() => fileInputRef.current?.click()}>
                <IconUpload size={13} /> {uploadTab === 'stock' ? 'ESZ019R 파일 선택' : '파일 선택'}
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
              <span className="modal-title">발주예측 실행</span>
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
