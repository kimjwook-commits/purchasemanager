import { useEffect, useState } from 'react'
import { Table, Tag, Button, Space, Typography, Card, Collapse, Descriptions, message, Spin, Select, Alert } from 'antd'
import { RocketOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { getPurchaseOrders, generateContainerPlan, confirmContainerPlan } from '../api/api'
import type { PurchaseOrder, PackingPlanResult, ContainerSlot } from '../api/types'

const { Title, Text } = Typography
const { Panel } = Collapse

const TIER_TAG: Record<string, string> = { cold: '냉장', room: '상온' }
const TIER_COLOR: Record<string, string> = { cold: 'blue', room: 'green' }

function ContainerDetail({ slot }: { slot: ContainerSlot }) {
  const lineColumns = [
    { title: '상품 코드', dataIndex: 'product_code', key: 'product_code' },
    { title: '일본어명', dataIndex: 'name_ja', key: 'name_ja' },
    { title: '팔레트', dataIndex: 'pallets_in_container', key: 'pallets_in_container', align: 'right' as const },
    { title: '박스', dataIndex: 'boxes_in_container', key: 'boxes_in_container', align: 'right' as const },
    { title: '레이어', dataIndex: 'layers_in_container', key: 'layers_in_container', align: 'right' as const },
    {
      title: '팔레트 위치', key: 'position',
      render: (_: unknown, r: { pallet_start: number; pallets_in_container: number }) =>
        `${r.pallet_start} ~ ${r.pallet_start + r.pallets_in_container - 1}`,
    },
  ]

  return (
    <div style={{ padding: '8px 16px' }}>
      <div style={{ marginBottom: 8, display: 'flex', gap: 16 }}>
        <Text type="secondary">사용 팔레트: <Text strong>{slot.pallets_used}/{slot.max_pallets}</Text></Text>
        <Text type="secondary">비용: <Text strong>${slot.cost_usd}</Text></Text>
        <Tag color={TIER_COLOR[slot.tier_code] || 'default'}>{TIER_TAG[slot.tier_code] || slot.tier_code}</Tag>
      </div>
      <Table
        dataSource={slot.assignments}
        columns={lineColumns}
        rowKey="po_line_id"
        size="small"
        pagination={false}
      />
    </div>
  )
}

export default function ContainerPlanPage() {
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [selectedPoId, setSelectedPoId] = useState<number | undefined>()
  const [plan, setPlan] = useState<PackingPlanResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setLoading(true)
    getPurchaseOrders({ po_status: 'CONFIRMED' })
      .then(r => setPos(r.data))
      .finally(() => setLoading(false))
  }, [])

  const handleGenerate = async () => {
    if (!selectedPoId) return
    setGenerating(true)
    try {
      const res = await generateContainerPlan(selectedPoId)
      setPlan(res.data)
    } catch (e: any) {
      message.error(e.response?.data?.detail || '계획 생성 실패')
    } finally {
      setGenerating(false)
    }
  }

  const handleConfirm = async () => {
    if (!selectedPoId) return
    setConfirming(true)
    try {
      await confirmContainerPlan(selectedPoId)
      message.success('컨테이너 계획이 확정되었습니다 (선적 건 생성 완료)')
    } catch (e: any) {
      message.error(e.response?.data?.detail || '확정 실패')
    } finally {
      setConfirming(false)
    }
  }

  const selectedPo = pos.find(p => p.po_id === selectedPoId)

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>컨테이너 배정 계획</Title>
      </div>

      <Alert
        message="FFD (First Fit Decreasing) 알고리즘"
        description="PO 라인의 박스 수를 팔레트로 환산하고, 비용 최소화 원칙(40ft vs 20ft)으로 컨테이너를 배정합니다."
        type="info" showIcon closable
      />

      <Card size="small">
        <Space>
          <Select
            style={{ width: 320 }}
            placeholder="확정(CONFIRMED) 발주서 선택"
            loading={loading}
            value={selectedPoId}
            onChange={v => { setSelectedPoId(v); setPlan(null) }}
            options={pos.map(p => ({
              value: p.po_id,
              label: `${p.po_no} | ${p.exporter_code} | ${p.total_boxes}박스`,
            }))}
          />
          <Button
            type="primary" icon={<RocketOutlined />}
            onClick={handleGenerate} loading={generating} disabled={!selectedPoId}
          >
            계획 생성 (미리보기)
          </Button>
          {plan && (
            <Button
              type="primary" ghost icon={<CheckCircleOutlined />}
              onClick={handleConfirm} loading={confirming}
            >
              계획 확정
            </Button>
          )}
        </Space>
      </Card>

      {plan && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {/* 요약 */}
          <Card size="small" title="배정 요약">
            <Descriptions size="small" column={4} bordered>
              <Descriptions.Item label="PO 번호">{plan.po_no}</Descriptions.Item>
              <Descriptions.Item label="총 박스">{plan.total_boxes.toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="총 팔레트">{plan.total_pallets}</Descriptions.Item>
              <Descriptions.Item label="컨테이너 수">{plan.container_count}</Descriptions.Item>
              <Descriptions.Item label="총 비용" span={4}>
                <Text strong style={{ color: '#1677ff' }}>${plan.total_cost_usd.toLocaleString()}</Text>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* 컨테이너별 적재 명세 */}
          <Card size="small" title="컨테이너별 적재 명세">
            <Collapse>
              {plan.containers.map(slot => (
                <Panel
                  key={slot.seq}
                  header={
                    <Space>
                      <Text strong>컨테이너 #{slot.seq}</Text>
                      <Tag color={TIER_COLOR[slot.tier_code] || 'default'}>
                        {TIER_TAG[slot.tier_code] || slot.tier_code}
                      </Tag>
                      <Tag>{slot.container_type}</Tag>
                      <Text type="secondary">{slot.pallets_used}/{slot.max_pallets} 팔레트</Text>
                      <Text type="secondary">${slot.cost_usd}</Text>
                    </Space>
                  }
                >
                  <ContainerDetail slot={slot} />
                </Panel>
              ))}
            </Collapse>
          </Card>
        </Space>
      )}
    </Space>
  )
}
