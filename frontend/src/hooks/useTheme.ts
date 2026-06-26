import { useState, useEffect, useCallback } from 'react'

export type Theme = 'dark' | 'light'

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return (localStorage.getItem('theme') as Theme) ?? 'dark'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') {
      root.classList.add('light')
    } else {
      root.classList.remove('light')
    }
    localStorage.setItem('theme', theme)
  }, [theme])

  // 监听跨组件主题变更事件
  useEffect(() => {
    const handler = () => setTheme(readTheme())
    window.addEventListener('theme-changed', handler)
    return () => window.removeEventListener('theme-changed', handler)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('theme', next)
      const root = document.documentElement
      if (next === 'light') root.classList.add('light')
      else root.classList.remove('light')
      // 通知其他 useTheme 实例
      window.dispatchEvent(new Event('theme-changed'))
      return next
    })
  }, [])

  const setThemeValue = useCallback((value: Theme) => {
    localStorage.setItem('theme', value)
    const root = document.documentElement
    if (value === 'light') root.classList.add('light')
    else root.classList.remove('light')
    window.dispatchEvent(new Event('theme-changed'))
    setTheme(value)
  }, [])

  return { theme, toggleTheme, setTheme: setThemeValue }
}
