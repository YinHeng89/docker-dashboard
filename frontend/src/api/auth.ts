import client from './client'

// 检查系统是否已初始化
export async function checkAuthStatus(): Promise<{ initialized: boolean }> {
  const { data } = await client.get('/auth/status')
  return data
}

// 登录
export async function login(password: string): Promise<void> {
  await client.post('/auth/login', { password })
}

// 首次设置密码
export async function setupPassword(password: string): Promise<void> {
  await client.post('/auth/setup', { password })
}

// 登出
export async function logout(): Promise<void> {
  await client.post('/auth/logout')
}

// 获取当前用户信息
export async function getCurrentUser(): Promise<{ username: string; configured: boolean }> {
  const { data } = await client.get('/auth/me')
  return data
}

// 修改密码
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await client.put('/auth/password', { oldPassword, newPassword })
}

// 更新偏好设置
export async function updatePreferences(preferences: Record<string, unknown>): Promise<void> {
  await client.put('/auth/prefs', preferences)
}

// 获取偏好设置
export async function getPreferences(): Promise<Record<string, unknown>> {
  const { data } = await client.get('/auth/prefs')
  return data
}
