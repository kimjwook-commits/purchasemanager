import { useEffect, useState, useCallback } from 'react'
import {
  Table, Tag, Button, Modal, Form, Input, InputNumber, DatePicker,
  Select, Space, Typography, message, Descriptions, Divider,
} from 'antd'
import { PlusOutlined, HistoryOutlined } from '@ant-design/icons'
import { getExporters, getExporterProducts, getSupplyPrices, createSupplyPrice } from '../api/api'
import type { Exporter, ExporterProduct, SupplyPrice } from '../api/types'
import dayjs from 'dayjs'

const { Title, Text } = Typography

export default function SupplyPricesPage() {
  const [exporters, setExporters] = useState<Exporter[]>([])
  const [selectedExp, setSelectedExp] = useState<number | undefined>()
  const [eps, setEps] = useState<ExporterProduct[]>([])
  const [selectedEp, setSelectedEp] = useState<ExporterProduct | null>(null)
  const [prices, setPrices] = useState<SupplyPrice[]>([])
  const [loadingEps, setLoadingEps] = useState(false)
  const [loadingPrices, setLoadingPrices] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    getExporters().then(r => setExporters(r.data.filter(e => e.is_active)))
  }, [])

  useEffect(() => {
    if (!selectedExp) { setEps([]); return }
    setLoadingEps(true)
    getExporterProducts({ exporter_id: selectedExp })
      .then(r => setEps(r.data))
      .finally(() => setLoadingEps(false))
  }, [selectedExp])

  const loadPrices = useCallback(() => {
    if (!selectedEp) return
    setLoadingPrices(true)
    getSupplyPrices(selectedEp.ep_id)
      .then(r => setPrices(r.data))
      .finally(() => setLoadingPrices(false))
  }, [selectedEp])

  useEffect(() => { loadPrices() }, [loadPrices])

  const handleSave = async () => {
    if (!selectedEp) return
    const values = await form.validateFields()
    setSaving(true)
    try {
      await createSupplyPrice({
        ep_id: selectedEp.ep_id,
        supply_price: values.supply_price,
        brewery_price: values.brewery_price,
        currency: values.currency || 'JPY',
        effective_date: (values.effective_date as dayjs.Dayjs).format('YYYY-MM-DD'),
      })
      message.success('공급 가격이 등록되었습니다')
      setModalOpen(false)
      form.resetFields()
      loadPrices()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const priceColumns = [
    {
      title: '적용일', dataIndex: 'effective_date', key: 'effective_date', width: 110,
      render: (v: string) => <Text strong>{v}</Text>,
      defaultSortOrder: 'descend' as const,
      sorter: (a: SupplyPrice, b: SupplyPrice) =>
        new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime(),
    },
    {
      title: '공급가 (수출자)', dataIndex: 'supply_price', key: 'supply_price', align: 'right' as const,
      render: (v: number, r: SupplyPrice) => `${r.currency} ${v.toLocaleString()}`,
    },
    {
      title: '양조장 원가', dataIndex: 'brewery_price', key: 'brewery_price', align: 'right' as const,
      render: (v: number | null, r: SupplyPrice) =>
        v != null ? `${r.currency} ${v.toLocaleString()}` : <Text type="secondary">비공개</Text>,
    },
    { title: '통화', dataIndex: 'currency', key: 'currency', width: 70 },
  ]

  const epColumns = [
    {
      title: '상품 코드', dataIndex: 'product_code', key: 'product_code', width: 100,
      render: (v: string | null) => <Text strong>{v || '-'}</Text>,
    },
    { title: '일본어명', dataIndex: 'name_ja', key: 'name_ja' },
    {
      title: '가격 이력', key: 'action', width: 100,
      render: (_: unknown, ep: ExporterProduct) => (
        <Button size="small" icon={<HistoryOutlined />}
          type={selectedEp?.ep_id === ep.ep_id ? 'primary' : 'default'}
          onClick={() => setSelectedEp(ep)}>
          이력 보기
        </Button>
      ),
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Title level={4} style={{ margin: 0 }}>공급 가격 관리</Title>

      {/* 수출자 선택 */}
      <Select
        style={{ width: 260 }}
        placeholder="수출자 선택"
        value={selectedExp}
        onChange={v => { setSelectedExp(v); setSelectedEp(null); setPrices([]) }}
        options={exporters.map(e => ({ value: e.exporter_id, label: `${e.code} — ${e.name}` }))}
      />

      <div style={{ display: 'flex', gap: 16 }}>
        {/* 왼쪽: 상품 목록 */}
        <div style={{ flex: 1 }}>
          <Table
            dataSource={eps}
            columns={epColumns}
            rowKey="ep_id"
            loading={loadingEps}
            size="small"
            pagination={false}
            locale={{ emptyText: '수출자를 선택하세요' }}
            rowClassName={r => r.ep_id === selectedEp?.ep_id ? 'ant-table-row-selected' : ''}
          />
        </div>

        {/* 오른쪽: 가격 이력 */}
        <div style={{ flex: 1 }}>
          {selectedEp ? (
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Text strong>{selectedEp.product_code}</Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>{selectedEp.name_ja}</Text>
                </div>
                <Button
                  type="primary" size="small" icon={<PlusOutlined />}
                  onClick={() => { form.resetFields(); setModalOpen(true) }}
                >
                  가격 등록
                </Button>
              </div>
              <Table
                dataSource={prices}
                columns={priceColumns}
                rowKey="sp_id"
                loading={loadingPrices}
                size="small"
                pagination={false}
              />
              {prices.length > 0 && (
                <>
                  <Divider style={{ margin: '8px 0' }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    💡 가격 정책: 이력 추가만 가능 (수정 불가), 최신 적용일이 현재 가격으로 적용됩니다.
                  </Text>
                </>
              )}
            </Space>
          ) : (
            <div style={{ textAlign: 'center', color: '#bfbfbf', paddingTop: 60 }}>
              왼쪽 상품의 "이력 보기"를 클릭하세요
            </div>
          )}
        </div>
      </div>

      <Modal
        title={`공급 가격 등록 — ${selectedEp?.product_code} ${selectedEp?.name_ja}`}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="등록"
        cancelText="취소"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="effective_date" label="적용 시작일"
            rules={[{ required: true, message: '적용일 필수' }]}
            initialValue={dayjs()}>
            <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
          </Form.Item>
          <Form.Item name="supply_price" label="공급가 (수출자 → 당사)"
            rules={[{ required: true, message: '공급가 필수' }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={100}
              formatter={v => `¥ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={v => v!.replace(/¥\s?|(,*)/g, '') as unknown as number} />
          </Form.Item>
          <Form.Item name="brewery_price" label="양조장 원가 (선택 — 권한 있는 사용자만 조회)">
            <InputNumber style={{ width: '100%' }} min={0} step={100}
              formatter={v => `¥ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={v => v!.replace(/¥\s?|(,*)/g, '') as unknown as number} />
          </Form.Item>
          <Form.Item name="currency" label="통화" initialValue="JPY">
            <Select options={[{ value: 'JPY' }, { value: 'USD' }, { value: 'KRW' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
