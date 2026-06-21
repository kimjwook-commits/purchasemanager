import { useEffect, useState } from 'react'
import { IconFileText, IconCheck, IconX, IconDownload } from '@tabler/icons-react'
import { getPurchaseOrders, getPoLines, updatePoStatus } from '../api/api'
import type { PurchaseOrder, PoLine } from '../api/types'
import dayjs from 'dayjs'

const STATUS_META: Record<string, { label: string; chipClass: string }> = {
  DRAFT:     { label: '초안',   chipClass: 'chip-default'  },
  SUBMITTED: { label: '제출',   chipClass: 'chip-info'     },
  CONFIRMED: { label: '확정',   chipClass: 'chip-success'  },
  RECEIVED:  { label: '입고',   chipClass: 'chip-default'  },
  CANCELLED: { label: '취소',   chipClass: 'chip-danger'   },
}

function StatusChip({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, chipClass: 'chip-default' }
  return <span className={`chip ${m.chipClass}`}>{m.label}</span>
}

function TierChip({ tier }: { tier: string | null }) {
  if (!tier) return null
  const label = tier === 'cold' ? '냉·냉장' : tier === 'ambient' ? '상온' : '상·냉장'
  return <span className={`chip ${tier === 'cold' ? 'chip-info' : 'chip-default'}`} style={{ fontSize: 10 }}>{label}</span>
}

// ── PDF builders ──────────────────────────────────────────────────────────────

