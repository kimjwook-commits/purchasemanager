import { useEffect, useState, useCallback } from 'react'
import {
  Select, Table, Tag, Space, Typography, Spin, Alert, Badge, Card,
  Row, Col, Statistic, Switch, Tooltip, message,
} from 'antd'
import { WarningOutlined, CheckSquareOutlined, BorderOutlined } from '@ant-design/icons'
import { getPlanRuns, getPlanLines, getPlanSummary, getPlanAlerts } from '../api/api'
import type { PlanRun, PlanLine, MonthSummary, PlanAlert } from '../api/types'

const { Title, Text } = Typography

const TIER_COLORS: Record<string, string> = { cold: 'blue', ambient: 'cyan', room: 'green' }
const TIER_LABELS: Record<string, string> = { cold: '냉장', ambient: '일반', room: '상온' }

// ── 월별 롤링 요약 카드 ────────────────────────────────────────────────────────
function MonthlySummary({ months, onSelectMonth, selectedMonth }: {
  months: MonthSummary[]
  onSelectMonth: (ym: string | undefined) => void
  selectedMonth: string | undefined
}) {
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
      <div style={{ display: 'flex', gap: 8, minWidth: 600 }}>
        {months.map(m => {
          const isSelected = m.order_ym === selectedMonth
          return (
            <div
              key={m.order_ym}
              onClick={() => onSelectMonth(isSelected ? undefined : m.order_ym)}
              style={{
                flex: 1,
                minWidth: 110,
                background: isSelected ? '#e6f4ff' : '#fafafa',
                border: `2px solid ${isSelected ? '#1677ff' : '#f0f0f0'}`,
                borderRadius: 8,
                padding: '10px 12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: isSelected ? '#1677ff' : '#262626' }}>
                {m.order_ym}
              </div>

              {/* 팔레트 바 */}
              <div style={{ marginBottom: 6 }}>
                {m.cold_pallets > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#1677ff' }} />
                    <Text style={{ fontSize: 11 }}>냉장 {m.cold_pallets}팔레트</Text>
                  </div>
                )}
                {m.ambient_pallets > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#13c2c2' }} />
                    <Text style={{ fontSize: 11 }}>일반 {m.ambient_pallets}팔레트</Text>
                  </div>
                )}
                {m.room_pallets > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#52c41a' }} />
                    <Text style={{ fontSize: 11 }}>상온 {m.room_pallets}팔레트</Text>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 12, fontWeight: 600 }}>총 {m.total_pallets}팔레트</Text>
                {m.alert_count > 0 && (
                  <Badge count={m.alert_count} size="small" style={{ backgroundColor: '#faad14' }}>
                    <WarningOutlined style={{ color: '#faad14' }} />
                  </Badge>
                )}
              </div>
              <Text type="secondary" style={{ fontSize: 11 }}>{m.line_count}개 SKU</Text>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 경고 목록 ──────────────────────────────────────────────────────────────────
function AlertList({ alerts }: { alerts: PlanAlert[] }) {
  if (alerts.length === 0) return null
  return (
    <Alert
      type="warning"
      message={`타당성 경고 ${alerts.length}건`}
      description={
        <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
          {alerts.map(a => (
            <li key={a.plan_line_id} style={{ fontSize: 12 }}>
              <Text strong>{a.product_code}</Text>　{a.order_ym}　{a.alert}
            </li>
          ))}
        </ul>
      }
      showIcon
    />
  )
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function ForecastPage() {
  const [plans, setPlans] = useState<PlanRun[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<number | undefined>()
  const [months, setMonths] = useState<MonthSummary[]>([])
  const [lines, setLines] = useState<PlanLine[]>([])
  const [alerts, setAlerts] = useState<PlanAlert[]>([])
  const [selectedMonth, setSelectedMonth] = useState<string | undefined>()
  const [tierFilter, setTierFilter] = useState<string | undefined>()
  const [committedOnly, setCommittedOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [linesLoading, setLinesLoading] = useState(false)

  // 계획 목록 로드
  useEffect(() => {
    getPlanRuns().then(r => {
      setPlans(r.data)
      if (r.data.length > 0) setSelectedPlanId(r.data[0].plan_run_id)
    })
  }, [])

  // 계획 선택 시 요약+경고 로드
  useEffect(() => {
    if (!selectedPlanId) return
    setLoading(true)
    setSelectedMonth(undefined)
    Promise.all([
      getPlanSummary(selectedPlanId),
      getPlanAlerts(selectedPlanId),
    ])
      .then(([summaryRes, alertRes]) => {
        setMonths(summaryRes.data.months)
        setAlerts(alertRes.data)
      })
      .finally(() => setLoading(false))
  }, [selectedPlanId])

  // 라인 로드 (월/티어/committed 필터 반영)
  const loadLines = useCallback(() => {
    if (!selectedPlanId) return
    setLinesLoading(true)
    getPlanLines(selectedPlanId, {
      order_ym: selectedMonth,
      tier: tierFilter,
      committed_only: committedOnly || undefined,
    })
      .then(r => setLines(r.data))
      .finally(() => setLinesLoading(false))
  }, [selectedPlanId, selectedMonth, tierFilter, committedOnly])

  useEffect(() => { loadLines() }, [loadLines])

  const currentPlan = plans.find(p => p.plan_run_id === selectedPlanId)
  const totalBoxes = lines.reduce((s, l) => s + l.order_boxes, 0)
  const totalPallets = lines.reduce((s, l) => s + Math.ceil(l.order_boxes / 40), 0)

  const columns = [
    {
      title: '발주월', dataIndex: 'order_ym', key: 'order_ym', width: 90,
      render: (v: string) => <Tag color="geekblue">{v}</Tag>,
    },
    {
      title: '상품 코드', dataIndex: 'product_code', key: 'product_code', width: 100,
      render: (v: string | null) => <Text strong>{v || '-'}</Text>,
    },
    {
      title: '일본어명', dataIndex: 'name_ja', key: 'name_ja',
      render: (v: string | null) => v || '-',
    },
    {
      title: '티어', dataIndex: 'tier_code', key: 'tier_code', width: 80,
      render: (v: string | null) => v
        ? <Tag color={TIER_COLORS[v] || 'default'}>{TIER_LABELS[v] || v}</Tag>
        : '-',
    },
    {
      title: '발주 박스', dataIndex: 'order_boxes', key: 'order_boxes', width: 90,
      align: 'right' as const,
      render: (v: number) => <Text strong>{v.toLocaleString()}</Text>,
    },
    {
      title: '팔레트', key: 'pallets', width: 80, align: 'right' as const,
      render: (_: unknown, r: PlanLine) => Math.ceil(r.order_boxes / 40),
    },
    {
      title: '도착 예정', dataIndex: 'expected_arrival_ym', key: 'expected_arrival_ym', width: 90,
      render: (v: string) => <Text type="secondary">{v}</Text>,
    },
    {
      title: '확정', dataIndex: 'is_committed', key: 'is_committed', width: 60, align: 'center' as const,
      render: (v: boolean) => v
        ? <CheckSquareOutlined style={{ color: '#52c41a', fontSize: 16 }} />
        : <BorderOutlined style={{ color: '#d9d9d9', fontSize: 16 }} />,
    },
    {
      title: '경고', dataIndex: 'alert', key: 'alert',
      render: (v: string | null) => v
        ? <Tooltip title={v}><WarningOutlined style={{ color: '#faad14' }} /></Tooltip>
        : null,
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>발주 예측 (Order Forecast)</Title>
        <Select
          style={{ width: 260 }}
          value={selectedPlanId}
          onChange={v => { setSelectedPlanId(v) }}
          options={plans.map(p => ({
            value: p.plan_run_id,
            label: `${p.run_ym} v${p.version} — ${p.status === 'APPROVED' ? '✅ 승인' : p.status === 'ARCHIVED' ? '📦 보관' : '📝 초안'}`,
          }))}
          placeholder="계획 실행을 선택하세요"
        />
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
          <Spin size="large" />
        </div>
      ) : selectedPlanId && months.length > 0 ? (
        <>
          {/* 경고 배너 */}
          <AlertList alerts={alerts} />

          {/* 요약 카드 (클릭으로 월 필터) */}
          <Card size="small" title="발주월별 롤링 요약 — 카드 클릭으로 월 필터">
            <MonthlySummary months={months} onSelectMonth={setSelectedMonth} selectedMonth={selectedMonth} />
          </Card>

          {/* 집계 통계 (현재 필터 기준) */}
          <Row gutter={12}>
            <Col span={6}>
              <Card size="small">
                <Statistic title="필터된 SKU 라인" value={lines.length} suffix="건" />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="총 발주 박스" value={totalBoxes} suffix="박스" />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="총 팔레트" value={totalPallets} suffix="팔레트" />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="경고" value={alerts.length} valueStyle={{ color: alerts.length > 0 ? '#faad14' : '#52c41a' }} suffix="건" />
              </Card>
            </Col>
          </Row>

          {/* 필터 바 */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Space>
              <Text type="secondary">온도 티어:</Text>
              <Select
                allowClear
                placeholder="전체"
                style={{ width: 110 }}
                value={tierFilter}
                onChange={setTierFilter}
                options={[
                  { value: 'cold', label: '냉장' },
                  { value: 'ambient', label: '일반' },
                  { value: 'room', label: '상온' },
                ]}
              />
            </Space>
            <Space>
              <Text type="secondary">확정 라인만:</Text>
              <Switch size="small" checked={committedOnly} onChange={setCommittedOnly} />
            </Space>
            {selectedMonth && (
              <Tag closable onClose={() => setSelectedMonth(undefined)} color="blue">
                {selectedMonth}
              </Tag>
            )}
          </div>

          {/* 라인 테이블 */}
          <Table
            dataSource={lines}
            columns={columns}
            rowKey="plan_line_id"
            loading={linesLoading}
            size="small"
            pagination={{ pageSize: 20, showTotal: t => `총 ${t}개 라인`, showSizeChanger: false }}
            rowClassName={(r) => r.alert ? 'ant-table-row-warning' : ''}
            summary={rows => {
              const sumBoxes = rows.reduce((s, r) => s + r.order_boxes, 0)
              const sumPallets = rows.reduce((s, r) => s + Math.ceil(r.order_boxes / 40), 0)
              return (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4}>
                    <Text strong>합계</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right">
                    <Text strong>{sumBoxes.toLocaleString()}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right">
                    <Text strong>{sumPallets}</Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6} colSpan={3} />
                </Table.Summary.Row>
              )
            }}
          />
        </>
      ) : (
        <Alert message="계획 실행을 선택하면 발주 예측 결과를 확인할 수 있습니다." type="info" showIcon />
      )}
    </Space>
  )
}
