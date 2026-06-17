import { Form, Input, Button, Card, Typography, message } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { login } from '../api/api'

const { Title, Text } = Typography

export default function LoginPage() {
  const navigate = useNavigate()
  const [form] = Form.useForm()
  const [loading, setLoading] = Form.useWatch ? [false] : [false]

  const handleSubmit = async (values: { username: string; password: string }) => {
    try {
      const res = await login(values.username, values.password)
      localStorage.setItem('pm_token', res.data.access_token)
      localStorage.setItem('pm_user', JSON.stringify({
        user_id: res.data.user_id,
        username: res.data.username,
        permissions: res.data.permissions,
      }))
      navigate('/')
    } catch {
      message.error('아이디 또는 비밀번호를 확인해주세요')
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Card style={{ width: 380, borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🍶</div>
          <Title level={3} style={{ margin: 0, color: '#1a1a2e' }}>PurchaseMaster</Title>
          <Text type="secondary">일본 사케 수입 구매관리 시스템</Text>
        </div>

        <Form form={form} onFinish={handleSubmit} layout="vertical" size="large">
          <Form.Item name="username" rules={[{ required: true, message: '아이디를 입력하세요' }]}>
            <Input prefix={<UserOutlined />} placeholder="아이디" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '비밀번호를 입력하세요' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="비밀번호" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block style={{ height: 44 }}>
              로그인
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