function buildBreweryPOHtml(
  brewery: string,
  breweryLines: PoLine[],
  order: PurchaseOrder,
): string {
  const totalBoxes = breweryLines.reduce((s, l) => s + l.order_boxes, 0)
  const totalJpy   = breweryLines.reduce((s, l) => s + (l.amount_jpy ?? 0), 0)
  const totalPlt   = breweryLines.reduce((s, l) => s + l.order_layers, 0)

  const rows = breweryLines.map(l => `
    <tr>
      <td>${l.name_ja ?? l.product_code ?? '—'}</td>
      <td>${l.product_code ?? '—'}</td>
      <td style="text-align:right">${l.order_boxes.toLocaleString()}</td>
      <td style="text-align:right">${l.unit_price ? `¥${l.unit_price.toLocaleString()}` : '—'}</td>
      <td style="text-align:right">${l.amount_jpy ? `¥${l.amount_jpy.toLocaleString()}` : '—'}</td>
      <td style="text-align:right">${l.order_layers.toFixed(1)}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>발주서 – ${brewery}</title>
<style>
  body { font-family: 'Noto Sans JP', sans-serif; font-size: 11pt; margin: 24mm 20mm; color: #111; }
  h2 { font-size: 16pt; margin: 0 0 4px; }
  .sub { font-size: 10pt; color: #555; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #f0f0f0; border: 1px solid #ccc; padding: 5px 8px; font-size: 10pt; text-align: left; }
  td { border: 1px solid #ddd; padding: 4px 8px; font-size: 10pt; }
  .total td { font-weight: 700; background: #fafafa; }
  .footer { margin-top: 24px; font-size: 9pt; color: #888; }
</style>
</head>
<body>
<h2>発注書 — ${brewery}</h2>
<div class="sub">
  ${order.exporter_name ?? order.exporter_code} &nbsp;|&nbsp;
  PO No. ${order.po_no} &nbsp;|&nbsp;
  発注月: ${order.order_ym} &nbsp;|&nbsp;
  作成日: ${dayjs(order.created_at).format('YYYY-MM-DD')}
</div>
<table>
  <thead>
    <tr>
      <th>商品名</th>
      <th>品番</th>
      <th style="text-align:right">数量(CTN)</th>
      <th style="text-align:right">単価</th>
      <th style="text-align:right">金額(JPY)</th>
      <th style="text-align:right">PLT</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
    <tr class="total">
      <td colspan="2">合計 (${breweryLines.length}品目)</td>
      <td style="text-align:right">${totalBoxes.toLocaleString()}</td>
      <td></td>
      <td style="text-align:right">¥${totalJpy.toLocaleString()}</td>
      <td style="text-align:right">${totalPlt.toFixed(1)}</td>
    </tr>
  </tbody>
</table>
<div class="footer">PurchaseMaster · 印刷: ${dayjs().format('YYYY-MM-DD HH:mm')}</div>
</body>
</html>`
}

function buildFullPOHtml(lines: PoLine[], order: PurchaseOrder): string {
  const byBrewery = groupByBrewery(lines)
  const totalBoxes = lines.reduce((s, l) => s + l.order_boxes, 0)
  const totalJpy   = lines.reduce((s, l) => s + (l.amount_jpy ?? 0), 0)
  const totalPlt   = lines.reduce((s, l) => s + l.order_layers, 0)

  const sections = byBrewery.map(({ brewery, lines: bLines }) => {
    const subBoxes = bLines.reduce((s, l) => s + l.order_boxes, 0)
    const subJpy   = bLines.reduce((s, l) => s + (l.amount_jpy ?? 0), 0)
    const subPlt   = bLines.reduce((s, l) => s + l.order_layers, 0)
    const rows = bLines.map(l => `
      <tr>
        <td>${l.name_ja ?? l.product_code ?? '—'}</td>
        <td>${l.product_code ?? '—'}</td>
        <td style="text-align:right">${l.order_boxes.toLocaleString()}</td>
        <td style="text-align:right">${l.unit_price ? `¥${l.unit_price.toLocaleString()}` : '—'}</td>
        <td style="text-align:right">${l.amount_jpy ? `¥${l.amount_jpy.toLocaleString()}` : '—'}</td>
        <td style="text-align:right">${l.order_layers.toFixed(1)}</td>
      </tr>
    `).join('')
    return `
      <tr><td colspan="6" style="background:#f5f5f5;font-weight:700;padding:6px 8px;border:1px solid #ccc;">
        ${brewery}
      </td></tr>
      ${rows}
      <tr style="background:#fafafa">
        <td colspan="2" style="border:1px solid #ddd;padding:4px 8px;font-style:italic;font-size:9pt;">
          소계 (${bLines.length}품목)
        </td>
        <td style="text-align:right;border:1px solid #ddd;padding:4px 8px">${subBoxes.toLocaleString()}</td>
        <td style="border:1px solid #ddd;padding:4px 8px"></td>
        <td style="text-align:right;border:1px solid #ddd;padding:4px 8px">¥${subJpy.toLocaleString()}</td>
        <td style="text-align:right;border:1px solid #ddd;padding:4px 8px">${subPlt.toFixed(1)}</td>
      </tr>
    `
  }).join('')

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>발주서 — ${order.po_no}</title>
<style>
  body { font-family: 'Noto Sans JP', sans-serif; font-size: 11pt; margin: 24mm 20mm; color: #111; }
  h2 { font-size: 16pt; margin: 0 0 4px; }
  .sub { font-size: 10pt; color: #555; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #f0f0f0; border: 1px solid #ccc; padding: 5px 8px; font-size: 10pt; text-align: left; }
  td { border: 1px solid #ddd; padding: 4px 8px; font-size: 10pt; }
  .grand-total td { font-weight: 700; background: #e8f0fe; border: 1px solid #ccc; }
  .footer { margin-top: 24px; font-size: 9pt; color: #888; }
</style>
</head>
<body>
<h2>発注書</h2>
<div class="sub">
  ${order.exporter_name ?? order.exporter_code} &nbsp;|&nbsp;
  PO No. ${order.po_no} &nbsp;|&nbsp;
  発注月: ${order.order_ym} &nbsp;|&nbsp;
  作成日: ${dayjs(order.created_at).format('YYYY-MM-DD')}
</div>
<table>
  <thead>
    <tr>
      <th>商品名</th>
      <th>品番</th>
      <th style="text-align:right">数量(CTN)</th>
      <th style="text-align:right">単価</th>
      <th style="text-align:right">金額(JPY)</th>
      <th style="text-align:right">PLT</th>
    </tr>
  </thead>
  <tbody>
    ${sections}
    <tr class="grand-total">
      <td colspan="2">総合計 (${lines.length}品目)</td>
      <td style="text-align:right">${totalBoxes.toLocaleString()}</td>
      <td></td>
      <td style="text-align:right">¥${totalJpy.toLocaleString()}</td>
      <td style="text-align:right">${totalPlt.toFixed(1)}</td>
    </tr>
  </tbody>
</table>
<div class="footer">PurchaseMaster · 印刷: ${dayjs().format('YYYY-MM-DD HH:mm')}</div>
</body>
</html>`
}

function openPrintWindow(html: string) {
  const w = window.open('', '_blank', 'width=900,height=700')
  if (!w) return
  w.document.open()
  w.document.write(html)
  w.document.close()
  w.onload = () => w.print()
}

// ── Grouping helper ───────────────────────────────────────────────────────────

interface BreweryGroup {
  brewery: string
  brewery_id: number | null
  lines: PoLine[]
}

function groupByBrewery(lines: PoLine[]): BreweryGroup[] {
  const map = new Map<string, BreweryGroup>()
  for (const l of lines) {
    const key = l.brewery_name ?? '(양조장 미지정)'
    if (!map.has(key)) {
      map.set(key, { brewery: key, brewery_id: l.brewery_id, lines: [] })
    }
    map.get(key)!.lines.push(l)
  }
  return Array.from(map.values())
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [selected, setSelected] = useState<PurchaseOrder | null>(null)
  const [lines, setLines] = useState<PoLine[]>([])
  const [loading, setLoading] = useState(true)
  const [linesLoading, setLinesLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')

  const loadOrders = () => {
    setLoading(true)
    getPurchaseOrders(filterStatus ? { po_status: filterStatus } : undefined)
      .then(r => { setOrders(r.data); if (r.data.length > 0 && !selected) setSelected(r.data[0]) })
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadOrders() }, [filterStatus])

  useEffect(() => {
    if (!selected) return
    setLinesLoading(true)
    getPoLines(selected.po_id)
      .then(r => setLines(r.data))
      .finally(() => setLinesLoading(false))
  }, [selected])

  const handleStatusChange = async (status: string) => {
    if (!selected) return
    await updatePoStatus(selected.po_id, status)
    loadOrders()
  }

  const totalJpy = lines.reduce((s, l) => s + (l.amount_jpy ?? 0), 0)
  const totalPlt = lines.reduce((s, l) => s + l.order_layers, 0)
  const moqWarnings = lines.filter(l => l.order_boxes < 20)

  const byBrewery = groupByBrewery(lines)
  const hasBrewery = lines.some(l => l.brewery_name)

  // Group orders by exporter for left panel tiles
  const byExporter: Record<string, PurchaseOrder[]> = {}
  orders.forEach(o => {
    const k = o.exporter_code ?? 'unknown'
    ;(byExporter[k] = byExporter[k] ?? []).push(o)
  })

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">모듈 3 · PO 작성</h1>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Left: PO list */}
        <div style={{ flex: '0 0 220px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['', 'DRAFT', 'SUBMITTED', 'CONFIRMED'].map(s => (
              <button
                key={s}
                className={`btn ${filterStatus === s ? 'btn-info' : ''}`}
                style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={() => setFilterStatus(s)}
              >
                {s === '' ? '전체' : STATUS_META[s]?.label ?? s}
              </button>
            ))}
          </div>

          {Object.entries(byExporter).map(([code, pos]) => {
            const cur = pos[0]
            const isSel = selected?.po_id === cur.po_id
            return (
              <div
                key={code}
                onClick={() => setSelected(cur)}
                style={{
                  background: 'var(--bg-primary)',
                  border: isSel ? '2px solid var(--border-info)' : '0.5px solid var(--border-tertiary)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500 }}>{code}</span>
                  <StatusChip status={cur.status} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {cur.line_count}항목 · {cur.total_layers.toFixed(1)} PLT
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>
                  ¥{cur.total_boxes.toLocaleString()}
                </div>
                {pos.length > 1 && (
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>외 {pos.length - 1}건</div>
                )}
              </div>
            )
          })}

          {loading && !orders.length && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>로딩 중…</div>
          )}
          {!loading && orders.length === 0 && (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
              발주서가 없습니다. 모듈 2 SKU 보드에서 PO를 생성하세요.
            </div>
          )}
        </div>

        {/* Right: PO detail */}
        {selected ? (
          <div className="card" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <span style={{ fontSize: 15, fontWeight: 600 }}>
                  {selected.exporter_name ?? selected.exporter_code} 발주서
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
                  {selected.po_no} · 결제통화 JPY
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn"
                  onClick={() => selected && openPrintWindow(buildFullPOHtml(lines, selected))}
                  disabled={lines.length === 0}
                >
                  <IconFileText size={13} /> 발주서 PDF
                </button>
                {selected.status === 'DRAFT' && (
                  <button className="btn btn-info" onClick={() => handleStatusChange('SUBMITTED')}>
                    <IconCheck size={13} /> 승인 요청
                  </button>
                )}
                {selected.status === 'SUBMITTED' && (
                  <button className="btn btn-success" onClick={() => handleStatusChange('CONFIRMED')}>
                    <IconCheck size={13} /> 확정
                  </button>
                )}
                {(selected.status === 'DRAFT' || selected.status === 'SUBMITTED') && (
                  <button className="btn btn-danger" onClick={() => handleStatusChange('CANCELLED')}>
                    <IconX size={13} /> 취소
                  </button>
                )}
              </div>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <StatusChip status={selected.status} />
              <span>생성: {dayjs(selected.created_at).format('YYYY-MM-DD HH:mm')}</span>
            </div>

            <div className="stats-grid" style={{ marginBottom: 14 }}>
              <div className="stat-tile">
                <div className="label">PO 총액</div>
                <div className="value">¥{totalJpy.toLocaleString()}</div>
              </div>
              <div className="stat-tile">
                <div className="label">예상 팔레트</div>
                <div className="value">{totalPlt.toFixed(1)} PLT</div>
              </div>
              <div className="stat-tile">
                <div className="label">항목 수</div>
                <div className="value">{lines.length}</div>
              </div>
              {moqWarnings.length > 0 && (
                <div className="stat-tile" style={{ background: 'var(--bg-warning)' }}>
                  <div className="label" style={{ color: 'var(--text-warning)' }}>MOQ 미달</div>
                  <div className="value" style={{ color: 'var(--text-warning)' }}>{moqWarnings.length}건</div>
                </div>
              )}
            </div>

            {linesLoading ? (
              <div style={{ color: 'var(--text-tertiary)', fontSize: 12, padding: 16 }}>로딩 중…</div>
            ) : hasBrewery ? (
              /* ── Brewery-grouped view ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {byBrewery.map(({ brewery, lines: bLines }) => {
                  const subBoxes = bLines.reduce((s, l) => s + l.order_boxes, 0)
                  const subJpy   = bLines.reduce((s, l) => s + (l.amount_jpy ?? 0), 0)
                  const subPlt   = bLines.reduce((s, l) => s + l.order_layers, 0)
                  return (
                    <div key={brewery}>
                      {/* Brewery header row */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'var(--bg-secondary)',
                        borderRadius: 'var(--radius-md)',
                        padding: '6px 12px',
                        marginBottom: 6,
                      }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{brewery}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            {bLines.length}품목 · {subBoxes.toLocaleString()} CTN · ¥{subJpy.toLocaleString()} · {subPlt.toFixed(1)} PLT
                          </span>
                          <button
                            className="btn"
                            style={{ fontSize: 11, padding: '2px 8px' }}
                            onClick={() => openPrintWindow(buildBreweryPOHtml(brewery, bLines, selected))}
                          >
                            <IconDownload size={12} /> PDF
                          </button>
                        </div>
                      </div>

                      {/* Lines table for this brewery */}
                      <div className="table-wrap">
                        <table className="pm-table">
                          <thead>
                            <tr>
                              <th style={{ paddingLeft: 12 }}>상품</th>
                              <th className="num">발주(CTN)</th>
                              <th className="num">단가</th>
                              <th className="num">금액(¥)</th>
                              <th className="num">PLT</th>
                              <th style={{ textAlign: 'center' }}>온도</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bLines.map(line => {
                              const isMoq = line.order_boxes < 20
                              return (
                                <tr key={line.po_line_id} style={{ background: isMoq ? 'var(--bg-warning)' : undefined }}>
                                  <td style={{ paddingLeft: 12 }}>
                                    <span style={{ fontWeight: 500 }}>{line.name_ja ?? line.product_code}</span>
                                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                      {line.product_code}
                                      {isMoq && (
                                        <span style={{ marginLeft: 6, color: 'var(--text-warning)' }}>
                                          MOQ 20 미달 · +{20 - line.order_boxes} CTN 권장
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="num">{line.order_boxes.toLocaleString()}</td>
                                  <td className="num">{line.unit_price ? `¥${line.unit_price.toLocaleString()}` : '—'}</td>
                                  <td className="num">{line.amount_jpy ? `¥${line.amount_jpy.toLocaleString()}` : '—'}</td>
                                  <td className="num">{line.order_layers.toFixed(1)}</td>
                                  <td style={{ textAlign: 'center' }}><TierChip tier={line.tier_code} /></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}

                {/* Grand total */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 24,
                  padding: '8px 12px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 12,
                  fontWeight: 600,
                }}>
                  <span>{lines.length}품목 합계</span>
                  <span>{lines.reduce((s, l) => s + l.order_boxes, 0).toLocaleString()} CTN</span>
                  <span>¥{totalJpy.toLocaleString()}</span>
                  <span>{totalPlt.toFixed(1)} PLT</span>
                </div>
              </div>
            ) : (
              /* ── Flat view (no brewery data) ── */
              <div className="table-wrap">
                <table className="pm-table">
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 12 }}>상품</th>
                      <th className="num">발주(CTN)</th>
                      <th className="num">단가</th>
                      <th className="num">금액(¥)</th>
                      <th className="num">PLT</th>
                      <th style={{ textAlign: 'center' }}>온도</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map(line => {
                      const isMoq = line.order_boxes < 20
                      return (
                        <tr key={line.po_line_id} style={{ background: isMoq ? 'var(--bg-warning)' : undefined }}>
                          <td style={{ paddingLeft: 12 }}>
                            <span style={{ fontWeight: 500 }}>{line.name_ja ?? line.product_code}</span>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                              {line.product_code}
                              {isMoq && (
                                <span style={{ marginLeft: 6, color: 'var(--text-warning)' }}>
                                  MOQ 20 미달 · +{20 - line.order_boxes} CTN 권장
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="num">{line.order_boxes.toLocaleString()}</td>
                          <td className="num">{line.unit_price ? `¥${line.unit_price.toLocaleString()}` : '—'}</td>
                          <td className="num">{line.amount_jpy ? `¥${line.amount_jpy.toLocaleString()}` : '—'}</td>
                          <td className="num">{line.order_layers.toFixed(1)}</td>
                          <td style={{ textAlign: 'center' }}><TierChip tier={line.tier_code} /></td>
                        </tr>
                      )
                    })}
                    {lines.length > 0 && (
                      <tr style={{ fontWeight: 500 }}>
                        <td style={{ paddingLeft: 12 }}>합계 ({lines.length}항목)</td>
                        <td className="num">{lines.reduce((s, l) => s + l.order_boxes, 0).toLocaleString()}</td>
                        <td />
                        <td className="num">¥{totalJpy.toLocaleString()}</td>
                        <td className="num">{totalPlt.toFixed(1)}</td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="card" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 13, minHeight: 200 }}>
            {loading ? '로딩 중…' : '발주서를 선택하세요.'}
          </div>
        )}
      </div>
    </div>
  )
}
