import { useEffect, useState } from 'react'
import { Table, Tag, Button, Modal, Form, Input, Space, Typography, message, Switch } from 'antd'
import { PlusOutlined, EditOutlined } from '@ant-design/icons'
import { getExporters, createExporter, updateExporter } from '../api/api'
import type { Exporter } from '../api/types'

const { Title } = Typography

export default function ExportersPage() {
  const [data, setData] = useState<Exporter[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Exporter | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = () => {
    setLoading(true)
    getExporters()
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const openNew = () => { setEditing(null); form.resetFields(); setModalOpen(true) }
  const openEdit = (row: Exporter) => { setEditing(row); form.setFieldsValue(row); setModalOpen(true) }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editing) {
        await updateExporter(editing.exporter_id, values)
        message.success('수출자 정보가 수정되었습니다')
      } else {
        await createExporter(values)
        message.success('수출자가 등록되었습니다')
      }
      setModalOpen(false)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const columns = [
    { title: '코드', dataIndex: 'code', key: 'code', width: 100, render: (v: string) => <Tag>{v}</Tag> },
    { title: '수출자명', dataIndex: 'name', key: 'name' },
    { title: '국가', dataIndex: 'country', key: 'country', width: 80 },
    { title: '연락처 이메일', dataIndex: 'contact_email', key: 'contact_email', render: (v: string | null) => v || '-' },
    {
      title: '활성', dataIndex: 'is_active', key: 'is_active', width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '활성' : '비활성'}</Tag>,
    },
    {
      title: '',
      key: 'action',
      width: 60,
      render: (_: unknown, row: Exporter) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
      ),
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>수출자 관리</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>신규 등록</Button>
      </div>

      <Table
        dataSource={data}
        columns={columns}
        rowKey="exporter_id"
        loading={loading}
        size="middle"
        pagination={false}
      />

      <Modal
        title={editing ? '수출자 수정' : '수출자 등록'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText="저장"
        cancelText="취소"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="code" label="코드" rules={[{ required: true, message: '코드 필수' }]}>
            <Input placeholder="예: CRJPN" />
          </Form.Item>
          <Form.Item name="name" label="수출자명" rules={[{ required: true, message: '수출자명 필수' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="country" label="국가 코드" initialValue="JPN">
            <Input placeholder="JPN" maxLength={3} />
          </Form.Item>
          <Form.Item name="contact_email" label="연락처 이메일">
            <Input type="email" />
          </Form.Item>
          <Form.Item name="is_active" label="활성" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
