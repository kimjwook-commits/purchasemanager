import { useEffect, useState } from 'react'
import {
  IconRefresh, IconPlus, IconX, IconBuilding, IconBottle,
  IconSnowflake, IconAlertTriangle, IconPencil,
} from '@tabler/icons-react'
import {
  getBreweries, createBrewery, updateBrewery,
  getProducts, createProduct,
  getTiers, getExporters,
} from '../api/api'
import type { Brewery, Product, TemperatureTier, Exporter } from '../api/types'

const TIER_LABEL: Record<string, string> = { cold: '냉장', ambient: '상온', room: '상온(실온)' }
const TIER_COLOR: Record<string, string> = { cold: 'chip-info', ambient: 'chip-default', room: 'chip-default' }

// ── 양조장 추가 모달 ──────────────────────────────────────────────────────────
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
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '저장 실패')
    } finally { setLoading(false) }
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
            <label className="form-label">양조장명 (한국어) *</label>
            <input className="pm-input" placeholder="e.g. 獺祭" value={form.name} onChange={set('name')} />
          </div>
          <div className="form-field">
            <label className="form-label">양조장명 (일본어)</label>
            <input className="pm-input" placeholder="e.g. 旭酒造" value={form.name_ja} onChange={set('name_ja')} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div className="form-field">
              <label className="form-label">국가코드</label>
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

