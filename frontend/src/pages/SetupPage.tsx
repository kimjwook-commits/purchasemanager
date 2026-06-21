import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  IconCloudUpload, IconRefresh, IconPlus, IconX, IconFileSpreadsheet,
  IconTable, IconBuilding, IconCurrencyYen, IconThermometer,
  IconPackage, IconCalendar, IconSnowflake, IconSun, IconCircleCheck,
  IconUpload, IconDownload,
} from '@tabler/icons-react'
import {
  getExporters, createExporter,
  getBreweries, createBrewery,
  getProducts, createProduct,
  getTiers, updateTier, getContainerSpecs, updateContainerSpec,
  getExporterProducts, bulkCreateExporterProducts,
  getLatestFxRates, getFxRates, createFxRate,
  getSupplyPrices, createSupplyPrice,
  getDemandActual, bulkUpsertDemandActual,
  getInventoryLotsSummary, registerInitialLots,
} from '../api/api'
import type {
  FxRate, InvLotSummary, Exporter, Brewery, TemperatureTier,
  ExporterProduct, SupplyPrice, Product, ContainerSpec,
} from '../api/types'

type TabKey = 'sku' | 'exporter' | 'fx' | 'tier' | 'pallet' | 'calendar'

const TIER_META: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  cold:    { label: '생',   cls: 'chip-info',    icon: <IconSnowflake size={9} /> },
  ambient: { label: '일반', cls: 'chip-default',  icon: <IconSnowflake size={9} /> },
  room:    { label: '상온', cls: 'chip-warning',  icon: <IconSun size={9} /> },
}

