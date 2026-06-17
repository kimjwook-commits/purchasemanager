import { useEffect, useState } from 'react'
import { Card, Tag, Typography, Space, Select, Spin, Alert, Row, Col, Badge, Tooltip, Button, message } from 'antd'
import { WarningOutlined, ShoppingCartOutlined } from '@ant-design/icons'
import { getKanbanBoard, getPlanRuns, moveKanbanLine, createPOsFromPlan } from '../api/api'
import type { KanbanBoard, KanbanColumn, KanbanLine, PlanRun } from '../api/types'
import { useSearchParams } from 'react-router-dom'

const { Title, Text } = Typography

const COL_COLORS: Record<string, string> = {
  backlog: '#f5f5f5',
  scheduled: '#e6f4ff',
  pending_approval: '#fff7e6',
  confirmed: '#f6ffed',
}

const COL_HEADER_COLORS: Record<string, string> = {
  backlog: '#8c8c8c',
  scheduled: '#1677ff',
  pending_approval: '#fa8c16',
  confirmed: '#52c41a',
}

const TIER_COLORS: Record<string, string> = { cold: 'blue', ambient: 'cyan', room: 'green' }

function KanbanCard({ line, colKey, planRunId, onMoved }: {
  line: KanbanLine
  colKey: string
  planRunId: number
  onMoved: () => void
}) {
  const canToggle = colKey === 'scheduled' || colKey === 'backlog'

  const toggle = async () => {
    const target = colKey === 'scheduled' ? 'backlog' : 'scheduled'
    try {
      await moveKanbanLine(planRunId, line.plan_line_id, target)
      onMoved()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '이동 실패')
    }
  }

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #f0f0f0',
      borderRadius: 6,
      padding: '8px 10px',
      marginBottom: 6,
      fontSize: 12,
      cursor: canToggle ? 'pointer' : 'default',
      transition: 'box-shadow 0.2s',
    }}
      onClick={canToggle ? toggle : undefined}
      onMouseEnter={e => { if (canToggle) (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text strong style={{ fontSize: 12 }}>{line.product_code}</Text>
        {line.tier_code && <Tag color={TIER_COLORS[line.tier_code] || 'default'} style={{ fontSize: 10, margin: 0 }}>{line.tier_code}</Tag>}
      </div>
      {line.name_ja && <div style={{ color: '#595959', marginTop: 2 }}>{line.name_ja}</div>}
      <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Text type="secondary" style={{ fontSize: 11 }}>발주: {line.order_ym}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>{line.order_boxes}박스</Text>
        {line.exporter_code && <Tag style={{ fontSize: 10, margin: 0 }}>{line.exporter_code}</Tag>}
      </div>
      {line.alert && (
        <div style={{ marginTop: 4, color: '#fa8c16', fontSize: 11 }}>
          <WarningOutlined /> {line.alert}
        </div>
      )}
      {line.po_no && (
        <div style={{ marginTop: 4, fontSize: 11, color: '#52c41a' }}>
          <ShoppingCartOutlined /> {line.po_no}
        </div>
      )}
    </div>
  )
}

function KanbanColumnCard({ col, planRunId, onMoved }: { col: KanbanColumn; planRunId: number; onMoved: () => void }) {
  return (
    <div style={{
      background: COL_COLORS[col.column] || '#fafafa',
      borderRadius: 8,
      padding: '0 0 8px',
      minHeight: 400,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        background: COL_HEADER_COLORS[col.column] || '#8c8c8c',
        color: '#fff',
        borderRadius: '8px 8px 0 0',
        padding: '10px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
      }}>
        <Text strong style={{ color: '#fff', fontSize: 13 }}>{col.label_ko}</Text>
        <Badge count={col.count} style={{ backgroundColor: 'rgba(255,255,255,0.3)', color: '#fff' }} />
      </div>
      <div style={{ padding: '0 8px', flex: 1, overflowY: 'auto', maxHeight: 600 }}>
        {col.lines.map(line => (
          <KanbanCard key={line.plan_line_id} line={line} colKey={col.column} planRunId={planRunId} onMoved={onMoved} />
        ))}
        {col.lines.length === 0 && (
          <div style={{ textAlign: 'center', color: '#bfbfbf', paddingTop: 32, fontSize: 12 }}>항목 없음</div>
        )}
      </div>
    </div>
  )
}

export default function KanbanPage() {
  const [searchParams] = useSearchParams()
  const [plans, setPlans] = useState<PlanRun[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<number | undefined>()
  const [board, setBoard] = useState<KanbanBoard | null>(null)
  const [loading, setLoading] = useState(false)
  const [creatingPO, setCreatingPO] = useState(false)

  useEffect(() => {
    getPlanRuns().then(r => {
      setPlans(r.data)
      const paramId = searchParams.get('plan_run_id')
      if (paramId) setSelectedPlanId(Number(paramId))
      else if (r.data.length > 0) setSelectedPlanId(r.data[0].plan_run_id)
    })
  }, [])

  useEffect(() => {
    if (!selectedPlanId) return
    loadBoard()
  }, [selectedPlanId])

  const loadBoard = () => {
    if (!selectedPlanId) return
    setLoading(true)
    getKanbanBoard(selectedPlanId)
      .then(r => setBoard(r.data))
      .finally(() => setLoading(false))
  }

  const handleCreatePOs = async () => {
    if (!selectedPlanId) return
    setCreatingPO(true)
    try {
      const res = await createPOsFromPlan(selectedPlanId)
      message.success(`PO ${res.data.length}건이 생성되었습니다`)
      loadBoard()
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'PO 생성 실패')
    } finally {
      setCreatingPO(false)
    }
  }

  const currentPlan = plans.find(p => p.plan_run_id === selectedPlanId)

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>SKU Kanban 보드</Title>
        <Space>
          <Select
            style={{ width: 200 }}
            value={selectedPlanId}
            onChange={setSelectedPlanId}
            options={plans.map(p => ({
              value: p.plan_run_id,
              label: `${p.run_ym} v${p.version} (${p.status})`,
            }))}
            placeholder="계획 선택"
          />
          {currentPlan?.status === 'APPROVED' && (
            <Button type="primary" icon={<ShoppingCartOutlined />} loading={creatingPO} onClick={handleCreatePOs}>
              PO 일괄 생성
            </Button>
          )}
        </Space>
      </div>

      {board && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: '#8c8c8c' }}>
          <span>💡 <b>backlog/scheduled</b> 카드를 클릭하면 컬럼 간 이동 가능</span>
          <span>|</span>
          <span>총 {board.columns.reduce((s, c) => s + c.count, 0)}건</span>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <Spin size="large" />
        </div>
      ) : board ? (
        <Row gutter={8}>
          {board.columns.map(col => (
            <Col key={col.column} span={6}>
              <KanbanColumnCard col={col} planRunId={board.plan_run_id} onMoved={loadBoard} />
            </Col>
          ))}
        </Row>
      ) : (
        <Alert message="계획을 선택하세요" type="info" />
      )}
    </Space>
  )
}