// ── 양조장 편집 모달 ──────────────────────────────────────────────────────────
function BreweryEditModal({ brewery, onClose, onSaved }: { brewery: Brewery; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: brewery.name, name_ja: brewery.name_ja ?? '', region: brewery.region ?? '' })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSave = async () => {
    if (!form.name.trim()) { setErr('양조장명을 입력하세요'); return }
    setLoading(true); setErr('')
    try {
      await updateBrewery(brewery.brewery_id, {
        name:    form.name.trim(),
        name_ja: form.name_ja.trim() || undefined,
        region:  form.region.trim() || undefined,
      })
      onSaved(); onClose()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '저장 실패')
    } finally { setLoading(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">양조장 수정</span>
          <button className="btn" style={{ padding: '2px 8px' }} onClick={onClose}><IconX size={13} /></button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="form-field">
            <label className="form-label">양조장명 *</label>
            <input className="pm-input" value={form.name} onChange={set('name')} />
          </div>
          <div className="form-field">
            <label className="form-label">양조장명 (일본어)</label>
            <input className="pm-input" placeholder="일본어 정식 명칭" value={form.name_ja} onChange={set('name_ja')} />
          </div>
          <div className="form-field">
            <label className="form-label">지역</label>
            <input className="pm-input" placeholder="e.g. 山口県" value={form.region} onChange={set('region')} />
          </div>
        </div>
        {err && <div className="alert alert-warning" style={{ marginTop: 8 }}>{err}</div>}
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? '저장 중…' : <><IconPencil size={13} /> 저장</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 상품 추가 모달 ────────────────────────────────────────────────────────────
function ProductModal({
  breweries, tiers, defaultBreweryId,
  onClose, onSaved,
}: {
  breweries: Brewery[]; tiers: TemperatureTier[]
  defaultBreweryId?: number
  onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    product_code: '', name_ja: '', name_ko: '',
    brewery_id: defaultBreweryId ?? '',
    tier_id: tiers[0]?.tier_id ?? '',
    boxes_per_pallet: 40,
    volume_ml: '', alcohol_pct: '',
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
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '저장 실패')
    } finally { setLoading(false) }
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
                {tiers.map(t => <option key={t.tier_id} value={t.tier_id}>{t.name_ko}</option>)}
              </select>
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">상품명 (일본어) *</label>
            <input className="pm-input" placeholder="e.g. 獺祭 純米大吟醸45" value={form.name_ja} onChange={set('name_ja')} />
          </div>
          <div className="form-field">
            <label className="form-label">상품명 (한국어)</label>
            <input className="pm-input" placeholder="e.g. 닷사이 준마이다이긴죠45" value={form.name_ko} onChange={set('name_ko')} />
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

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function CompliancePage() {
  const [tab, setTab]             = useState<'brewery' | 'product'>('brewery')
  const [breweries, setBreweries] = useState<Brewery[]>([])
  const [products, setProducts]   = useState<Product[]>([])
  const [tiers, setTiers]         = useState<TemperatureTier[]>([])
  const [exporters, setExporters] = useState<Exporter[]>([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [modal, setModal]         = useState<null | 'brewery' | 'product'>(null)
  const [editingBrewery, setEditingBrewery] = useState<Brewery | null>(null)
  const [filterTier, setFilterTier] = useState('')
  const [filterBrewery, setFilterBrewery] = useState<number | ''>('')

  const load = () => {
    setLoading(true)
    Promise.all([
      getBreweries(),
      getProducts({ size: 500 }),
      getTiers(),
      getExporters(),
    ]).then(([br, pr, ti, ex]) => {
      setBreweries(br.data)
      setProducts(pr.data.items ?? [])
      setTiers(ti.data)
      setExporters(ex.data)
    }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // ── derived ────────────────────────────────────────────────────────────────
  const skuByBrewery = breweries.map(b => ({
    ...b,
    sku_count: products.filter(p => p.brewery_id === b.brewery_id).length,
  }))

  const filteredProducts = products.filter(p => {
    const q = search.toLowerCase()
    const matchSearch = !q ||
      (p.product_code?.toLowerCase().includes(q)) ||
      (p.name_ja?.toLowerCase().includes(q)) ||
      (p.name_ko?.toLowerCase().includes(q))
    const matchTier = !filterTier || p.tier_code === filterTier
    const matchBrewery = filterBrewery === '' || p.brewery_id === filterBrewery
    return matchSearch && matchTier && matchBrewery
  })

  const TAB = [
    { key: 'brewery', label: '양조장', icon: <IconBuilding size={13} />, count: breweries.length },
    { key: 'product', label: '상품', icon: <IconBottle size={13} />, count: products.length },
  ] as const

  return (
    <div className="page">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">브랜드·품목 등록</h1>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '2px 0 0' }}>
            양조장(브랜드)과 수입 품목 등록 — 등록된 상품만 발주·계획에 사용됩니다
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={load} disabled={loading}><IconRefresh size={13} /> 새로고침</button>
          <button className="btn btn-info" onClick={() => setModal(tab === 'brewery' ? 'brewery' : 'product')}>
            <IconPlus size={13} /> {tab === 'brewery' ? '양조장 추가' : '상품 추가'}
          </button>
        </div>
      </div>

      {/* ── Stats ───────────────────────────────────────────────────────── */}
      <div className="stats-grid" style={{ marginBottom: 12 }}>
        <div className="stat-tile">
          <div className="label">등록 양조장</div>
          <div className="value">{breweries.length}</div>
        </div>
        <div className="stat-tile">
          <div className="label">등록 상품(SKU)</div>
          <div className="value" style={{ color: 'var(--text-success)' }}>{products.length}</div>
        </div>
        <div className="stat-tile">
          <div className="label">수출자</div>
          <div className="value">{exporters.length}</div>
        </div>
        <div className="stat-tile">
          <div className="label">상품 미등록 양조장</div>
          <div className="value" style={{ color: skuByBrewery.filter(b => b.sku_count === 0).length > 0 ? 'var(--text-warning)' : undefined }}>
            {skuByBrewery.filter(b => b.sku_count === 0).length}
          </div>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
        {TAB.map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearch(''); setFilterTier(''); setFilterBrewery('') }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontFamily: 'var(--font)', fontSize: 12,
              borderBottom: tab === t.key ? '2px solid var(--text-info)' : '2px solid transparent',
              color: tab === t.key ? 'var(--text-primary)' : 'var(--text-tertiary)',
              fontWeight: tab === t.key ? 600 : 400,
              marginBottom: -1,
            }}
          >
            {t.icon} {t.label}
            <span style={{
              fontSize: 10, background: tab === t.key ? 'var(--bg-info)' : 'var(--bg-secondary)',
              color: tab === t.key ? 'var(--text-info)' : 'var(--text-tertiary)',
              borderRadius: 10, padding: '1px 6px',
            }}>{t.count}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>로딩 중…</div>
      ) : tab === 'brewery' ? (
        /* ── 양조장 탭 ──────────────────────────────────────────────────── */
        <div className="table-wrap">
          <table className="pm-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 12 }}>양조장</th>
                <th>일본어명</th>
                <th>국가·지역</th>
                <th className="num">SKU 수</th>
                <th>상태</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {skuByBrewery.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                  등록된 양조장이 없습니다. "양조장 추가" 버튼으로 등록하세요.
                </td></tr>
              ) : skuByBrewery.map(b => (
                <tr key={b.brewery_id}>
                  <td style={{ paddingLeft: 12, fontWeight: 500 }}>{b.name}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{b.name_ja ?? '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {b.country}{b.region ? ` · ${b.region}` : ''}
                  </td>
                  <td className="num">
                    {b.sku_count > 0
                      ? <span style={{ color: 'var(--text-success)', fontWeight: 600 }}>{b.sku_count}</span>
                      : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                  </td>
                  <td>
                    {b.sku_count > 0
                      ? <span className="chip chip-success">등록 완료</span>
                      : <span className="chip chip-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <IconAlertTriangle size={10} /> 상품 없음
                        </span>}
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: 8 }}>
                    <button className="btn" style={{ padding: '2px 6px', fontSize: 10 }}
                      onClick={() => setEditingBrewery(b)}>
                      <IconPencil size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── 상품 탭 ────────────────────────────────────────────────────── */
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <input
              className="pm-input"
              placeholder="코드·상품명 검색"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: 200 }}
            />
            <select className="pm-select" value={filterTier} onChange={e => setFilterTier(e.target.value)}>
              <option value="">온도대 전체</option>
              {tiers.map(t => <option key={t.tier_id} value={t.code}>{t.name_ko}</option>)}
            </select>
            <select className="pm-select" value={filterBrewery} onChange={e => setFilterBrewery(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">양조장 전체</option>
              {breweries.map(b => <option key={b.brewery_id} value={b.brewery_id}>{b.name}</option>)}
            </select>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', alignSelf: 'center' }}>
              {filteredProducts.length}건
            </span>
          </div>

          <div className="table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 12 }}>상품코드</th>
                  <th>상품명</th>
                  <th>온도대</th>
                  <th>양조장</th>
                  <th className="num">용량</th>
                  <th className="num">팔레트</th>
                  <th className="num">도수</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                    {search || filterTier || filterBrewery ? '검색 결과 없음' : '등록된 상품이 없습니다. "상품 추가" 버튼으로 등록하세요.'}
                  </td></tr>
                ) : filteredProducts.map(p => {
                  const brewery = breweries.find(b => b.brewery_id === p.brewery_id)
                  return (
                    <tr key={p.product_id}>
                      <td style={{ paddingLeft: 12, fontFamily: 'monospace', fontSize: 11 }}>{p.product_code}</td>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 12 }}>{p.name_ja}</div>
                        {p.name_ko && <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{p.name_ko}</div>}
                      </td>
                      <td>
                        <span className={`chip ${TIER_COLOR[p.tier_code ?? ''] ?? 'chip-default'}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          {p.tier_code === 'cold' && <IconSnowflake size={9} />}
                          {TIER_LABEL[p.tier_code ?? ''] ?? p.tier_code}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{brewery?.name ?? '—'}</td>
                      <td className="num" style={{ fontSize: 12 }}>{p.volume_ml ? `${p.volume_ml}ml` : '—'}</td>
                      <td className="num" style={{ fontSize: 12 }}>{p.boxes_per_pallet}박스</td>
                      <td className="num" style={{ fontSize: 12 }}>{p.alcohol_pct ? `${p.alcohol_pct}%` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {modal === 'brewery' && (
        <BreweryModal onClose={() => setModal(null)} onSaved={load} />
      )}
      {modal === 'product' && (
        <ProductModal
          breweries={breweries}
          tiers={tiers}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
      {editingBrewery && (
        <BreweryEditModal
          brewery={editingBrewery}
          onClose={() => setEditingBrewery(null)}
          onSaved={() => { load(); setEditingBrewery(null) }}
        />
      )}
    </div>
  )
}
