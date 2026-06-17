import { useEffect, useState, useCallback } from 'react'
import {
  Table, Tag, Button, Drawer, Steps, Space, Typography, message,
  Modal, Form, Input, DatePicker, Select, Divider, Descriptions, Badge,
  Popconfirm, Card, InputNumber,
} from 'antd'
import {
  CarryOutOutlined, CheckCircleOutlined, CloseCircleOutlined,
  FileSearchOutlined, RightCircleOutlined, ContainerOutlined,
} from '@ant-design/icons'
import {
  getShipments, getShipment, advanceShipment, cancelShipment,
  addInspection, receiveShipment, updateContainer, getPoLines,
} from '../api/api'
import type { ShipmentListItem, ShipmentDetail, PoLine } from '../api/types'
import dayjs from 'dayjs'

const { Title, Text } = Typography

// 상태 순서
const STATUS_ORDER = ['DEPARTED', 'ARRIVED', 'IN_TRANSIT', 'INSPECTING', 'CUSTOMS', 'RECEIVED']
const STATUS_LABELS: Record<string, string> = {
  DEPARTED: '출항',
  ARRIVED: '입항',
  IN_TRANSIT: '내륙운송',
  INSPECTING: '검수',
  CUSTOMS: '통관',
  RECEIVED: '입고완료',
  CANCELLED: '취소',
}
const STATUS_COLORS: Record<string, string> = {
  DEPARTED: 'blue',
  ARRIVED: 'cyan',
  IN_TRANSIT: 'orange',
  INSPECTING: 'purple',
  CUSTOMS: 'geekblue',
  RECEIVED: 'green',
  CANCELLED: 'red',
}

function statusStep(status: string) {
  const idx = STATUS_ORDER.indexOf(status)
  return idx >= 0 ? idx : -1
}

