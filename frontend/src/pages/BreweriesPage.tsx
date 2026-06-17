import { useEffect, useState } from 'react'
import { Table, Tag, Button, Modal, Form, Input, Space, Typography, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { getBreweries, createBrewery } from '../api/api'
import type { Brewery } from '../api/types'

const { Title } = Typography

export default function BreweriesPage() {
  const [data, setData] = useState<Brewery[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = () => {
    setLoading(true)
    getBreweries().then(r => setData(r.data)).finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      await createBrewery(values)
      message.success('양조장이 등록되었습니다')
      setModalOpen(false)
      form.resetFields()
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    { title: '양조장명', dataIndex: 'name', key: 'name' },
    { title: '일본어명', dataIndex: 'name_ja', key: 'name_ja', render: (v: string | null) => v || '-' },
    { title: '국가', dataIndex: 'country', key: 'country', width: 80 },
    { title: '지역', dataIndex: 'region', key: 'region', render: (v: string | null) => v || '-' },
    {
      title: '활성', dataIndex: 'is_active', key: 'is_active', width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '활성' : '비활성'}</Tag>,
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>양조장 관리</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setModalOpen(true) }}>
          신규 등록
        </Button>
      </div>

      <Table dataSource={data} columns={columns} rowKey="brewery_id" loading={loading} size="middle" pagination={false} />

      <Modal
        title="양조장 등록"
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="저장"
        cancelText="취소"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="양조장명 (영문)" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="name_ja" label="일본어명">
            <Input />
          </Form.Item>
          <Form.Item name="country" label="국가 코드" initialValue="JPN">
            <Input placeholder="JPN" maxLength={3} />
          </Form.Item>
          <Form.Item name="region" label="지역">
            <Input placeholder="예: Hyogo, Kyoto" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
