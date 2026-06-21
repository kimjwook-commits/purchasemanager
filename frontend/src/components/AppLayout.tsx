import { useState } from 'react'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import {
  IconDatabase, IconShieldCheck, IconChartBar, IconLayoutKanban,
  IconFileText, IconPackage, IconShip, IconSettings,
  IconChevronRight, IconLogout, IconUser, IconLayoutDashboard,
} from '@tabler/icons-react'

interface NavItem {
  key: string
  label: string
  badge?: string
  Icon: React.ComponentType<{ size?: number; stroke?: number }>
}

const NAV_ITEMS: NavItem[] = [
  { key: '/dashboard',      label: '대시보드',     Icon: IconLayoutDashboard },
  { key: '/setup',          label: '초기 설정',    badge: 'S',  Icon: IconDatabase },
  { key: '/compliance',     label: '브랜드·품목',      badge: '0',  Icon: IconShieldCheck },
  { key: '/forecast',       label: '발주·수발주',  badge: '1',  Icon: IconChartBar },
  { key: '/sku-board',      label: '스팟 선정',    badge: '2',  Icon: IconLayoutKanban },
  { key: '/purchase-orders',label: 'PO 작성',      badge: '3',  Icon: IconFileText },
  { key: '/pallet-plan',    label: '팔레트·컨테이너', badge: '4', Icon: IconPackage },
  { key: '/shipments',      label: '이송·통관',    badge: '5',  Icon: IconShip },
  { key: '/settings',       label: '시스템',                    Icon: IconSettings },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [showUser, setShowUser] = useState(false)

  const userStr = localStorage.getItem('pm_user')
  const user = userStr ? JSON.parse(userStr) : { username: 'admin' }

  const handleLogout = () => {
    localStorage.removeItem('pm_token')
    localStorage.removeItem('pm_user')
    navigate('/login')
  }

  return (
    <div style={{ display: 'flex', width: '100%', height: '100dvh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: 200,
        flexShrink: 0,
        background: '#fff',
        borderRight: '0.5px solid var(--border-tertiary)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Logo */}
        <div style={{
          padding: '16px 18px 14px',
          borderBottom: '0.5px solid var(--border-tertiary)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: 0.2 }}>
            🍶 PurchaseMaster
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
            사케 발주·물류 관리
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
          {NAV_ITEMS.map(({ key, label, badge, Icon }) => {
            const active = location.pathname === key || location.pathname.startsWith(key + '/')
            return (
              <button
                key={key}
                onClick={() => navigate(key)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '7px 10px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: active ? 'var(--bg-info)' : 'transparent',
                  color: active ? 'var(--text-info)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font)',
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                  textAlign: 'left',
                  marginBottom: 2,
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {badge && (
                  <span style={{
                    width: 18, height: 18, borderRadius: 5,
                    background: active ? 'var(--text-info)' : 'var(--border-secondary)',
                    color: active ? '#fff' : 'var(--text-tertiary)',
                    fontSize: 10, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {badge}
                  </span>
                )}
                {!badge && <Icon size={14} stroke={1.8} />}
                <span style={{ flex: 1 }}>{label}</span>
                {active && <IconChevronRight size={12} stroke={2} />}
              </button>
            )
          })}
        </nav>

        {/* User */}
        <div style={{
          borderTop: '0.5px solid var(--border-tertiary)',
          padding: '10px 12px',
          position: 'relative',
        }}>
          <button
            onClick={() => setShowUser(v => !v)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              fontFamily: 'var(--font)',
            }}
          >
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: 'var(--bg-secondary)',
              border: '0.5px solid var(--border-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <IconUser size={14} stroke={1.5} color="var(--text-secondary)" />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, textAlign: 'left' }}>
              {user.username}
            </span>
          </button>
          {showUser && (
            <div style={{
              position: 'absolute', bottom: 52, left: 8, right: 8,
              background: 'var(--bg-primary)',
              border: '0.5px solid var(--border-secondary)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
              overflow: 'hidden',
            }}>
              <button
                onClick={handleLogout}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '9px 12px', background: 'none', border: 'none',
                  cursor: 'pointer', fontFamily: 'var(--font)',
                  fontSize: 12, color: 'var(--text-danger)',
                }}
              >
                <IconLogout size={14} stroke={1.8} />
                로그아웃
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Content */}
      <main style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        background: '#ecebe7',
        padding: '24px 28px',
      }}>
        <Outlet />
      </main>
    </div>
  )
}
