import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Search, Plus, Play, X, Upload, Loader2, LayoutTemplate, ChevronLeft, FileText } from 'lucide-react'
import YamlEditor from './YamlEditor'

interface Template {
  id: number
  name: string
  description: string
  content: string
}

interface ToolbarProps {
  searchQuery: string
  onSearchChange: (q: string) => void
  onProjectCreated?: () => void
  hideSearch?: boolean
}

export default function Toolbar({ searchQuery, onSearchChange, onProjectCreated, hideSearch }: ToolbarProps) {
  const { t } = useTranslation()
  const [createOpen, setCreateOpen] = useState(false)
  const [composeContent, setComposeContent] = useState('')
  const [projectName, setProjectName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'error' } | null>(null)
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  // 模板相关状态
  const [templates, setTemplates] = useState<Template[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [showTemplateSelect, setShowTemplateSelect] = useState(false)

  // 打开创建弹窗时加载模板
  useEffect(() => {
    if (createOpen && templates.length === 0 && !templatesLoading) {
      setTemplatesLoading(true)
      fetch('/api/templates')
        .then(r => r.json())
        .then((data: Template[]) => setTemplates(data))
        .catch(() => {})
        .finally(() => setTemplatesLoading(false))
    }
  }, [createOpen])

  // ESC 关闭弹窗
  useEffect(() => {
    if (!createOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resetCreateModal()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [createOpen])

  // 选择模板
  const handleSelectTemplate = (tpl: Template) => {
    setSelectedTemplate(tpl)
    // 空白模板不填入内容，保持空文本框让用户自由编写
    setComposeContent(tpl.name === '空白模板' ? '' : tpl.content)
    setShowTemplateSelect(false)
    // 如果没有输入项目名，自动填入模板名（小写无空格）
    if (!projectName.trim()) {
      setProjectName(tpl.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
    }
  }

  const handleCreate = async (start: boolean) => {
    if (!projectName.trim() || !composeContent.trim()) {
      setCreateError('请填写项目名称和 Compose 内容')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const resp = await fetch('/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName.trim(), content: composeContent, start }),
      })
      const data = await resp.json()
      if (!resp.ok) {
        const msg = data.warnings?.length ? data.warnings.join('\n') : (data.error || '创建失败')
        setToast({ msg, type: 'error' })
        setCreating(false)
        return
      }
      if (data.composeError) {
        setToast({ msg: data.composeError, type: 'error' })
      }
      onProjectCreated?.()
      setCreateOpen(false)
      setProjectName('')
      setComposeContent('')
      setSelectedTemplate(null)
      setShowTemplateSelect(false)
    } catch (e: any) {
      setCreateError(e.message)
    } finally {
      setCreating(false)
    }
  }

  const resetCreateModal = () => {
    setCreateOpen(false)
    setProjectName('')
    setComposeContent('')
    setSelectedTemplate(null)
    setShowTemplateSelect(false)
    setCreateError(null)
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {/* 搜索框 */}
        {!hideSearch && (
          <div className="flex-1 min-w-[160px] flex items-center gap-2 bg-surface border border-border rounded px-3 py-2">
            <Search className="w-4 h-4 text-textMuted shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t('toolbar.searchPlaceholder')}
              className="bg-transparent text-sm outline-none flex-1 min-w-0 text-textPrimary placeholder:text-textMuted"
            />
          </div>
        )}

        {/* 创建容器 — 移动端仅显示 + 图标（正方形按钮） */}
        <button
          onClick={() => { setCreateOpen(true); setShowTemplateSelect(true) }}
          className="p-2 sm:px-4 sm:py-2 bg-accent text-white hover:bg-accentDim rounded-xl sm:rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap"
        >
          <Plus className="w-4 h-4 sm:w-3.5 sm:h-3.5 shrink-0" />
          <span className="hidden sm:inline">{t('toolbar.createContainer')}</span>
        </button>
      </div>

      {/* Toast */}
      {toast && createPortal(
        <div className="fixed top-12 right-4 z-[99999] px-5 py-3.5 rounded-lg shadow-xl text-sm max-w-3xl bg-error/90 border border-error/40 text-white whitespace-pre-wrap backdrop-blur-sm">
          {toast.msg}
        </div>,
        document.body
      )}

      {/* 创建容器弹窗 — Portal 到 body 确保完整覆盖 */}
      {createOpen && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
          <div
            className="bg-surface border border-border rounded-lg shadow-2xl w-[750px] max-w-[95vw] max-h-[88vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                {showTemplateSelect ? (
                  <LayoutTemplate className="w-4 h-4 text-accent" />
                ) : (
                  <FileText className="w-4 h-4 text-accent" />
                )}
                <h3 className="text-base font-semibold text-textPrimary">
                  {showTemplateSelect ? t('toolbar.selectTemplate') : selectedTemplate ? t('toolbar.editTemplate', { name: selectedTemplate.name }) : t('toolbar.createComposeProject')}
                </h3>
              </div>
              <button onClick={resetCreateModal}
                className="p-1 rounded hover:bg-border/50 text-textMuted hover:text-textPrimary transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 第一步：选择模板 */}
            {showTemplateSelect && (
              <div className="flex-1 overflow-auto p-4">
                {templatesLoading ? (
                  <div className="flex items-center justify-center py-12 text-textMuted">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    {t('toolbar.loadingTemplates')}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {templates.map(tpl => (
                      <button
                        key={tpl.id}
                        onClick={() => handleSelectTemplate(tpl)}
                        className="text-left bg-panel border border-border rounded-lg p-4 hover:border-accent/50 hover:bg-accent/5 transition-all group"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <LayoutTemplate className="w-4 h-4 text-accent shrink-0" />
                          <span className="text-sm font-semibold text-textPrimary group-hover:text-accent transition-colors">{tpl.name}</span>
                        </div>
                        <p className="text-xs text-textMuted leading-relaxed">{tpl.description}</p>
                        <pre className="mt-2 text-xs text-textSecondary font-mono bg-surface/50 rounded p-2 max-h-24 overflow-hidden opacity-60 group-hover:opacity-100 transition-opacity whitespace-pre-wrap line-clamp-4">
                          {tpl.content.slice(0, 200)}
                        </pre>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 第二步：编辑配置 */}
            {!showTemplateSelect && (
              <div className="flex-1 p-4 flex flex-col gap-4 min-h-0">
                {/* 返回选模板 */}
                <button
                  onClick={() => setShowTemplateSelect(true)}
                  className="flex items-center gap-1 text-xs text-textMuted hover:text-accent transition-colors shrink-0"
                >
                  <ChevronLeft className="w-3 h-3" />
                  {t('toolbar.reselectTemplate')}
                </button>

                <div className="shrink-0">
                  <label className="block text-sm font-medium text-textPrimary mb-1">{t('toolbar.projectName')}</label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    placeholder={t('toolbar.projectNameExample')}
                    className="w-full bg-panel border border-border rounded px-3 py-2 text-sm text-textPrimary placeholder:text-textMuted outline-none focus:border-accent transition-colors"
                    autoFocus
                  />
                </div>

                <div className="flex-1 min-h-0 flex flex-col">
                  <label className="block text-sm font-medium text-textPrimary mb-1 shrink-0">{t('toolbar.composeFile')}</label>
                  <YamlEditor
                    value={composeContent}
                    onChange={setComposeContent}
                    placeholder={`services:
  app:
    image: nginx:alpine
    ports:
      - "8080:80"
    restart: unless-stopped`}
                    rows={14}
                  />
                </div>

                {createError && (
                  <div className="text-sm text-error bg-error/5 border border-error/20 rounded p-2 shrink-0">{createError}</div>
                )}

                <div className="text-xs text-textMuted shrink-0">
                  提示：项目将创建在 <code className="text-accent bg-accent/10 px-1 rounded">/projects/{projectName || '...'}</code> 目录下。
                  「创建并启动」会自动执行 <code className="text-accent bg-accent/10 px-1 rounded">docker compose up -d</code>。
                </div>
              </div>
            )}

            {/* 底部按钮 */}
            {!showTemplateSelect && (
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border shrink-0">
                <button onClick={resetCreateModal}
                  className="action-btn action-btn-ghost">
                  {t('toolbar.cancel')}
                </button>
                <button onClick={() => handleCreate(false)}
                  disabled={creating}
                  className="action-btn action-btn-ghost flex items-center gap-1.5 border border-border">
                  {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {t('toolbar.createOnly')}
                </button>
                <button onClick={() => handleCreate(true)}
                  disabled={creating}
                  className="action-btn action-btn-primary flex items-center gap-1.5">
                  {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  {t('toolbar.createAndStart')}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
