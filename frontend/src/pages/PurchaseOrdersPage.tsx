import { useEffect, useState } from 'react'
import { Table, Tag, Button, Space, Typography, Modal, Descriptions, Divider, message, Select } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import { getPurchaseOrders, getPoLines, updatePoStatus } from '../api/api'
import type { PurchaseOrder, PoLine } from '../api/types'
import dayjs from 'dayjs'

const { Title, Text } = Typography

const STATUS_CONFIG: Record<string, { color: string; label: string; next?: string; nextLabel?: string }> = {
  DRAFT:     { color: 'default', label: '초안',   next: 'SUBMITTED', nextLabel: '제출' },
  SUBMITTED: { color: 'blue',    label: '제출됨',  next: 'CONFIRMED', nextLabel: '확정' },
  CONFIRMED: { color: 'green',   label: '확정',   next: 'RECEIVED',  nextLabel: '입고 완료' },
  RECEIVED:  { color: 'purple',  label: '입고' },
  CANCELLED: { color: 'red',     label: '취소' },
}

export default function PurchaseOrdersPage() {
  const [data, setData] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string | undefined>()
  const [detailPo, setDetailPo] = useState<PurchaseOrder | null>(null)
  const [lines, setLines] = useState<PoLine[]>([])
  const [lineLoading, setLineLoading] = useState(false)

  const load = () => {
    setLoading(true)
    getPurchaseOrders({ po_status: filterStatus })
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(load, [filterStatus])

  const openDetail = async (po: PurchaseOrder) => {
    setDetailPo(po)
    setLineLoading(true)
    getPoLines(po.po_id)
      .then(r => setLines(r.data))
      .finally(() => setLineLoading(false))
  }

  const handleAdvance = async (po: PurchaseOrder) => {
    const cfg = STATUS_CONFIG[po.status]
    if (!cfg.next) return
    try {
      await updatePoStatus(po.po_id, cfg.next)
      message.success(`PO 상태가 "${cfg.nextLabel}"으로 변경되었습니다`)
      load()
      if (detailPo?.po_id === po.po_id) setDetailPo({ ...po, status: cfg.next })
    } catch (e: any) {
      message.error(e.response?.data?.detail || '상태 변경 실패')
    }
  }

  const columns = [
    { title: 'PO 번호', dataIndex: 'po_no', key: 'po_no', render: (v: string) => <Text strong>{v}</Text> },
    { title: '수출자', dataIndex: 'exporter_code', key: 'exporter_code' },
    { title: '발주월', dataIndex: 'order_ym', key: 'order_ym', width: 100 },
    {
      title: '상태', dataIndex: 'status', key: 'status', width: 90,
      render: (v: string) => {
        const c = STATUS_CONFIG[v] || { color: 'default', label: v }
        return <Tag color={c.color}>{c.label}</Tag>
      },
    },
    { title: '라인 수', dataIndex: 'line_count', key: 'line_count', width: 80, align: 'right' as const },
    {
      title: '박스', dataIndex: 'total_boxes', key: 'total_boxes', width: 90,
      align: 'right' as const, render: (v: number) => v.toLocaleString(),
    },
    {
      title: '생성일', dataIndex: 'created_at', key: 'created_at', width: 120,
      render: (v: string) => dayjs(v).format('MM/DD HH:mm'),
    },
    {
      title: '',
      key: 'action',
      width: 100,
      render: (_: unknown, row: PurchaseOrder) => (
        <Space>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>상세</Button>
        </Space>
      ),
    },
  ]

  const lineColumns = [
    { title: '상품 코드', dataIndex: 'product_code', key: 'product_code', width: 100 },
    { title: '일본어명', dataIndex: 'name_ja', key: 'name_ja' },
    {
      title: '티어', dataIndex: 'tier_code', key: 'tier_code', width: 80,
      render: (v: string | null) => v ? <Tag>{v}</Tag> : '-',
    },
    { title: '박스', dataIndex: 'order_boxes', key: 'order_boxes', align: 'right' as const },
    {
      title: '단가 (JPY)', dataIndex: 'unit_price', key: 'unit_price', align: 'right' as const,
      render: (v: number | null) => v ? `¥${v.toLocaleString()}` : '-',
    },
    {
      title: '금액 (JPY)', dataIndex: 'amount_jpy', key: 'amount_jpy', align: 'right' as const,
      render: (v: number | null) => v ? `¥${v.toLocaleString()}` : '-',
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>발주서 목록</Title>
        <Select
          placeholder="상태 필터"
          allowClear
          style={{ width: 130 }}
          onChange={v => setFilterStatus(v)}
          options={Object.entries(STATUS_CONFIG).map(([k, v]) => ({ value: k, label: v.label }))}
        />
      </div>

      <Table
        dataSource={data}
        columns={columns}
        rowKey="po_id"
        loading={loading}
        size="middle"
        pagination={{ pageSize: 10, showTotal: t => `총 ${t}건` }}
      />

      {/* 상세 모달 */}
      <Modal
        title={detailPo?.po_no}
        open={!!detailPo}
        onCancel={() => setDetailPo(null)}
        footer={
          detailPo && STATUS_CONFIG[detailPo.status]?.next ? (
            <Button type="primary" onClick={() => handleAdvance(detailPo)}>
              {STATUS_CONFIG[detailPo.status].nextLabel}으로 전환
            </Button>
          ) : null
        }
        width={800}
      >
        {detailPo && (
          <>
            <Descriptions size="small" column={3} bordered>
              <Descriptions.Item label="수출자">{detailPo.exporter_code} / {detailPo.exporter_name}</Descriptions.Item>
              <Descriptions.Item label="발주월">{detailPo.order_ym}</Descriptions.Item>
              <Descriptions.Item label="상태">
                <Tag color={STATUS_CONFIG[detailPo.status]?.color}>{STATUS_CONFIG[detailPo.status]?.label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="총 박스">{detailPo.total_boxes.toLocaleString()} 박스</Descriptions.Item>
              <Descriptions.Item label="라인 수">{detailPo.line_count}개</Descriptions.Item>
              <Descriptions.Item label="생성일">{dayjs(detailPo.created_at).format('YYYY/MM/DD HH:mm')}</Descriptions.Item>
            </Descriptions>
            <Divider />
            <Table
              dataSource={lines}
              columns={lineColumns}
              rowKey="po_line_id"
              size="small"
              loading={lineLoading}
              pagination={false}
              summary={rows => {
                const totalAmt = rows.reduce((s, r) => s + (r.amount_jpy || 0), 0)
                const totalBoxes = rows.reduce((s, r) => s + r.order_boxes, 0)
                return (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={3}><Text strong>합계</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right"><Text strong>{totalBoxes.toLocaleString()}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} />
                    <Table.Summary.Cell index={5} align="right"><Text strong>¥{totalAmt.toLocaleString()}</Text></Table.Summary.Cell>
                  </Table.Summary.Row>
                )
              }}
            />
          </>
        )}
      </Modal>
    </Space>
  )
}
