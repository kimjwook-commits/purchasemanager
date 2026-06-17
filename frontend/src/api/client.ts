import axios from 'axios'

const client = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// 요청 인터셉터: 저장된 토큰 자동 첨부
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('pm_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 응답 인터셉터: 401 → 로그인 페이지로
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('pm_token')
      localStorage.removeItem('pm_user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default client
