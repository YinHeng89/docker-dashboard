import axios from 'axios'

const client = axios.create({
  baseURL: '',
  timeout: 30000,
  withCredentials: true,
})

// 响应拦截：401 → 跳转登录页
client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      // 避免登录页本身循环跳转
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default client
