import { useEffect, useState } from 'react'
import { Row, Col, Card, Statistic, Table, Tag, Typography, Space, Spin } from 'antd'
import {
  ShoppingCartOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ContainerOutlined, FileTextOutlined,
} from '@ant-design/icons'
import { getPurchaseOrders, getPlanRuns } from '../api/api'
import type { PurchaseOrder, PlanRun } from '../api/types'
import dayjs from 'dayjs'

const { Title, Text } = Typography

const PO_STATUS_TAG: Record<string, { color: string; label: string }> = {
  DRAFT:     { color: 'default',  label: '초안' },
  SUBMITTED: { color: 'blue',     label: '제출' },
  CONFIRMED: { color: 'green',    label: '확정' },
  RECEIVED:  { color: 'purple',   label: '입고' },
  CANCELLED: { color: 'red',      label: '취소' },
}

const PLAN_STATUS_TAG: Record<string, { color: string; label: string }> = {
  DRAFT:    { color: 'default', label: '초안' },
  APPROVED: { color: 'green',  label: '승인' },
  ARCHIVED: { color: 'gray',   label: '보관' },
}

export default function DashboardPage() {
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [plans, setPlans] = useState<PlanRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([getPurchaseOrders(), getPlanRuns()])
      .then(([posRes, plansRes]) => {
        setPos(posRes.data)
        setPlans(plansRes.data)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spin size="large" /></div>

  // 통계
  const totalBoxes = pos.reduce((s, p) => s + p.total_boxes, 0)
  const byStatus = pos.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1
    return acc
  }, {})
  const latestPlan = plans[0]

  const poColumns = [
    { title: 'PO 번호', dataIndex: 'po_no', key: 'po_no', render: (v: string) => <Text strong>{v}</Text> },
    { title: '수출자', dataIndex: 'exporter_code', key: 'exporter_code' },
    { title: '발주월', dataIndex: 'order_ym', key: 'order_ym' },
    {
      title: '상태', dataIndex: 'status', key: 'status',
      render: (v: string) => {
        const s = PO_STATUS_TAG[v] || { color: 'default', label: v }
        return <Tag color={s.color}>{s.label}</Tag>
      },
    },
    {
      title: '박스 수', dataIndex: 'total_boxes', key: 'total_boxes',
      render: (v: number) => v.toLocaleString(),
      align: 'right' as const,
    },
    {
      title: '생성일', dataIndex: 'created_at', key: 'created_at',
      render: (v: string) => dayjs(v).format('MM/DD HH:mm'),
    },
  ]

  const planColumns = [
    { title: '계획 연월', dataIndex: 'run_ym', key: 'run_ym' },
    { title: '버전', dataIndex: 'version', key: 'version', render: (v: number) => `v${v}` },
    {
      title: '상태', dataIndex: 'status', key: 'status',
      render: (v: string) => {
        const s = PLAN_STATUS_TAG[v] || { color: 'default', label: v }
        return <Tag color={s.color}>{s.label}</Tag>
      },
    },
    {
      title: '생성일', dataIndex: 'created_at', key: 'created_at',
      render: (v: string) => dayjs(v).format('MM/DD HH:mm'),
    },
  ]

  return (
    <Space direction="vertical" size={24} style={{ width: '100%' }}>
      <Title level={4} style={{ margin: 0 }}>대시보드</Title>

      {/* 요약 카드 */}
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic
              title="전체 발주서"
              value={pos.length}
              prefix={<FileTextOutlined />}
              suffix="건"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="확정된 PO"
              value={byStatus.CONFIRMED || 0}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#3f8600' }}
              suffix="건"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="처리 중 PO"
              value={(byStatus.DRAFT || 0) + (byStatus.SUBMITTED || 0)}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#cf8c00' }}
              suffix="건"
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="총 발주 박스"
              value={totalBoxes}
              prefix={<ContainerOutlined />}
              suffix="박스"
            />
          </Card>
        </Col>
      </Row>

      {/* 최신 계획 상태 */}
      {latestPlan && (
        <Card
          title={<Space><BarChartIcon /> 최신 발주 계획</Space>}
          size="small"
          extra={
            <Space>
              <Text type="secondary">{latestPlan.run_ym}</Text>
              <Tag color={PLAN_STATUS_TAG[latestPlan.status]?.color}>
                {PLAN_STATUS_TAG[latestPlan.status]?.label}
              </Tag>
            </Space>
          }
        >
          <Table
            dataSource={plans.slice(0, 5)}
            columns={planColumns}
            rowKey="plan_run_id"
            size="small"
            pagination={false}
          />
        </Card>
      )}

      {/* 발주서 목록 */}
      <Card title={<Space><ShoppingCartOutlined /> 발주서 현황</Space>} size="small">
        <Table
          dataSource={pos}
          columns={poColumns}
          rowKey="po_id"
          size="small"
          pagination={{ pageSize: 8, showSizeChanger: false }}
        />
      </Card>
    </Space>
  )
}

function BarChartIcon() {
  return <span style={{ fontSize: 16 }}>📊</span>
}