export default function ShipmentsPage() {
  const [data, setData] = useState<ShipmentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ShipmentDetail | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [inspectionOpen, setInspectionOpen] = useState(false)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [poLines, setPoLines] = useState<PoLine[]>([])
  const [advanceForm] = Form.useForm()
  const [inspForm] = Form.useForm()
  const [receiveForm] = Form.useForm()

  const load = useCallback(() => {
    setLoading(true)
    getShipments().then(r => setData(r.data)).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const loadDetail = useCallback((id: number) => {
    setDetailLoading(true)
    getShipment(id).then(r => setDetail(r.data)).finally(() => setDetailLoading(false))
  }, [])

  const openDrawer = (id: number) => {
    setSelectedId(id)
    setDrawerOpen(true)
    loadDetail(id)
  }

  const handleAdvance = async () => {
    if (!selectedId) return
    const values = await advanceForm.validateFields()
    const payload: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) {
      if (v == null) continue
      if (v instanceof dayjs && (v as dayjs.Dayjs).isValid()) {
        payload[k] = (v as dayjs.Dayjs).format('YYYY-MM-DD')
      } else {
        payload[k] = v
      }
    }
    try {
      await advanceShipment(selectedId, payload)
      message.success('단계가 전진되었습니다')
      setAdvanceOpen(false)
      advanceForm.resetFields()
      loadDetail(selectedId)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '오류 발생')
    }
  }

  const handleCancel = async () => {
    if (!selectedId) return
    try {
      await cancelShipment(selectedId)
      message.success('선적이 취소되었습니다')
      setDrawerOpen(false)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '취소 실패')
    }
  }

  const handleInspection = async () => {
    if (!selectedId) return
    const values = await inspForm.validateFields()
    try {
      await addInspection(selectedId, values)
      message.success('검수 결과가 등록되었습니다')
      setInspectionOpen(false)
      inspForm.resetFields()
      loadDetail(selectedId)
    } catch (e: any) {
      message.error(e.response?.data?.detail || '오류 발생')
    }
  }

  const openReceive = async () => {
    if (!detail) return
    const linesRes = await getPoLines(detail.po_id)
    setPoLines(linesRes.data)
    const initialValues: Record<string, unknown> = {}
    linesRes.data.forEach(pl => {
      initialValues[`qty_${pl.po_line_id}`] = pl.order_boxes
    })
    receiveForm.setFieldsValue(initialValues)
    setReceiveOpen(true)
  }

  const handleReceive = async () => {
    if (!selectedId || !detail) return
    const values = receiveForm.getFieldsValue()
    const lots = poLines.map(pl => ({
      po_line_id: pl.po_line_id,
      qty_boxes: values[`qty_${pl.po_line_id}`] ?? pl.order_boxes,
      exp_date: values[`exp_${pl.po_line_id}`]
        ? (values[`exp_${pl.po_line_id}`] as dayjs.Dayjs).format('YYYY-MM-DD')
        : undefined,
    }))
    try {
      const res = await receiveShipment(selectedId, lots)
      message.success(`${res.data.length}개 로트가 입고 완료되었습니다`)
      setReceiveOpen(false)
      loadDetail(selectedId)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '입고 실패')
    }
  }

  const columns = [
    {
      title: '상태', dataIndex: 'status', key: 'status', width: 90,
      render: (v: string) => <Tag color={STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag>,
    },
    {
      title: '발주서', dataIndex: 'po_no', key: 'po_no', width: 160,
      render: (v: string | null) => <Text strong>{v || '-'}</Text>,
    },
    { title: '발주월', dataIndex: 'order_ym', key: 'order_ym', width: 90 },
    { title: '수출자', dataIndex: 'exporter_code', key: 'exporter_code', width: 100 },
    { title: 'B/L', dataIndex: 'bl_no', key: 'bl_no' },
    { title: '선박', dataIndex: 'vessel_name', key: 'vessel_name' },
    {
      title: '출항일', dataIndex: 'departure_date', key: 'departure_date', width: 100,
      render: (v: string | null) => v || '-',
    },
    {
      title: '입항 예정', dataIndex: 'arrival_date', key: 'arrival_date', width: 100,
      render: (v: string | null) => v || '-',
    },
    {
      title: '컨테이너', dataIndex: 'container_count', key: 'container_count', width: 80,
      align: 'center' as const,
    },
    {
      title: '', key: 'action', width: 80,
      render: (_: unknown, row: ShipmentListItem) => (
        <Button size="small" icon={<FileSearchOutlined />} onClick={() => openDrawer(row.shipment_id)}>
          상세
        </Button>
      ),
    },
  ]

  const currentStep = detail ? statusStep(detail.status) : -1
  const stepItems = STATUS_ORDER.map((s, i) => ({
    title: STATUS_LABELS[s],
    status: (
      detail?.status === 'CANCELLED' ? 'error' :
      i < currentStep ? 'finish' :
      i === currentStep ? 'process' : 'wait'
    ) as 'finish' | 'process' | 'wait' | 'error',
  }))

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Title level={4} style={{ margin: 0 }}>선적 관리</Title>

      <Table
        dataSource={data}
        columns={columns}
        rowKey="shipment_id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 20, showTotal: t => `총 ${t}건` }}
      />

      {/* 상세 Drawer */}
      <Drawer
        title={detail ? `선적 #${detail.shipment_id} — ${detail.po_no || ''}` : '선적 상세'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={720}
        loading={detailLoading}
        extra={
          detail && detail.status !== 'RECEIVED' && detail.status !== 'CANCELLED' && (
            <Space>
              {detail.status === 'CUSTOMS' ? (
                <Button type="primary" icon={<CarryOutOutlined />} onClick={openReceive}>
                  입고 확정
                </Button>
              ) : (
                <Button type="primary" icon={<RightCircleOutlined />} onClick={() => { advanceForm.resetFields(); setAdvanceOpen(true) }}>
                  단계 전진
                </Button>
              )}
              <Popconfirm title="선적을 취소하시겠습니까?" onConfirm={handleCancel} okText="취소 확정" cancelText="닫기">
                <Button danger icon={<CloseCircleOutlined />}>취소</Button>
              </Popconfirm>
            </Space>
          )
        }
      >
        {detail && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {/* 스테퍼 */}
            <Steps
              current={detail.status === 'CANCELLED' ? currentStep : currentStep}
              items={stepItems}
              size="small"
            />

            {/* 기본 정보 */}
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="상태">
                <Tag color={STATUS_COLORS[detail.status]}>{STATUS_LABELS[detail.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="발주서">{detail.po_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="B/L 번호">{detail.bl_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="D/O 번호">{detail.do_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="선박명">{detail.vessel_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="출항항">{detail.departure_port || '-'}</Descriptions.Item>
              <Descriptions.Item label="도착항">{detail.arrival_port || '-'}</Descriptions.Item>
              <Descriptions.Item label="출항일">{detail.departure_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="입항일">{detail.arrival_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="내륙운송일">{detail.inland_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="검수일">{detail.inspection_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="통관일">{detail.customs_clearance_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="입고일">{detail.received_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="RCEP 원산지증명">{detail.rcep_cert_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="수입신고번호">{detail.customs_declaration_no || '-'}</Descriptions.Item>
            </Descriptions>

            {/* 컨테이너 목록 */}
            <Divider orientation="left">컨테이너 ({detail.container_count}개)</Divider>
            <Table
              dataSource={detail.containers}
              rowKey="container_id"
              size="small"
              pagination={false}
              columns={[
                { title: '컨테이너번호', dataIndex: 'container_no', render: (v: string | null) => v || <Text type="secondary">미입력</Text> },
                { title: '씰번호', dataIndex: 'seal_no', render: (v: string | null) => v || '-' },
                { title: '팔레트', dataIndex: 'pallets_used', width: 80 },
                { title: '적재', dataIndex: 'load_count', width: 60 },
                {
                  title: '비용 (USD)', dataIndex: 'cost_usd', width: 100, align: 'right' as const,
                  render: (v: number | null) => v != null ? `$${v.toLocaleString()}` : '-',
                },
              ]}
            />

            {/* 검수 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Divider orientation="left" style={{ flex: 1 }}>검수 결과</Divider>
              {['ARRIVED', 'IN_TRANSIT', 'INSPECTING'].includes(detail.status) && (
                <Button size="small" onClick={() => { inspForm.resetFields(); setInspectionOpen(true) }}>
                  + 검수 등록
                </Button>
              )}
            </div>
            {detail.inspections.length === 0 ? (
              <Text type="secondary">검수 결과 없음</Text>
            ) : (
              <Table
                dataSource={detail.inspections}
                rowKey="inspection_id"
                size="small"
                pagination={false}
                columns={[
                  { title: '상품', dataIndex: 'product_code' },
                  { title: '일본어명', dataIndex: 'name_ja' },
                  { title: '샘플 박스', dataIndex: 'sample_boxes', width: 90 },
                  {
                    title: '결과', dataIndex: 'result', width: 90,
                    render: (v: string) => (
                      <Tag color={v === 'PASS' ? 'green' : v === 'FAIL' ? 'red' : 'orange'}>{v}</Tag>
                    ),
                  },
                  { title: '비고', dataIndex: 'note', render: (v: string | null) => v || '-' },
                ]}
              />
            )}
          </Space>
        )}
      </Drawer>

      {/* 단계 전진 모달 */}
      <Modal
        title={`단계 전진: ${detail ? STATUS_LABELS[detail.status] : ''} → ${detail && NEXT_STATUS_LABELS[detail.status] ? NEXT_STATUS_LABELS[detail.status] : ''}`}
        open={advanceOpen}
        onOk={handleAdvance}
        onCancel={() => setAdvanceOpen(false)}
        okText="전진"
        cancelText="취소"
      >
        <Form form={advanceForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="bl_no" label="B/L 번호"><Input /></Form.Item>
          <Form.Item name="vessel_name" label="선박명"><Input /></Form.Item>
          <Form.Item name="departure_port" label="출항항"><Input /></Form.Item>
          <Form.Item name="arrival_port" label="도착항"><Input /></Form.Item>
          <Form.Item name="departure_date" label="출항일"><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="arrival_date" label="입항일"><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="inland_date" label="내륙운송 도착일"><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="inspection_date" label="검수일"><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="customs_clearance_date" label="통관일"><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="rcep_cert_no" label="RCEP 원산지증명서 번호"><Input /></Form.Item>
          <Form.Item name="customs_declaration_no" label="수입신고번호"><Input /></Form.Item>
          <Form.Item name="note" label="비고"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      {/* 검수 등록 모달 */}
      <Modal
        title="검수 결과 등록"
        open={inspectionOpen}
        onOk={handleInspection}
        onCancel={() => setInspectionOpen(false)}
        okText="등록"
        cancelText="취소"
      >
        <Form form={inspForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="product_id" label="상품 ID (product_id)"
            rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="sample_boxes" label="샘플 박스 수"
            rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={1} />
          </Form.Item>
          <Form.Item name="result" label="검수 결과"
            rules={[{ required: true }]}>
            <Select options={[
              { value: 'PASS', label: 'PASS — 합격' },
              { value: 'FAIL', label: 'FAIL — 불합격' },
              { value: 'CONDITIONAL', label: 'CONDITIONAL — 조건부 합격' },
            ]} />
          </Form.Item>
          <Form.Item name="note" label="비고"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      {/* 입고 확정 모달 */}
      <Modal
        title="입고 확정 — 로트별 박스 수 및 유통기한 입력"
        open={receiveOpen}
        onOk={handleReceive}
        onCancel={() => setReceiveOpen(false)}
        okText="입고 확정"
        cancelText="취소"
        width={600}
      >
        <Form form={receiveForm} layout="vertical" style={{ marginTop: 12 }}>
          {poLines.map(pl => (
            <Card key={pl.po_line_id} size="small" style={{ marginBottom: 8 }}
              title={`${pl.product_code || `상품 #${pl.product_id}`} ${pl.name_ja || ''}`}>
              <Space>
                <Form.Item name={`qty_${pl.po_line_id}`} label="입고 박스" style={{ margin: 0 }}>
                  <InputNumber min={0} />
                </Form.Item>
                <Form.Item name={`exp_${pl.po_line_id}`} label="유통기한" style={{ margin: 0 }}>
                  <DatePicker format="YYYY-MM-DD" />
                </Form.Item>
              </Space>
            </Card>
          ))}
        </Form>
      </Modal>
    </Space>
  )
}

const NEXT_STATUS_LABELS: Record<string, string> = {
  DEPARTED: '입항',
  ARRIVED: '내륙운송',
  IN_TRANSIT: '검수',
  INSPECTING: '통관',
  CUSTOMS: '입고완료',
}