function TierChip({ code }: { code: string | null }) {
  const m = TIER_META[code ?? '']
  if (!m) return <span className="chip chip-default">{code ?? '—'}</span>
  return (
    <span className={`chip ${m.cls}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {m.icon} {m.label}
    </span>
  )
}

// ── CSV 업로드 모달 ────────────────────────────────────────────────────────────
interface UploadModalProps {
  title: string
  templateHeader: string
  templateExample: string
  onClose: () => void
  onSubmit: (rows: string[][]) => Promise<string>
}

function UploadModal({ title, templateHeader, templateExample, onClose, onSubmit }: UploadModalProps) {
  const [csv, setCsv] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [fileName, setFileName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(''); setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const wb  = XLSX.read(buf, { type: 'array', codepage: 949 })
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const raw: (string | number | undefined)[][] =
        XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })

      // 헤더 행(첫 셀이 숫자가 아닌 문자 → 건너뜀)
      const dataRows = raw.filter(r => {
        const first = String(r[0] ?? '').trim()
        return first && !isNaN(Number(first.replace(/[^0-9]/g, ''))) ||
               /^[A-Z0-9]/.test(first)
      })

      const csvText = dataRows
        .map(r => r.map(c => String(c ?? '').trim()).join(','))
        .join('\n')
      setCsv(csvText)
    } catch (err) {
      setResult('오류: 파일을 읽을 수 없습니다 — ' + (err instanceof Error ? err.message : String(err)))
    }
    e.target.value = ''
  }

  const handleSubmit = async () => {
    const lines = csv.trim().split('\n').filter(l => l.trim())
    const rows  = lines.map(l => l.split(',').map(c => c.trim()))
    setLoading(true)
    try {
      const msg = await onSubmit(rows)
      setResult(msg)
    } catch (e: unknown) {
      setResult('오류: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 540 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="btn" style={{ padding: '2px 8px' }} onClick={onClose}><IconX size={13} /></button>
        </div>

        {/* File picker */}
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }} onChange={handleFile} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <button className="btn btn-info" style={{ fontSize: 11 }} onClick={() => fileRef.current?.click()}>
            <IconFileSpreadsheet size={13} /> 엑셀/CSV 파일 선택
          </button>
          {fileName && (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {fileName} — 아래에서 내용 확인 후 업로드
            </span>
          )}
        </div>

        {/* Column guide */}
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-secondary)', borderRadius: 6, padding: '6px 10px', fontFamily: 'monospace', marginBottom: 8 }}>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}># {templateHeader}</div>
          {templateExample}
        </div>

        <div className="form-label" style={{ marginBottom: 4 }}>직접 붙여넣기 또는 파일 선택 후 내용 확인</div>
        <textarea
          className="pm-input"
          style={{ width: '100%', minHeight: 160, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
          placeholder={templateExample}
          value={csv}
          onChange={e => setCsv(e.target.value)}
        />

        {result && (
          <div className={`alert ${result.startsWith('오류') ? 'alert-warning' : 'alert-success'}`} style={{ marginTop: 8, marginBottom: 0 }}>
            {result}
          </div>
        )}

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !csv.trim()}>
            {loading ? '업로드 중…' : '업로드'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 수출자 등록 모달 ──────────────────────────────────────────────────────────
function ExporterModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: '', name: '', country: 'JPN', contact_email: '' })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) { setErr('코드와 이름은 필수입니다'); return }
    setLoading(true); setErr('')
    try {
      await createExporter({ code: form.code.trim(), name: form.name.trim(), country: form.country, contact_email: form.contact_email || undefined })
      onSaved(); onClose()
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : '저장 실패') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">수출자 추가</span>
          <button className="btn" style={{ padding: '2px 8px' }} onClick={onClose}><IconX size={13} /></button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
            <div className="form-field">
              <label className="form-label">코드 *</label>
              <input className="pm-input" placeholder="e.g. DASSAI" value={form.code} onChange={set('code')} />
            </div>
            <div className="form-field">
              <label className="form-label">수출자명 *</label>
              <input className="pm-input" placeholder="e.g. 旭酒造株式会社" value={form.name} onChange={set('name')} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
            <div className="form-field">
              <label className="form-label">국가</label>
              <input className="pm-input" value={form.country} onChange={set('country')} maxLength={3} />
            </div>
            <div className="form-field">
              <label className="form-label">이메일</label>
              <input className="pm-input" type="email" placeholder="contact@example.com" value={form.contact_email} onChange={set('contact_email')} />
            </div>
          </div>
        </div>
        {err && <div className="alert alert-warning" style={{ marginTop: 8 }}>{err}</div>}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? '저장 중…' : <><IconPlus size={13} /> 추가</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 양조장 등록 모달 ──────────────────────────────────────────────────────────
function BreweryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', name_ja: '', country: 'JPN', region: '' })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    if (!form.name.trim()) { setErr('양조장명을 입력하세요'); return }
    setLoading(true); setErr('')
    try {
      await createBrewery({ name: form.name, name_ja: form.name_ja || undefined, country: form.country, region: form.region || undefined })
      onSaved(); onClose()
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : '저장 실패') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">양조장 추가</span>
          <button className="btn" style={{ padding: '2px 8px' }} onClick={onClose}><IconX size={13} /></button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="form-field">
            <label className="form-label">양조장명 *</label>
            <input className="pm-input" placeholder="e.g. 獺祭" value={form.name} onChange={set('name')} />
          </div>
          <div className="form-field">
            <label className="form-label">일본어명</label>
            <input className="pm-input" placeholder="e.g. 旭酒造" value={form.name_ja} onChange={set('name_ja')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="form-field">
              <label className="form-label">국가</label>
              <input className="pm-input" value={form.country} onChange={set('country')} maxLength={3} />
            </div>
            <div className="form-field">
              <label className="form-label">지역</label>
              <input className="pm-input" placeholder="e.g. 山口県" value={form.region} onChange={set('region')} />
            </div>
          </div>
        </div>
        {err && <div className="alert alert-warning" style={{ marginTop: 8 }}>{err}</div>}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? '저장 중…' : <><IconPlus size={13} /> 추가</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 상품 등록 모달 ────────────────────────────────────────────────────────────
function ProductModal({
  breweries, tiers, onClose, onSaved,
}: { breweries: Brewery[]; tiers: TemperatureTier[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    product_code: '', name_ja: '', name_ko: '',
    brewery_id: '' as number | '',
    tier_id: tiers[0]?.tier_id ?? '' as number | '',
    boxes_per_pallet: 40, volume_ml: '', alcohol_pct: '',
  })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    if (!form.product_code.trim() || !form.name_ja.trim() || !form.tier_id) {
      setErr('상품코드·상품명(일)·온도대는 필수입니다'); return
    }
    setLoading(true); setErr('')
    try {
      await createProduct({
        product_code: form.product_code.trim(),
        name_ja: form.name_ja.trim(),
        name_ko: form.name_ko.trim() || undefined,
        brewery_id: form.brewery_id ? Number(form.brewery_id) : undefined,
        tier_id: Number(form.tier_id),
        boxes_per_pallet: Number(form.boxes_per_pallet) || 40,
        volume_ml: form.volume_ml ? Number(form.volume_ml) : undefined,
        alcohol_pct: form.alcohol_pct ? Number(form.alcohol_pct) : undefined,
      })
      onSaved(); onClose()
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : '저장 실패') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 500 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">상품 추가</span>
          <button className="btn" style={{ padding: '2px 8px' }} onClick={onClose}><IconX size={13} /></button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="form-field">
              <label className="form-label">상품코드 *</label>
              <input className="pm-input" placeholder="N0010000" value={form.product_code} onChange={set('product_code')} />
            </div>
            <div className="form-field">
              <label className="form-label">온도대 *</label>
              <select className="pm-select" value={form.tier_id} onChange={set('tier_id')} style={{ width: '100%' }}>
                <option value="">선택</option>
                {tiers.map(t => <option key={t.tier_id} value={t.tier_id}>{t.name_ko}</option>)}
              </select>
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">상품명 (일본어) *</label>
            <input className="pm-input" placeholder="獺祭 純米大吟醸45" value={form.name_ja} onChange={set('name_ja')} />
          </div>
          <div className="form-field">
            <label className="form-label">상품명 (한국어)</label>
            <input className="pm-input" placeholder="닷사이 준마이다이긴죠45" value={form.name_ko} onChange={set('name_ko')} />
          </div>
          <div className="form-field">
            <label className="form-label">양조장</label>
            <select className="pm-select" value={form.brewery_id} onChange={set('brewery_id')} style={{ width: '100%' }}>
              <option value="">— 선택 안함 —</option>
              {breweries.map(b => <option key={b.brewery_id} value={b.brewery_id}>{b.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div className="form-field">
              <label className="form-label">팔레트당 박스</label>
              <input className="pm-input" type="number" value={form.boxes_per_pallet} onChange={set('boxes_per_pallet')} />
            </div>
            <div className="form-field">
              <label className="form-label">용량(ml)</label>
              <input className="pm-input" type="number" placeholder="720" value={form.volume_ml} onChange={set('volume_ml')} />
            </div>
            <div className="form-field">
              <label className="form-label">도수(%)</label>
              <input className="pm-input" type="number" step="0.1" placeholder="15.5" value={form.alcohol_pct} onChange={set('alcohol_pct')} />
            </div>
          </div>
        </div>
        {err && <div className="alert alert-warning" style={{ marginTop: 8 }}>{err}</div>}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? '저장 중…' : <><IconPlus size={13} /> 추가</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 수출자↔상품 매핑 모달 ────────────────────────────────────────────────────
function MappingModal({
  exporters, onClose, onSaved,
}: { exporters: Exporter[]; onClose: () => void; onSaved: () => void }) {
  const [exporterId, setExporterId] = useState<number | ''>(exporters[0]?.exporter_id ?? '')
  const [codes, setCodes] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null)

  const handleSave = async () => {
    if (!exporterId) return
    const list = codes.split(/[\n,]/).map(c => c.trim()).filter(Boolean)
    if (list.length === 0) return
    setLoading(true); setResult(null)
    try {
      const res = await bulkCreateExporterProducts(Number(exporterId), list)
      setResult(res.data)
      if (res.data.created > 0) onSaved()
    } catch (e: unknown) {
      setResult({ created: 0, skipped: 0, errors: [e instanceof Error ? e.message : '오류'] })
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">수출자↔상품 매핑</span>
          <button className="btn" style={{ padding: '2px 8px' }} onClick={onClose}><IconX size={13} /></button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="form-field">
            <label className="form-label">수출자 *</label>
            <select className="pm-select" value={exporterId} onChange={e => setExporterId(Number(e.target.value))} style={{ width: '100%' }}>
              <option value="">선택</option>
              {exporters.map(ex => <option key={ex.exporter_id} value={ex.exporter_id}>{ex.code} — {ex.name}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label className="form-label">상품코드 목록 (줄바꿈 또는 쉼표 구분)</label>
            <textarea
              className="pm-input"
              style={{ width: '100%', minHeight: 120, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
              placeholder={'N0010000\nN0020000\nS0010000'}
              value={codes}
              onChange={e => setCodes(e.target.value)}
            />
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
              이미 매핑된 상품코드는 건너뜁니다.
            </div>
          </div>
        </div>
        {result && (
          <div className={`alert ${result.errors.length > 0 ? 'alert-warning' : 'alert-success'}`} style={{ marginTop: 8 }}>
            매핑 완료 {result.created}건, 중복 건너뜀 {result.skipped}건
            {result.errors.length > 0 && <div style={{ marginTop: 4, fontSize: 11 }}>{result.errors.slice(0, 3).join(' · ')}</div>}
          </div>
        )}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading || !exporterId || !codes.trim()}>
            {loading ? '등록 중…' : '매핑 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 공급가 등록 모달 ──────────────────────────────────────────────────────────
function SupplyPriceModal({
  exporters, onClose, onSaved,
}: { exporters: Exporter[]; onClose: () => void; onSaved: () => void }) {
  const [exporterId, setExporterId] = useState<number | ''>(exporters[0]?.exporter_id ?? '')
  const [eps, setEps]               = useState<ExporterProduct[]>([])
  const [epId, setEpId]             = useState<number | ''>('')
  const [prices, setPrices]         = useState<SupplyPrice[]>([])
  const [form, setForm]             = useState({ supply_price: '', currency: 'JPY', effective_date: new Date().toISOString().slice(0, 10) })
  const [loading, setLoading]       = useState(false)
  const [err, setErr]               = useState('')

  useEffect(() => {
    if (!exporterId) return
    getExporterProducts({ exporter_id: Number(exporterId) }).then(r => { setEps(r.data); setEpId('') })
  }, [exporterId])

  useEffect(() => {
    if (!epId) return
    getSupplyPrices({ ep_id: Number(epId) }).then(r => setPrices(r.data))
  }, [epId])

  const handleSave = async () => {
    if (!epId || !form.supply_price) { setErr('매핑상품과 공급가를 입력하세요'); return }
    setLoading(true); setErr('')
    try {
      await createSupplyPrice({ ep_id: Number(epId), supply_price: Number(form.supply_price), currency: form.currency, effective_date: form.effective_date })
      onSaved()
      getSupplyPrices({ ep_id: Number(epId) }).then(r => setPrices(r.data))
      setForm(f => ({ ...f, supply_price: '' }))
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : '저장 실패') }
    finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">공급가 등록</span>
          <button className="btn" style={{ padding: '2px 8px' }} onClick={onClose}><IconX size={13} /></button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="form-field">
            <label className="form-label">수출자</label>
            <select className="pm-select" value={exporterId} onChange={e => setExporterId(Number(e.target.value))} style={{ width: '100%' }}>
              <option value="">선택</option>
              {exporters.map(ex => <option key={ex.exporter_id} value={ex.exporter_id}>{ex.code} — {ex.name}</option>)}
            </select>
          </div>
          {eps.length > 0 && (
            <div className="form-field">
              <label className="form-label">매핑 상품</label>
              <select className="pm-select" value={epId} onChange={e => setEpId(Number(e.target.value))} style={{ width: '100%' }}>
                <option value="">선택</option>
                {eps.map(ep => <option key={ep.ep_id} value={ep.ep_id}>{ep.product_code} — {ep.name_ja}</option>)}
              </select>
            </div>
          )}
          {epId && (
            <>
              {prices.length > 0 && (
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>기존 공급가 이력</div>
                  {prices.slice(0, 3).map(p => (
                    <div key={p.price_id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{p.effective_date}</span>
                      <span>{p.supply_price.toLocaleString()} {p.currency}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
                <div className="form-field">
                  <label className="form-label">공급가 *</label>
                  <input className="pm-input" type="number" step="0.01" placeholder="12000" value={form.supply_price} onChange={e => setForm(f => ({ ...f, supply_price: e.target.value }))} />
                </div>
                <div className="form-field">
                  <label className="form-label">통화</label>
                  <input className="pm-input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))} maxLength={3} />
                </div>
                <div className="form-field">
                  <label className="form-label">적용일</label>
                  <input className="pm-input" type="date" value={form.effective_date} onChange={e => setForm(f => ({ ...f, effective_date: e.target.value }))} />
                </div>
              </div>
            </>
          )}
        </div>
        {err && <div className="alert alert-warning" style={{ marginTop: 8 }}>{err}</div>}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading || !epId}>
            {loading ? '저장 중…' : '공급가 등록'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── FX 환율 등록 모달 ─────────────────────────────────────────────────────────
interface FxModalProps {
  rates: FxRate[]
  onClose: () => void
  onSaved: () => void
}

function FxModal({ rates, onClose, onSaved }: FxModalProps) {
  const [base, setBase] = useState('JPY')
  const [quote, setQuote] = useState('KRW')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [rate, setRate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!rate || isNaN(Number(rate))) { setError('환율 값을 입력하세요'); return }
    setLoading(true)
    try {
      await createFxRate({ base_currency: base, quote_currency: quote, rate_date: date, rate: Number(rate) })
      onSaved()
      onClose()
    } catch {
      setError('저장 실패')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">환율 등록</span>
          <button className="btn" style={{ padding: '2px 8px' }} onClick={onClose}><IconX size={13} /></button>
        </div>

        <table className="pm-table" style={{ marginBottom: 16 }}>
          <thead><tr><th>통화쌍</th><th>기준일</th><th className="num">환율</th></tr></thead>
          <tbody>
            {rates.map(r => (
              <tr key={r.rate_id}>
                <td>{r.base_currency}/{r.quote_currency}</td>
                <td>{r.rate_date}</td>
                <td className="num">{r.rate.toLocaleString()}</td>
              </tr>
            ))}
            {rates.length === 0 && (
              <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-tertiary)' }}>없음</td></tr>
            )}
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <div className="form-label">기준통화</div>
            <input className="pm-input" value={base} onChange={e => setBase(e.target.value.toUpperCase())} maxLength={3} />
          </div>
          <div>
            <div className="form-label">대상통화</div>
            <input className="pm-input" value={quote} onChange={e => setQuote(e.target.value.toUpperCase())} maxLength={3} />
          </div>
          <div>
            <div className="form-label">기준일</div>
            <input className="pm-input" type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <div className="form-label">환율</div>
            <input className="pm-input" type="number" step="0.01" placeholder="9.45" value={rate} onChange={e => setRate(e.target.value)} />
          </div>
        </div>

        {error && <div className="alert alert-warning" style={{ marginBottom: 8 }}>{error}</div>}

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>닫기</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            <IconPlus size={13} /> 추가
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 온도 티어 탭 (인라인 편집) ────────────────────────────────────────────────
function TierTab({ tiers, onSaved }: { tiers: TemperatureTier[]; onSaved: () => void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const [form, setForm] = useState({ review_cycle_months: '', lead_time_months: '', shelf_life_months: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const startEdit = (t: TemperatureTier) => {
    setEditing(t.tier_id)
    setForm({
      review_cycle_months: String(t.review_cycle_months),
      lead_time_months: String(t.lead_time_months),
      shelf_life_months: String(t.shelf_life_months),
    })
    setErr('')
  }

  const handleSave = async (tier_id: number) => {
    const r = parseInt(form.review_cycle_months)
    const l = parseInt(form.lead_time_months)
    const s = parseInt(form.shelf_life_months)
    if (isNaN(r) || isNaN(l) || isNaN(s) || r < 1 || l < 1 || s < 1) {
      setErr('모든 값은 1 이상의 정수여야 합니다')
      return
    }
    setSaving(true); setErr('')
    try {
      await updateTier(tier_id, { review_cycle_months: r, lead_time_months: l, shelf_life_months: s })
      onSaved()
      setEditing(null)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '저장 실패')
    } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ maxWidth: 700 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>온도 티어 기본값</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 }}>
        R = 검토주기(개월) · L = 리드타임(개월) · 보관월 = 유통기한 — 행을 클릭해 수정
      </div>
      {err && <div className="alert alert-warning" style={{ marginBottom: 8 }}>{err}</div>}
      <table className="pm-table">
        <thead>
          <tr>
            <th style={{ paddingLeft: 12 }}>티어</th>
            <th className="num">R (검토주기)</th>
            <th className="num">L (리드타임)</th>
            <th className="num">보관월</th>
            <th>R+L ≤ 보관</th>
            <th>콜드체인</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {tiers.map(t => {
            const isEdit = editing === t.tier_id
            const r = isEdit ? parseInt(form.review_cycle_months) || 0 : t.review_cycle_months
            const l = isEdit ? parseInt(form.lead_time_months) || 0 : t.lead_time_months
            const s = isEdit ? parseInt(form.shelf_life_months) || 0 : t.shelf_life_months
            const ok = r + l <= s
            const isCold = t.code === 'cold'
            const isAmb  = t.code === 'ambient'
            return (
              <tr key={t.tier_id} style={{ background: isEdit ? 'var(--bg-secondary)' : undefined }}>
                <td style={{ paddingLeft: 12 }}><TierChip code={t.code} /></td>
                <td className="num">
                  {isEdit
                    ? <input className="pm-input" type="number" min={1} style={{ width: 60, textAlign: 'right' }}
                        value={form.review_cycle_months} onChange={e => setForm(f => ({ ...f, review_cycle_months: e.target.value }))} />
                    : t.review_cycle_months}
                </td>
                <td className="num">
                  {isEdit
                    ? <input className="pm-input" type="number" min={1} style={{ width: 60, textAlign: 'right' }}
                        value={form.lead_time_months} onChange={e => setForm(f => ({ ...f, lead_time_months: e.target.value }))} />
                    : t.lead_time_months}
                </td>
                <td className="num">
                  {isEdit
                    ? <input className="pm-input" type="number" min={1} style={{ width: 60, textAlign: 'right' }}
                        value={form.shelf_life_months} onChange={e => setForm(f => ({ ...f, shelf_life_months: e.target.value }))} />
                    : t.shelf_life_months}
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12,
                    color: ok ? 'var(--text-success)' : 'var(--text-danger)' }}>
                    <IconCircleCheck size={13} /> {ok ? 'OK' : 'NG'}
                  </span>
                </td>
                <td><span style={{ fontSize: 16 }}>{isCold || isAmb ? '❄️' : '☀️'}</span></td>
                <td style={{ textAlign: 'right', paddingRight: 12 }}>
                  {isEdit ? (
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setEditing(null)}>취소</button>
                      <button className="btn btn-primary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => handleSave(t.tier_id)} disabled={saving}>
                        {saving ? '…' : '저장'}
                      </button>
                    </div>
                  ) : (
                    <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => startEdit(t)}>수정</button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── 팔레트·컨테이너 탭 (인라인 편집) ─────────────────────────────────────────
function PalletTab({ specs, tiers, onSaved }: { specs: ContainerSpec[]; tiers: TemperatureTier[]; onSaved: () => void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const [form, setForm] = useState({ max_pallets: '', cost_usd: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const startEdit = (s: ContainerSpec) => {
    setEditing(s.spec_id)
    setForm({ max_pallets: String(s.max_pallets), cost_usd: String(s.cost_usd) })
    setErr('')
  }

  const handleSave = async (spec_id: number) => {
    const mp = parseInt(form.max_pallets)
    const cu = parseFloat(form.cost_usd)
    if (isNaN(mp) || isNaN(cu) || mp < 1 || cu < 0) {
      setErr('팔레트 수는 1 이상, 운임은 0 이상이어야 합니다')
      return
    }
    setSaving(true); setErr('')
    try {
      await updateContainerSpec(spec_id, { max_pallets: mp, cost_usd: cu })
      onSaved()
      setEditing(null)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '저장 실패')
    } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ maxWidth: 700 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>팔레트·컨테이너 규칙</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 }}>
        모듈 4(적재) 및 발주장 계산에서 참조 — 컨테이너 행을 클릭해 수정
      </div>
      {err && <div className="alert alert-warning" style={{ marginBottom: 8 }}>{err}</div>}
      <table className="pm-table">
        <thead>
          <tr>
            <th style={{ paddingLeft: 12 }}>컨테이너</th>
            <th className="num">최대 팔레트</th>
            <th className="num">운임 (USD)</th>
            <th style={{ width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ paddingLeft: 12, color: 'var(--text-tertiary)', fontSize: 12 }} colSpan={3}>단수(레이어) 단위 발주 — 항상 단수 배수로 올림 적용</td>
            <td />
          </tr>
          {specs.map(s => {
            const tier = tiers.find(t => t.tier_id === s.tier_id)
            const isEdit = editing === s.spec_id
            return (
              <tr key={s.spec_id} style={{ background: isEdit ? 'var(--bg-secondary)' : undefined }}>
                <td style={{ paddingLeft: 12, fontWeight: 500 }}>
                  {tier ? <TierChip code={tier.code} /> : ''} <span style={{ fontSize: 12 }}>{s.container_type} 컨테이너</span>
                </td>
                <td className="num">
                  {isEdit
                    ? <input className="pm-input" type="number" min={1} style={{ width: 70, textAlign: 'right' }}
                        value={form.max_pallets} onChange={e => setForm(f => ({ ...f, max_pallets: e.target.value }))} />
                    : <span className="chip chip-default">{s.max_pallets} PL</span>}
                </td>
                <td className="num">
                  {isEdit
                    ? <input className="pm-input" type="number" min={0} step={100} style={{ width: 90, textAlign: 'right' }}
                        value={form.cost_usd} onChange={e => setForm(f => ({ ...f, cost_usd: e.target.value }))} />
                    : `$${s.cost_usd.toLocaleString()}`}
                </td>
                <td style={{ textAlign: 'right', paddingRight: 12 }}>
                  {isEdit ? (
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setEditing(null)}>취소</button>
                      <button className="btn btn-primary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => handleSave(s.spec_id)} disabled={saving}>
                        {saving ? '…' : '저장'}
                      </button>
                    </div>
                  ) : (
                    <button className="btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => startEdit(s)}>수정</button>
                  )}
                </td>
              </tr>
            )
          })}
          <tr>
            <td style={{ paddingLeft: 12, fontSize: 12, color: 'var(--text-secondary)' }}>혼적 허용</td>
            <td colSpan={2}><span className="chip chip-warning">불가 — 콜드/상온 혼적은 별도 승인</span></td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ── 엑셀 템플릿 다운로드 헬퍼 ──────────────────────────────────────────────────
function downloadTemplate(filename: string, headers: string[], examples: (string | number)[][]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples])
  // 헤더 행 굵게 (column widths)
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 14) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function SetupPage() {
  const [tab, setTab]             = useState<TabKey>('sku')
  const [products, setProducts]   = useState<Product[]>([])
  const [exporters, setExporters] = useState<Exporter[]>([])
  const [breweries, setBreweries] = useState<Brewery[]>([])
  const [eps, setEps]             = useState<ExporterProduct[]>([])
  const [tiers, setTiers]         = useState<TemperatureTier[]>([])
  const [fxRates, setFxRates]     = useState<FxRate[]>([])
  const [specs, setSpecs]         = useState<ContainerSpec[]>([])
  const [prices, setPrices]       = useState<SupplyPrice[]>([])
  const [invSummary, setInvSummary] = useState<InvLotSummary | null>(null)
  const [loading, setLoading]     = useState(true)

  // SKU 탭 필터
  const [skuSearch, setSkuSearch] = useState('')
  const [skuTier, setSkuTier]     = useState<string>('')

  const [modal, setModal] = useState<'fx' | 'demand' | 'inv' | 'exporter' | 'brewery' | 'product' | 'mapping' | 'price' | null>(null)

  // 하위 호환용 (UploadModal handlers)
  const [demandCount, setDemandCount] = useState<number | null>(null)

  const load = () => {
    setLoading(true)
    Promise.all([
      getProducts({ size: 500 }),
      getExporters(),
      getBreweries(),
      getExporterProducts(),
      getTiers(),
      getFxRates(),
      getContainerSpecs(),
      getSupplyPrices({ current_only: true }),
      getInventoryLotsSummary(),
      getDemandActual(),
    ]).then(([pr, ex, br, ep, ti, fx, sp, prices, inv, da]) => {
      setProducts(pr.data.items ?? [])
      setExporters(ex.data)
      setBreweries(br.data)
      setEps(ep.data)
      setTiers(ti.data)
      setFxRates(fx.data)
      setSpecs(sp.data)
      setPrices(prices.data)
      setInvSummary(inv.data)
      setDemandCount(da.data.length)
    }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // ── 파생 데이터 ─────────────────────────────────────────────────────────────
  const priceByEp = useMemo(() => {
    const m = new Map<number, SupplyPrice>()
    prices.forEach(p => { if (!m.has(p.ep_id)) m.set(p.ep_id, p) })
    return m
  }, [prices])

  const epByProduct = useMemo(() => {
    const m = new Map<number, ExporterProduct[]>()
    eps.forEach(ep => {
      if (!m.has(ep.product_id)) m.set(ep.product_id, [])
      m.get(ep.product_id)!.push(ep)
    })
    return m
  }, [eps])

  const breweryById = useMemo(() => {
    const m = new Map<number, Brewery>()
    breweries.forEach(b => m.set(b.brewery_id, b))
    return m
  }, [breweries])

  const filteredSkus = useMemo(() => {
    const q = skuSearch.toLowerCase()
    return products.filter(p => {
      if (skuTier && p.tier_code !== skuTier) return false
      if (!q) return true
      return (p.product_code ?? '').toLowerCase().includes(q) ||
             (p.name_ja ?? '').toLowerCase().includes(q) ||
             (p.name_ko ?? '').toLowerCase().includes(q)
    })
  }, [products, skuSearch, skuTier])

  // ── 수출자 탭 통계 ───────────────────────────────────────────────────────────
  const exporterStats = useMemo(() => exporters.map(ex => {
    const myEps = eps.filter(e => e.exporter_id === ex.exporter_id)
    const productIds = new Set(myEps.map(e => e.product_id))
    const tierSet = new Set<string>()
    const brewSet = new Set<number>()
    products.forEach(p => {
      if (productIds.has(p.product_id)) {
        if (p.tier_code) tierSet.add(p.tier_code)
        if (p.brewery_id) brewSet.add(p.brewery_id)
      }
    })
    return { ...ex, skuCount: productIds.size, breweryCount: brewSet.size, tiers: [...tierSet] }
  }), [exporters, eps, products])

  const breweryStats = useMemo(() => breweries.map(b => {
    const prods = products.filter(p => p.brewery_id === b.brewery_id)
    const exporterSet = new Set<string>()
    prods.forEach(p => {
      epByProduct.get(p.product_id)?.forEach(ep => {
        const ex = exporters.find(e => e.exporter_id === ep.exporter_id)
        if (ex) exporterSet.add(ex.code)
      })
    })
    return { ...b, skuCount: prods.length, exporterCodes: [...exporterSet] }
  }), [breweries, products, epByProduct, exporters])

  // ── 업로드 핸들러 (기초재고·실적) ────────────────────────────────────────────
  const handleDemandUpload = async (rows: string[][]): Promise<string> => {
    const mapped = rows
      .filter(r => r.length >= 3)
      .map(r => ({ product_code: r[0], ym: r[1], qty_boxes: parseInt(r[2]) }))
      .filter(r => !isNaN(r.qty_boxes))
    const res = await bulkUpsertDemandActual(mapped)
    setDemandCount(prev => (prev ?? 0) + res.data.upserted)
    return `완료 — ${res.data.upserted}건 저장, ${res.data.skipped}건 건너뜀`
  }

  const handleInvUpload = async (rows: string[][]): Promise<string> => {
    const mapped = rows
      .filter(r => r.length >= 4)
      .map(r => ({ product_code: r[0], zone_code: r[1], lot_no: r[2], qty_boxes: parseInt(r[3]), exp_date: r[4] || undefined }))
      .filter(r => !isNaN(r.qty_boxes))
    const res = await registerInitialLots(mapped)
    getInventoryLotsSummary().then(r => setInvSummary(r.data))
    return `완료 — ${res.data.created}건 생성, ${res.data.skipped}건 건너뜀`
  }

  // ── 엑셀 내보내기 ────────────────────────────────────────────────────────────
  const handleExport = () => {
    const rows = filteredSkus.map(p => {
      const myEps = epByProduct.get(p.product_id) ?? []
      const ex = myEps.map(ep => exporters.find(e => e.exporter_id === ep.exporter_id)?.code ?? '').join(',')
      const sp = myEps.map(ep => priceByEp.get(ep.ep_id)?.supply_price ?? '').filter(Boolean)[0] ?? ''
      const br = p.brewery_id ? (breweryById.get(p.brewery_id)?.name ?? '') : ''
      return [p.product_code, p.name_ja ?? '', br, ex, p.tier_code ?? '', p.volume_ml ?? '', p.boxes_per_pallet, sp]
    })
    downloadTemplate('상품마스터_내보내기.xlsx',
      ['SKU', '상품명', '양조장', '수출자', '온도대', '용량(ml)', 'CT/PL', '단가'],
      rows,
    )
  }

  // ── 탭 정의 ──────────────────────────────────────────────────────────────────
  const TABS: { key: TabKey; label: string; sub: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'sku',      label: '상품 마스터',    sub: '수출자별 상품·단가 종합',    icon: <IconTable size={14} stroke={1.8} />,       count: products.length },
    { key: 'exporter', label: '거래처·제조사', sub: '수출자(거래처)와 양조장(제조사) 등록',   icon: <IconBuilding size={14} stroke={1.8} />,    count: exporters.length },
    { key: 'fx',       label: '환율',          sub: '최신 적용 FX (KRW 환산)', icon: <IconCurrencyYen size={14} stroke={1.8} />, count: fxRates.length },
    { key: 'tier',     label: '온도 티어',     sub: 'R·L·보관월 기본값',      icon: <IconThermometer size={14} stroke={1.8} />, count: tiers.length },
    { key: 'pallet',   label: '팔레트·컨테이너', sub: '단수·적재 규칙',       icon: <IconPackage size={14} stroke={1.8} />,     count: specs.length },
    { key: 'calendar', label: '발주 캘린더',   sub: '발주 일정과 기준',        icon: <IconCalendar size={14} stroke={1.8} /> },
  ]

  return (
    <div className="page">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">초기 데이터</h1>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '2px 0 0' }}>
            마스터 데이터 관리 — 모듈 전반에서 참조되는 기준값
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => setModal('demand')}><IconUpload size={13} /> 가져오기</button>
          <button className="btn" onClick={handleExport}><IconDownload size={13} /> 내보내기</button>
          <button className="btn" onClick={load} disabled={loading}><IconRefresh size={13} /></button>
        </div>
      </div>

      {/* ── Stats ───────────────────────────────────────────────────────── */}
      {!loading && (
        <div className="stats-grid" style={{ marginBottom: 16 }}>
          <div className="stat-tile">
            <div className="label">등록 SKU</div>
            <div className="value">{products.length}</div>
            <div className="sub">{breweries.length}개 양조장</div>
          </div>
          <div className="stat-tile">
            <div className="label">수출자</div>
            <div className="value">{exporters.length}</div>
            <div className="sub">거래처</div>
          </div>
          <div className="stat-tile">
            <div className="label">환율 통화</div>
            <div className="value">{fxRates.length}</div>
            <div className="sub">→ KRW</div>
          </div>
          <div className="stat-tile">
            <div className="label">온도 티어</div>
            <div className="value">{tiers.length}</div>
            <div className="sub">생·일반·상온</div>
          </div>
        </div>
      )}

      {/* ── Tab Bar ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 0, background: '#fff',
        border: '0.5px solid var(--border)', borderRadius: 'var(--radius-lg)',
        padding: '0 4px', marginBottom: 16, overflowX: 'auto',
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
              fontFamily: 'var(--font)', whiteSpace: 'nowrap',
              borderBottom: tab === t.key ? '2px solid var(--text-info)' : '2px solid transparent',
              color: tab === t.key ? 'var(--text-primary)' : 'var(--text-tertiary)',
            }}
          >
            <span style={{ color: tab === t.key ? 'var(--text-info)' : 'var(--text-tertiary)' }}>{t.icon}</span>
            <span>
              <span style={{ display: 'block', fontSize: 12, fontWeight: tab === t.key ? 600 : 400 }}>{t.label}</span>
              <span style={{ display: 'block', fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>{t.sub}</span>
            </span>
            {t.count !== undefined && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 10,
                background: tab === t.key ? 'var(--bg-info)' : 'var(--bg-secondary)',
                color: tab === t.key ? 'var(--text-info)' : 'var(--text-tertiary)',
              }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab Content ─────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>로딩 중…</div>
      ) : tab === 'sku' ? (
        /* SKU 마스터 탭 */
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <input
                className="pm-input"
                placeholder="SKU · 상품명 · 양조장"
                value={skuSearch}
                onChange={e => setSkuSearch(e.target.value)}
                style={{ paddingLeft: 10, width: 200 }}
              />
            </div>
            {/* 티어 필터 chips */}
            {(['', 'cold', 'ambient', 'room'] as const).map(t => (
              <button
                key={t}
                onClick={() => setSkuTier(t)}
                style={{
                  padding: '3px 12px', borderRadius: 20,
                  border: '0.5px solid ' + (skuTier === t ? 'var(--text-info)' : 'var(--border)'),
                  background: skuTier === t ? 'var(--bg-info)' : '#fff',
                  color: skuTier === t ? 'var(--text-info)' : 'var(--text-secondary)',
                  fontSize: 11, fontFamily: 'var(--font)', cursor: 'pointer', fontWeight: skuTier === t ? 600 : 400,
                }}
              >
                {t === '' ? '전체' : t === 'cold' ? '생' : t === 'ambient' ? '일반' : '상온'}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => downloadTemplate(
              'SKU마스터_템플릿.xlsx',
              ['SKU코드', '상품명(일본어)', '상품명(한국어)', '온도대(cold/ambient/room)', '양조장명', '팔레트당박스수', '용량(ml)', '도수(%)'],
              [
                ['N0010000', '獺祭 純米大吟醸45', '닷사이 준마이다이긴죠45', 'cold', '旭酒造', 40, 720, 15.5],
                ['N0020000', '獺祭 純米大吟醸23', '닷사이 준마이다이긴죠23', 'cold', '旭酒造', 40, 720, 16],
                ['S0010000', '黒牛 純米吟醸', '쿠로우시 준마이긴죠', 'ambient', '名手酒造店', 30, 1800, 15],
              ],
            )}>
              <IconDownload size={13} /> 템플릿
            </button>
            <button className="btn btn-info" onClick={() => setModal('product')}>
              <IconPlus size={13} /> SKU 추가
            </button>
          </div>
          <div className="table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 12 }}>SKU</th>
                  <th>상품명</th>
                  <th>양조장</th>
                  <th>수출자</th>
                  <th>티어</th>
                  <th className="num">용량</th>
                  <th className="num">CT/PL</th>
                  <th className="num">단가</th>
                </tr>
              </thead>
              <tbody>
                {filteredSkus.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                    {skuSearch || skuTier ? '검색 결과 없음' : 'SKU가 없습니다. "+ SKU 추가"로 등록하세요.'}
                  </td></tr>
                ) : filteredSkus.map(p => {
                  const myEps = epByProduct.get(p.product_id) ?? []
                  const brewery = p.brewery_id ? breweryById.get(p.brewery_id) : null
                  const sp = myEps.map(ep => priceByEp.get(ep.ep_id)).find(Boolean)
                  const exCodes = [...new Set(myEps.map(ep => exporters.find(e => e.exporter_id === ep.exporter_id)?.code).filter(Boolean))]
                  return (
                    <tr key={p.product_id}>
                      <td style={{ paddingLeft: 12, fontFamily: 'monospace', fontSize: 11, fontWeight: 500 }}>{p.product_code}</td>
                      <td>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{p.name_ja}</div>
                        {p.name_ko && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{p.name_ko}</div>}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{brewery?.name ?? '—'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {exCodes.length > 0
                            ? exCodes.map(c => <span key={c} className="chip chip-default" style={{ fontSize: 10 }}>{c}</span>)
                            : <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>—</span>}
                        </div>
                      </td>
                      <td><TierChip code={p.tier_code} /></td>
                      <td className="num" style={{ fontSize: 12 }}>{p.volume_ml ? `${p.volume_ml}ml` : '—'}</td>
                      <td className="num" style={{ fontSize: 12 }}>{p.boxes_per_pallet}</td>
                      <td className="num" style={{ fontSize: 12 }}>
                        {sp ? <><span style={{ fontWeight: 600 }}>{sp.supply_price.toLocaleString()}</span> <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>{sp.currency}</span></> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>

      ) : tab === 'exporter' ? (
        /* 수출자·양조장 탭 */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* 수출자 패널 */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>수출자</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>발주서 헤더에 표시되는 거래처</div>
              </div>
              <button className="btn btn-info" style={{ fontSize: 11 }} onClick={() => setModal('exporter')}>
                <IconPlus size={12} /> 추가
              </button>
            </div>
            <table className="pm-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 12 }}>수출자</th>
                  <th className="num">SKU</th>
                  <th className="num">양조장</th>
                  <th>티어</th>
                </tr>
              </thead>
              <tbody>
                {exporterStats.length === 0
                  ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>없음</td></tr>
                  : exporterStats.map(ex => (
                    <tr key={ex.exporter_id}>
                      <td style={{ paddingLeft: 12, fontWeight: 600, fontSize: 12 }}>{ex.code}
                        <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', fontSize: 10, marginLeft: 6 }}>{ex.name}</span>
                      </td>
                      <td className="num">{ex.skuCount > 0 ? ex.skuCount : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                      <td className="num">{ex.breweryCount > 0 ? ex.breweryCount : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                          {ex.tiers.map(t => <TierChip key={t} code={t} />)}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* 양조장 패널 */}
          <div className="card" style={{ padding: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '0.5px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>양조장</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>브랜드 단위 매핑</div>
              </div>
              <button className="btn btn-info" style={{ fontSize: 11 }} onClick={() => setModal('brewery')}>
                <IconPlus size={12} /> 추가
              </button>
            </div>
            <table className="pm-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 12 }}>양조장</th>
                  <th>수출자</th>
                  <th className="num">SKU</th>
                </tr>
              </thead>
              <tbody>
                {breweryStats.length === 0
                  ? <tr><td colSpan={3} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>없음</td></tr>
                  : breweryStats.map(b => (
                    <tr key={b.brewery_id}>
                      <td style={{ paddingLeft: 12, fontWeight: 500, fontSize: 12 }}>{b.name}
                        {b.name_ja && <span style={{ color: 'var(--text-tertiary)', fontSize: 10, marginLeft: 6 }}>{b.name_ja}</span>}
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {b.exporterCodes.map(c => <span key={c} className="chip chip-default" style={{ marginRight: 3, fontSize: 10 }}>{c}</span>)}
                      </td>
                      <td className="num">{b.skuCount > 0 ? b.skuCount : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

      ) : tab === 'fx' ? (
        /* 환율 탭 */
        <div className="card" style={{ maxWidth: 600 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>환율 이력</div>
            <button className="btn btn-info" onClick={() => setModal('fx')}><IconPlus size={13} /> 환율 추가</button>
          </div>
          <table className="pm-table">
            <thead>
              <tr>
                <th>통화쌍</th>
                <th>기준일</th>
                <th className="num">환율</th>
                <th>출처</th>
              </tr>
            </thead>
            <tbody>
              {fxRates.length === 0
                ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>등록된 환율이 없습니다</td></tr>
                : fxRates.map(r => (
                  <tr key={r.rate_id}>
                    <td style={{ fontWeight: 600 }}>{r.base_currency}/{r.quote_currency}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.rate_date}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{r.rate.toLocaleString()}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{r.source}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

      ) : tab === 'tier' ? (
        /* 온도 티어 탭 */
        <TierTab tiers={tiers} onSaved={load} />

      ) : tab === 'pallet' ? (
        /* 팔레트·컨테이너 탭 */
        <PalletTab specs={specs} tiers={tiers} onSaved={load} />

      ) : (
        /* 발주 캘린더 탭 */
        <div className="card" style={{ maxWidth: 700 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>발주 캘린더</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 }}>
            티어별 검토주기(R) 기준 · 짝수월 발주 원칙 — 검토주기(R)·리드타임(L) 수정은 <strong>온도 티어</strong> 탭에서 변경하세요
          </div>
          <table className="pm-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 12 }}>항목</th>
                <th>값</th>
                <th>설명</th>
              </tr>
            </thead>
            <tbody>
              {[
                { item: '발주 주기', val: '짝수월 (2·4·6·8·10·12)', desc: 'R,S 정책 — 홀수월은 검토하지 않음' },
                { item: '검토 기준일', val: '월말 (말일)', desc: '매월 말일 재고 확인 후 다음달 발주량 결정' },
                { item: '컷오프 시간', val: '15:00 JST', desc: '해당 시간 이후 주문은 다음 발주월로 이월' },
                { item: '최소 리드타임', val: `${tiers.length > 0 ? Math.min(...tiers.map(t => t.lead_time_months)) : 1}개월`, desc: '온도 티어 탭의 L값에서 결정됨' },
                { item: '안전재고 배수', val: '서비스율 Z=2.05', desc: '97.8% 서비스율 기준 — 발주 실행 시 변경 가능' },
              ].map(row => (
                <tr key={row.item}>
                  <td style={{ paddingLeft: 12, fontWeight: 500, fontSize: 12 }}>{row.item}</td>
                  <td><span className="chip chip-info" style={{ fontSize: 11 }}>{row.val}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {modal === 'exporter' && <ExporterModal onClose={() => setModal(null)} onSaved={load} />}
      {modal === 'brewery'  && <BreweryModal  onClose={() => setModal(null)} onSaved={load} />}
      {modal === 'product'  && <ProductModal  breweries={breweries} tiers={tiers} onClose={() => setModal(null)} onSaved={load} />}
      {modal === 'mapping'  && <MappingModal  exporters={exporters} onClose={() => setModal(null)} onSaved={load} />}
      {modal === 'price'    && <SupplyPriceModal exporters={exporters} onClose={() => setModal(null)} onSaved={load} />}
      {modal === 'fx'       && <FxModal rates={fxRates} onClose={() => setModal(null)} onSaved={load} />}
      {modal === 'demand' && (
        <UploadModal
          title="과거 출고 실적 업로드"
          templateHeader="제품코드, YYYY-MM, 박스수"
          templateExample={'SKU0000,2025-01,100\nSKU0000,2025-02,90\nSKU0001,2025-01,50'}
          onClose={() => setModal(null)}
          onSubmit={handleDemandUpload}
        />
      )}
      {modal === 'inv' && (
        <UploadModal
          title="기초 재고 업로드"
          templateHeader="제품코드, 구역코드(COLD/AMBIENT), 로트번호, 박스수, 유통기한(선택)"
          templateExample={'SKU0000,COLD,LOT-001,40,2027-03-31\nSKU0001,AMBIENT,LOT-002,80,'}
          onClose={() => setModal(null)}
          onSubmit={handleInvUpload}
        />
      )}
    </div>
  )
}
