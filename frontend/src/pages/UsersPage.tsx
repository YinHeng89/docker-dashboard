import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Users, User, Shield, Key, Save,
  CheckCircle2, XCircle, Clock, AlertTriangle,
  Activity, Monitor, Eye, EyeOff, Server, Cpu,
} from 'lucide-react'
import { getCurrentUser, changePassword } from '../api/auth'
import { useSystemInfo } from '../hooks/useSystemInfo'

export default function UsersPage() {
  const { t } = useTranslation()
  const { info: systemInfo } = useSystemInfo()
  const [userInfo, setUserInfo] = useState<{ username: string; configured: boolean } | null>(null)
  const [loading, setLoading] = useState(true)

  // 密码修改
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<'success' | 'error' | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [showOldPass, setShowOldPass] = useState(false)
  const [showNewPass, setShowNewPass] = useState(false)

  useEffect(() => {
    getCurrentUser()
      .then(setUserInfo)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword) return
    if (newPassword !== confirmPassword) {
      setResult('error')
      setErrorMsg(t('users.passwordMismatch'))
      return
    }
    if (newPassword.length < 6) {
      setResult('error')
      setErrorMsg('密码至少需要 6 个字符')
      return
    }
    setSaving(true)
    setResult(null)
    try {
      await changePassword(oldPassword, newPassword)
      setResult('success')
      setOldPassword(''); setNewPassword(''); setConfirmPassword('')
    } catch {
      setResult('error')
      setErrorMsg(t('users.passwordFailed'))
    } finally { setSaving(false) }
  }

  if (loading) {
    return (
      <main className="flex-1 overflow-y-auto flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
          <span className="text-sm text-textMuted">加载用户信息...</span>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 space-y-6">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg md:text-xl font-bold text-textPrimary flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-accent/15 flex items-center justify-center">
              <Users className="w-4.5 h-4.5 text-accent" />
            </div>
            {t('users.title')}
          </h2>
          <p className="text-xs text-textMuted mt-1 ml-10">管理账户与安全设置</p>
        </div>
        {userInfo?.configured && (
          <span className="text-xs px-3 py-1.5 rounded-full bg-running/10 text-running border border-running/20 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-running animate-pulse" />
            {t('users.systemInitialized')}
          </span>
        )}
      </div>

      {/* 统计小卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: Shield, label: t('users.role'), value: t('users.admin'), c: 'from-amber-500/20 to-amber-500/5', ic: 'text-amber-400' },
          { icon: Monitor, label: 'Hostname', value: systemInfo?.hostname || '-', c: 'from-blue-500/20 to-blue-500/5', ic: 'text-blue-400' },
          { icon: Cpu, label: t('settings.arch'), value: systemInfo?.arch || '-', c: 'from-purple-500/20 to-purple-500/5', ic: 'text-purple-400' },
          { icon: Clock, label: t('settings.uptime'), value: systemInfo?.uptime || '-', c: 'from-emerald-500/20 to-emerald-500/5', ic: 'text-emerald-400' },
        ].map((item, i) => (
          <div key={i}
            className="relative overflow-hidden rounded-xl bg-surface border border-border/50 p-4 hover:border-accent/30 transition-all duration-300 group">
            <div className={`absolute -top-6 -right-6 w-16 h-16 rounded-full bg-gradient-to-br ${item.c} opacity-50 group-hover:scale-150 transition-transform duration-500`} />
            <div className="relative">
              <item.icon className={`w-4 h-4 ${item.ic} mb-2`} />
              <p className="text-sm font-bold text-textPrimary truncate">{item.value}</p>
              <p className="text-[11px] text-textMuted mt-0.5">{item.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* 左侧：用户信息卡片 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 个人信息 */}
          <div className="bg-surface border border-border/50 rounded-2xl overflow-hidden">
            {/* 卡片头部渐变 */}
            <div className="h-20 bg-gradient-to-r from-accent/30 via-accent/15 to-purple-500/10 relative">
              <div className="absolute -bottom-8 left-6">
                <div className="w-16 h-16 rounded-2xl bg-surface border-4 border-surface shadow-xl flex items-center justify-center">
                  <User className="w-8 h-8 text-accent" />
                </div>
              </div>
            </div>
            <div className="pt-10 pb-5 px-6">
              <h3 className="text-base font-bold text-textPrimary">{userInfo?.username || 'admin'}</h3>
              <p className="text-xs text-textMuted mt-1 flex items-center gap-1">
                <Shield className="w-3 h-3 text-amber-400" />{t('users.admin')}
                <span className="mx-2 text-border">·</span>
                <Monitor className="w-3 h-3" />{t('users.singleUser')}
              </p>
            </div>
          </div>

          {/* 系统信息 */}
          <div className="bg-surface border border-border/50 rounded-2xl p-5">
            <h4 className="text-xs font-semibold text-textPrimary uppercase tracking-wider mb-3 flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-accent" />
              系统信息
            </h4>
            <div className="space-y-2.5">
              {[
                [t('settings.hostname'), systemInfo?.hostname],
                [t('settings.kernel'), systemInfo?.kernel],
                [t('settings.memory'), systemInfo?.memoryGB ? `${systemInfo.memoryGB.toFixed(1)} GB` : '-'],
                [t('settings.cpus'), systemInfo?.cpus ? `${systemInfo.cpus} ${t('containers.detail_core')}` : '-'],
                [t('settings.cgroupDriver'), systemInfo?.cgroupDriver],
              ].map(([label, value], i) => (
                <div key={i} className="flex justify-between items-center text-xs">
                  <span className="text-textMuted">{label}</span>
                  <span className="text-textPrimary font-mono font-medium truncate max-w-[140px]">{value || '-'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧：安全设置 */}
        <div className="lg:col-span-3 space-y-6">
          {/* 安全提示 */}
          <div className="bg-gradient-to-r from-warning/10 to-transparent border border-warning/20 rounded-2xl p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-warning/15 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4.5 h-4.5 text-warning" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-textPrimary">{t('users.security')}</h4>
              <p className="text-xs text-textSecondary mt-0.5 leading-relaxed">{t('users.securityTip')}</p>
            </div>
          </div>

          {/* 密码修改 */}
          <div className="bg-surface border border-border/50 rounded-2xl p-6">
            <h3 className="text-sm font-bold text-textPrimary mb-5 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                <Key className="w-3.5 h-3.5 text-accent" />
              </div>
              {t('users.changePassword')}
            </h3>
            <div className="space-y-4 max-w-lg">
              <div>
                <label className="text-xs font-medium text-textSecondary block mb-1.5">{t('users.oldPassword')}</label>
                <div className="relative">
                  <input type={showOldPass ? 'text' : 'password'} value={oldPassword}
                    onChange={e => setOldPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full bg-panel border border-border rounded-xl px-4 py-3 text-sm text-textPrimary placeholder:text-textMuted/50 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/10 transition-all" />
                  <button onClick={() => setShowOldPass(!showOldPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-textPrimary transition-colors">
                    {showOldPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-textSecondary block mb-1.5">{t('users.newPassword')}</label>
                <div className="relative">
                  <input type={showNewPass ? 'text' : 'password'} value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="••••••"
                    className="w-full bg-panel border border-border rounded-xl px-4 py-3 text-sm text-textPrimary placeholder:text-textMuted/50 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/10 transition-all" />
                  <button onClick={() => setShowNewPass(!showNewPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-textPrimary transition-colors">
                    {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {/* 密码强度指示 */}
                {newPassword && (
                  <div className="mt-2 flex gap-1">
                    {[1, 2, 3, 4].map(i => {
                      const threshold = i * 3
                      const filled = newPassword.length >= threshold
                      let bg = 'bg-border/30'
                      if (filled && i <= 2) bg = 'bg-error/50'
                      else if (filled && i <= 3) bg = 'bg-warning/50'
                      else if (filled) bg = 'bg-running/50'
                      return <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${bg}`} />
                    })}
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-textSecondary block mb-1.5">{t('users.confirmPassword')}</label>
                <input type="password" value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••"
                  className="w-full bg-panel border border-border rounded-xl px-4 py-3 text-sm text-textPrimary placeholder:text-textMuted/50 outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/10 transition-all" />
              </div>

              {result === 'error' && (
                <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-xl animate-shake">
                  <XCircle className="w-4 h-4 text-error shrink-0" />
                  <p className="text-xs text-error">{errorMsg}</p>
                </div>
              )}
              {result === 'success' && (
                <div className="flex items-center gap-2 p-3 bg-running/10 border border-running/20 rounded-xl">
                  <CheckCircle2 className="w-4 h-4 text-running shrink-0" />
                  <p className="text-xs text-running">{t('users.passwordChanged')}</p>
                </div>
              )}

              <button onClick={handleChangePassword} disabled={!oldPassword || !newPassword || saving}
                className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accentDim disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium py-3 rounded-xl transition-all duration-200 active:scale-[0.98]">
                {saving ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />处理中...</>
                ) : (
                  <><Save className="w-4 h-4" />{t('users.savePassword')}</>
                )}
              </button>
            </div>
          </div>

          {/* 操作日志 */}
          <div className="bg-surface border border-border/50 rounded-2xl p-5">
            <h3 className="text-sm font-bold text-textPrimary mb-4 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                <Activity className="w-3.5 h-3.5 text-accent" />
              </div>
              {t('users.activityLog')}
            </h3>
            <div className="text-center py-8">
              <div className="w-12 h-12 rounded-2xl bg-panel mx-auto flex items-center justify-center mb-3">
                <Activity className="w-5 h-5 text-textMuted/40" />
              </div>
              <p className="text-xs text-textMuted">{t('users.noActivity')}</p>
              <p className="text-[10px] text-textMuted/50 mt-1">操作记录功能将在后续版本中开放</p>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
