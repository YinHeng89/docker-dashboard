import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { checkAuthStatus, login, setupPassword } from '../api/auth'
import { useTheme } from '../hooks/useTheme'
import LangToggle from '../components/LangToggle'
import ThemeToggle from '../components/ThemeToggle'

export default function LoginPage() {
  const { t, i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()

  const [isSetup, setIsSetup] = useState(false)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isZh = (i18n.language || '').startsWith('zh')
  const isDark = theme === 'dark'

  useEffect(() => {
    checkAuthStatus()
      .then(res => setIsSetup(!res.initialized))
      .catch(() => setIsSetup(false))
      .finally(() => setChecking(false))
  }, [])

  const toggleLang = () => i18n.changeLanguage(isZh ? 'en' : 'zh')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!password || password.length < 6) {
      setError(isSetup ? t('login.passwordMinLength') : t('login.enterPassword'))
      return
    }
    if (isSetup && password !== confirm) {
      setError(t('login.passwordMismatch'))
      return
    }
    setSubmitting(true)
    try {
      if (isSetup) await setupPassword(password)
      else await login(password)
      navigate('/', { replace: true })
    } catch (err: any) {
      const errMsg = err.response?.data?.error || ''
      // 映射服务端中文错误到翻译 key
      const errorMap: Record<string, string> = {
        '密码错误': t('login.wrongPassword'),
        '旧密码错误': t('login.oldPasswordWrong'),
      }
      setError(errorMap[errMsg] || errMsg || t('login.operationFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-panel">
        <div className="text-textMuted text-sm">{t('login.checking')}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-panel p-5">
      <div className="bg-surface rounded-2xl shadow-lg w-full max-w-[400px] p-10 pb-7">
        {/* Logo */}
        <div className="text-center mb-4">
          <svg className="w-12 h-12 mx-auto mb-3 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <h1 className="text-[22px] font-bold tracking-tight text-textPrimary">Docker Dashboard</h1>
        </div>

        <div className="text-sm text-textMuted mb-5 text-center leading-relaxed">
          {isSetup ? t('login.setupHint') : t('login.loginHint')}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-[13px] font-semibold text-textMuted mb-1.5">
              {isSetup ? t('login.setPassword') : t('login.password')}
            </label>
            <input
              type="password"
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              placeholder={isSetup ? t('login.passwordMinLength') : t('login.enterPassword')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full py-3 px-3.5 border border-border rounded-[10px] text-[15px]
                         outline-none bg-panel text-textPrimary
                         focus:border-accent focus:bg-surface transition-colors"
            />
          </div>

          {isSetup && (
            <div className="mb-4">
              <label className="block text-[13px] font-semibold text-textMuted mb-1.5">{t('login.confirmPassword')}</label>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={t('login.confirmPasswordPlaceholder')}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="w-full py-3 px-3.5 border border-border rounded-[10px] text-[15px]
                           outline-none bg-panel text-textPrimary
                           focus:border-accent focus:bg-surface transition-colors"
              />
            </div>
          )}

          {error && <div className="text-error text-[13px] mb-3 min-h-[20px]">{error}</div>}
          {!error && <div className="mb-3 min-h-[20px]" />}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 bg-accent text-white rounded-[10px] text-[15px] font-semibold
                       hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
          >
            {isSetup ? t('login.setupAndEnter') : t('login.login')}
          </button>
        </form>

        {/* 底部滑块 */}
        <div className="flex items-center justify-center gap-6 mt-5 pt-4 border-t border-border">
          <LangToggle
            on={!isZh} onToggle={toggleLang}
            leftLabel={t('header.langLabelZh')} rightLabel={t('header.langLabelEn')}
          />
          <ThemeToggle
            on={isDark} onToggle={toggleTheme}
            leftLabel={t('header.lightLabel')} rightLabel={t('header.darkLabel')}
          />
        </div>
      </div>
    </div>
  )
}
