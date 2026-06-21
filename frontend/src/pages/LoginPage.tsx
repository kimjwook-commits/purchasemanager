import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconUser, IconLock } from '@tabler/icons-react'
import { login } from '../api/api'

export default function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await login(username, password)
      localStorage.setItem('pm_token', res.data.access_token)
      localStorage.setItem('pm_user', JSON.stringify({
        user_id: res.data.user_id,
        username: res.data.username,
        permissions: res.data.permissions,
      }))
      navigate('/')
    } catch {
      setError('아이디 또는 비밀번호를 확인해주세요.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100dvh',
      width: '100%',
      background: '#ecebe7',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--font)',
    }}>
      <div style={{
        background: '#fff',
        border: '0.5px solid var(--border-tertiary)',
        borderRadius: 'var(--radius-lg)',
        padding: '36px 40px',
        width: 360,
        boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>🍶</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: 0.2 }}>
            PurchaseMaster
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
            일본 사케 발주·물류 관리 시스템
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="form-label" style={{ marginBottom: 4 }}>아이디</div>
            <div style={{ position: 'relative' }}>
              <IconUser size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
              <input
                className="pm-input"
                type="text"
                placeholder="아이디"
                value={username}
                onChange={e => setUsername(e.target.value)}
                style={{ paddingLeft: 30 }}
                required
              />
            </div>
          </div>

          <div>
            <div className="form-label" style={{ marginBottom: 4 }}>비밀번호</div>
            <div style={{ position: 'relative' }}>
              <IconLock size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
              <input
                className="pm-input"
                type="password"
                placeholder="비밀번호"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ paddingLeft: 30 }}
                required
              />
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: 'var(--text-danger)', background: 'var(--bg-danger)', border: '0.5px solid var(--border-danger)', borderRadius: 'var(--radius-md)', padding: '7px 10px' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: 13, marginTop: 4 }}
          >
            {loading ? '로그인 중…' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  )
}
