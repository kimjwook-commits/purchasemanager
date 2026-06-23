import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  timeout: 60000,
})

// 요청 인터셉터: 저장된 토큰 자동 첨부
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('pm_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

let _refreshing = false
let _refreshQueue: Array<(token: string) => void> = []

async function tryRefresh(): Promise<string | null> {
  const token = localStorage.getItem('pm_token')
  if (!token) return null
  try {
    const res = await axios.post('/api/auth/refresh', null, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    })
    const newToken: string = res.data.access_token
    localStorage.setItem('pm_token', newToken)
    // 사용자 정보도 갱신
    const prev = JSON.parse(localStorage.getItem('pm_user') ?? '{}')
    localStorage.setItem('pm_user', JSON.stringify({ ...prev, ...res.data }))
    return newToken
  } catch {
    return null
  }
}

// 응답 인터셉터: 401 → 토큰 갱신 1회 재시도 후 로그인 페이지로
client.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config
    if (err.response?.status !== 401 || original._retry) {
      return Promise.reject(err)
    }
    original._retry = true

    if (_refreshing) {
      // 이미 갱신 중이면 완료될 때까지 대기 후 재시도
      return new Promise((resolve, reject) => {
        _refreshQueue.push((token) => {
          original.headers.Authorization = `Bearer ${token}`
          resolve(client(original))
        })
        setTimeout(() => reject(err), 15000)
      })
    }

    _refreshing = true
    const newToken = await tryRefresh()
    _refreshing = false

    if (newToken) {
      // 대기 중이던 요청들 재시도
      _refreshQueue.forEach(cb => cb(newToken))
      _refreshQueue = []
      original.headers.Authorization = `Bearer ${newToken}`
      return client(original)
    }

    // 갱신 실패 → 로그아웃
    _refreshQueue = []
    localStorage.removeItem('pm_token')
    localStorage.removeItem('pm_user')
    window.location.href = '/login'
    return Promise.reject(err)
  }
)

export default client
