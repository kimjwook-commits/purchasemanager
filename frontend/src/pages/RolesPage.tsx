import { useEffect, useState, useCallback } from 'react'
import {
  Table, Tag, Button, Modal, Form, Input, Select, Space, Typography,
  message, Tabs, Checkbox, Popconfirm, Divider,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  UserAddOutlined, MinusCircleOutlined,
} from '@ant-design/icons'
import client from '../api/client'

const { Title, Text } = Typography

interface RoleRead {
  role_id: number
  name: string
  description: string | null
  permissions: string[]
}

interface UserWithRoles {
  user_id: number
  username: string
  email: string
  is_active: boolean
  roles: RoleRead[]
}

const PERMISSION_LABELS: Record<string, string> = {
  po_approve: '발주 승인 / 선적 단계 전진',
  price_view_brewery: '양조장 원가 조회',
  role_manage: '역할 관리 (superadmin)',
}

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleRead[]>([])
  const [users, setUsers] = useState<UserWithRoles[]>([])
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [roleModal, setRoleModal] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleRead | null>(null)
  const [assignModal, setAssignModal] = useState(false)
  const [assignUser, setAssignUser] = useState<UserWithRoles | null>(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()
  const [assignForm] = Form.useForm()

  const loadAll = useCallback(() => {
    setLoading(true)
    Promise.all([
      client.get<RoleRead[]>('/v1/roles/'),
      client.get<UserWithRoles[]>('/v1/roles/users'),
      client.get<string[]>('/v1/roles/permissions'),
    ])
      .then(([r, u, p]) => {
        setRoles(r.data)
        setUsers(u.data)
        setPermissions(p.data)
      })
      .catch(e => message.error(e.response?.data?.detail || '로드 실패'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const openCreate = () => {
    setEditingRole(null)
    form.resetFields()
    setRoleModal(true)
  }

  const openEdit = (role: RoleRead) => {
    setEditingRole(role)
    form.setFieldsValue({ name: role.name, description: role.description, permissions: role.permissions })
    setRoleModal(true)
  }

  const handleSaveRole = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editingRole) {
        await client.put(`/v1/roles/${editingRole.role_id}`, values)
        message.success('역할이 수정되었습니다')
      } else {
        await client.post('/v1/roles/', values)
        message.success('역할이 생성되었습니다')
      }
      setRoleModal(false)
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRole = async (role_id: number) => {
    try {
      await client.delete(`/v1/roles/${role_id}`)
      message.success('역할이 삭제되었습니다')
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '삭제 실패')
    }
  }

  const openAssign = (user: UserWithRoles) => {
    setAssignUser(user)
    assignForm.resetFields()
    setAssignModal(true)
  }

  const handleAssign = async () => {
    const values = await assignForm.validateFields()
    if (!assignUser) return
    setSaving(true)
    try {
      await client.post(`/v1/roles/users/${assignUser.user_id}/assign`, { role_id: values.role_id })
      message.success('역할이 부여되었습니다')
      setAssignModal(false)
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '부여 실패')
    } finally {
      setSaving(false)
    }
  }

  const handleRevoke = async (user_id: number, role_id: number) => {
    try {
      await client.delete(`/v1/roles/users/${user_id}/roles/${role_id}`)
      message.success('역할이 회수되었습니다')
      loadAll()
    } catch (e: any) {
      message.error(e.response?.data?.detail || '회수 실패')
    }
  }

  const roleColumns = [
    { title: '역할명', dataIndex: 'name', key: 'name', render: (v: string) => <Text strong>{v}</Text> },
    { title: '설명', dataIndex: 'description', key: 'description', render: (v: string | null) => v || '-' },
    {
      title: '권한', dataIndex: 'permissions', key: 'permissions',
      render: (perms: string[]) => perms.map(p => (
        <Tag key={p} color="blue">{PERMISSION_LABELS[p] || p}</Tag>
      )),
    },
    {
      title: '', key: 'action', width: 120,
      render: (_: unknown, r: RoleRead) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>수정</Button>
          <Popconfirm title="역할을 삭제하시겠습니까?" onConfirm={() => handleDeleteRole(r.role_id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>삭제</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const userColumns = [
    { title: '사용자명', dataIndex: 'username', key: 'username', render: (v: string) => <Text strong>{v}</Text> },
    { title: '이메일', dataIndex: 'email', key: 'email' },
    {
      title: '활성', dataIndex: 'is_active', key: 'is_active', width: 70,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? '활성' : '비활성'}</Tag>,
    },
    {
      title: '보유 역할', dataIndex: 'roles', key: 'roles',
      render: (roles: RoleRead[], user: UserWithRoles) => (
        <Space wrap>
          {roles.map(r => (
            <Tag key={r.role_id} closable
              onClose={() => handleRevoke(user.user_id, r.role_id)}>
              {r.name}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '', key: 'action', width: 90,
      render: (_: unknown, u: UserWithRoles) => (
        <Button size="small" icon={<UserAddOutlined />} onClick={() => openAssign(u)}>
          역할 부여
        </Button>
      ),
    },
  ]

  const tabItems = [
    {
      key: 'roles',
      label: '역할 목록',
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>역할 생성</Button>
          </div>
          <Table dataSource={roles} columns={roleColumns} rowKey="role_id"
            loading={loading} size="small" pagination={false} />
        </Space>
      ),
    },
    {
      key: 'users',
      label: '사용자 역할 관리',
      children: (
        <Table dataSource={users} columns={userColumns} rowKey="user_id"
          loading={loading} size="small" pagination={false} />
      ),
    },
  ]

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Title level={4} style={{ margin: 0 }}>역할 / 권한 관리 (RBAC)</Title>

      <Tabs items={tabItems} />

      {/* 역할 생성/수정 모달 */}
      <Modal
        title={editingRole ? `역할 수정: ${editingRole.name}` : '새 역할 생성'}
        open={roleModal}
        onOk={handleSaveRole}
        onCancel={() => setRoleModal(false)}
        confirmLoading={saving}
        okText="저장"
        cancelText="취소"
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="name" label="역할명" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="설명">
            <Input />
          </Form.Item>
          <Form.Item name="permissions" label="권한" initialValue={[]}>
            <Checkbox.Group style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {permissions.map(p => (
                <Checkbox key={p} value={p}>
                  <Text strong>{p}</Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>
                    {PERMISSION_LABELS[p] ? `— ${PERMISSION_LABELS[p]}` : ''}
                  </Text>
                </Checkbox>
              ))}
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* 역할 부여 모달 */}
      <Modal
        title={`역할 부여: ${assignUser?.username}`}
        open={assignModal}
        onOk={handleAssign}
        onCancel={() => setAssignModal(false)}
        confirmLoading={saving}
        okText="부여"
        cancelText="취소"
      >
        <Form form={assignForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="role_id" label="부여할 역할" rules={[{ required: true }]}>
            <Select
              options={roles
                .filter(r => !assignUser?.roles.some(ur => ur.role_id === r.role_id))
                .map(r => ({ value: r.role_id, label: r.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
