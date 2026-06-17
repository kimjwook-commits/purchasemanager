import { useEffect, useState } from 'react'
import { Table, Tag, Button, Space, Typography, Modal, Form, DatePicker, message, Tooltip, Alert } from 'antd'
import { PlayCircleOutlined, CheckOutlined, AppstoreOutlined } from '@ant-design/icons'
import { getPlanRuns, runPlan, approvePlan } from '../api/api'
import type { PlanRun } from '../api/types'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'

const { Title, Text } = Typography

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  DRAFT:    { color: 'default', label: '초안' },
  APPROVED: { color: 'green',   label: '승인' },
  ARCHIVED: { color: 'gray',    label: '보관' },
}

export default function PlanningPage() {
  const [data, setData] = useState<PlanRun[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const navigate = useNavigate()

  const load = () => {
    setLoading(true)
    getPlanRuns().then(r => setData(r.data)).finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleRun = async () => {
    const values = await form.validateFields()
    const run_ym = (values.run_ym as dayjs.Dayjs).format('YYYY-MM')
    setRunning(true)
    try {
      await runPlan(run_ym)
      message.success(`${run_ym} 발주계획이 실행되었습니다`)
      setModalOpen(false)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '계획 실행 실패')
    } finally {
      setRunning(false)
    }
  }

  const handleApprove = async (run: PlanRun) => {
    try {
      await approvePlan(run.plan_run_id)
      message.success(`계획 ${run.run_ym} v${run.version} 승인 완료`)
      load()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '승인 실패')
    }
  }

  const columns = [
    { title: '계획 연월', dataIndex: 'run_ym', key: 'run_ym', width: 120 },
    {
      title: '버전', dataIndex: 'version', key: 'version', width: 80,
      render: (v: number) => <Tag>v{v}</Tag>,
    },
    {
      title: '상태', dataIndex: 'status', key: 'status', width: 90,
      render: (v: string) => {
        const c = STATUS_CONFIG[v] || { color: 'default', label: v }
        return <Tag color={c.color}>{c.label}</Tag>
      },
    },
    {
      title: '서비스 레벨 Z', dataIndex: 'service_z', key: 'service_z', width: 120,
      render: (v: number) => v?.toFixed(2),
    },
    {
      title: '생성일', dataIndex: 'created_at', key: 'created_at',
      render: (v: string) => dayjs(v).format('YYYY/MM/DD HH:mm'),
    },
    {
      title: '',
      key: 'actions',
      width: 200,
      render: (_: unknown, row: PlanRun) => (
        <Space>
          {row.status === 'DRAFT' && (
            <Tooltip title="계획 승인">
              <Button size="small" icon={<CheckOutlined />} type="primary" ghost
                onClick={() => handleApprove(row)}>
                승인
              </Button>
            </Tooltip>
          )}
          <Tooltip title="SKU Kanban 보기">
            <Button size="small" icon={<AppstoreOutlined />}
              onClick={() => navigate(`/kanban?plan_run_id=${row.plan_run_id}`)}>
              Kanban
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>발주 계획 실행</Title>
        <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => { form.resetFields(); setModalOpen(true) }}>
          계획 실행
        </Button>
      </div>

      <Alert
        message="R,S 재고 정책 기반 자동 발주계획 엔진"
        description="짝수 달 발주 원칙, 온도 티어별 리뷰 주기, 서비스 레벨 98% (Z=2.05) 기준으로 12개월 rolling 계획을 생성합니다."
        type="info"
        showIcon
        closable
      />

      <Table
        dataSource={data}
        columns={columns}
        rowKey="plan_run_id"
        loading={loading}
        size="middle"
        pagination={false}
      />

      <Modal
        title="발주계획 실행"
        open={modalOpen}
        onOk={handleRun}
        onCancel={() => setModalOpen(false)}
        confirmLoading={running}
        okText="실행"
        cancelText="취소"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="run_ym"
            label="계획 기준월"
            rules={[{ required: true, message: '기준월을 선택하세요' }]}
            extra="해당 월부터 12개월 rolling 계획이 생성됩니다"
          >
            <DatePicker picker="month" format="YYYY-MM" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
