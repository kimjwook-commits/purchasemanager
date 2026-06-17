import { useState } from 'react'
import { Layout, Menu, Avatar, Dropdown, Typography, theme } from 'antd'
import {
  DashboardOutlined, ShopOutlined, FileTextOutlined, AppstoreOutlined,
  ContainerOutlined, LogoutOutlined, UserOutlined, TeamOutlined,
  TagsOutlined, DollarOutlined, BarChartOutlined, UnorderedListOutlined,
  SafetyOutlined,
} from '@ant-design/icons'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'

const { Sider, Header, Content } = Layout
const { Text } = Typography

const NAV_ITEMS = [
  {
    key: '/',
    icon: <DashboardOutlined />,
    label: '대시보드',
  },
  {
    key: 'master',
    icon: <AppstoreOutlined />,
    label: '기준정보',
    children: [
      { key: '/exporters', icon: <ShopOutlined />, label: '수출자 관리' },
      { key: '/breweries', icon: <TeamOutlined />, label: '양조장 관리' },
      { key: '/products', icon: <TagsOutlined />, label: '상품 관리' },
      { key: '/supply-prices', icon: <DollarOutlined />, label: '공급 가격' },
    ],
  },
  {
    key: 'planning',
    icon: <BarChartOutlined />,
    label: '발주 계획',
    children: [
      { key: '/planning', icon: <BarChartOutlined />, label: '계획 실행' },
      { key: '/forecast', icon: <UnorderedListOutlined />, label: '발주 예측' },
      { key: '/kanban', icon: <AppstoreOutlined />, label: 'SKU Kanban' },
    ],
  },
  {
    key: 'orders',
    icon: <FileTextOutlined />,
    label: '발주서',
    children: [
      { key: '/purchase-orders', icon: <FileTextOutlined />, label: '발주서 목록' },
    ],
  },
  {
    key: 'shipping',
    icon: <ContainerOutlined />,
    label: '선적 관리',
    children: [
      { key: '/shipments', icon: <ContainerOutlined />, label: '선적 관리' },
      { key: '/container-plan', icon: <ContainerOutlined />, label: '컨테이너 계획' },
    ],
  },
  {
    key: 'system',
    icon: <SafetyOutlined />,
    label: '시스템 관리',
    children: [
      { key: '/roles', icon: <SafetyOutlined />, label: '역할 / 권한' },
    ],
  },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const { token } = theme.useToken()

  const userStr = localStorage.getItem('pm_user')
  const user = userStr ? JSON.parse(userStr) : { username: 'admin' }

  const handleLogout = () => {
    localStorage.removeItem('pm_token')
    localStorage.removeItem('pm_user')
    navigate('/login')
  }

  // 현재 경로에 해당하는 열린 서브메뉴 키 찾기
  const openKeys = NAV_ITEMS
    .filter(item => item.children?.some(c => c.key === location.pathname))
    .map(item => item.key)

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={220}
        style={{ background: '#001529' }}
      >
        <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: collapsed ? 22 : 16,
          fontWeight: 700,
          letterSpacing: 1,
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          {collapsed ? '🍶' : '🍶 PurchaseMaster'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={openKeys}
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>

      <Layout>
        <Header style={{
          padding: '0 24px',
          background: token.colorBgContainer,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          boxShadow: '0 1px 4px rgba(0,21,41,0.08)',
        }}>
          <Dropdown
            menu={{
              items: [
                { key: 'logout', icon: <LogoutOutlined />, label: '로그아웃', onClick: handleLogout },
              ],
            }}
            placement="bottomRight"
          >
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar icon={<UserOutlined />} size="small" style={{ background: token.colorPrimary }} />
              <Text>{user.username}</Text>
            </div>
          </Dropdown>
        </Header>

        <Content style={{
          margin: 24,
          padding: 24,
          background: token.colorBgContainer,
          borderRadius: token.borderRadiusLG,
          minHeight: 'calc(100vh - 64px - 48px)',
        }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
