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

// 大量组件（含 NDJSON 流式请求）直接使用原生 fetch，无法走 axios 拦截器。
// 在应用入口统一包装 fetch，保证 401 时行为一致。
type PatchedWindow = Window & { __fetchAuthPatched?: boolean }
const w = window as PatchedWindow
if (!w.__fetchAuthPatched) {
  w.__fetchAuthPatched = true
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await nativeFetch(input, init)
    if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login'
    }
    return res
  }
}

export default client
