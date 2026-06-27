import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Save, RefreshCw, Play, Square, Loader2, Upload, Search, XCircle, X, Check } from 'lucide-react'
import YamlEditor from './YamlEditor'
import FileTree from './FileTree'
import EditorTabs from './EditorTabs'
import type { EditorTab } from './EditorTabs'

interface FileEntry {
  name: string
  isDir: boolean
  isFile: boolean
  size?: number
  mtime?: string
}

export interface ProjectFileManagerProps {
  projectName: string
  /** Called when user wants to navigate back (e.g., ← button) */
  onBack?: () => void
  /** Extra content for the left side of the toolbar (e.g., breadcrumb path) */
  toolbarLeft?: React.ReactNode
  /** Called when a compose action button is clicked */
  onComposeAction?: (action: string) => void
  /** Currently loading compose action */
  composeActionLoading?: string | null
  /** Minimal mode hides search and compose buttons (for modal usage) */
  minimal?: boolean
}

export default function ProjectFileManager({
  projectName, onBack, toolbarLeft, onComposeAction, composeActionLoading, minimal = false,
}: ProjectFileManagerProps) {
  const { t } = useTranslation()
  const API_BASE = ''

  // --- File list state ---
  const [projectFiles, setProjectFiles] = useState<FileEntry[]>([])
  const [filesSubPath, setFilesSubPath] = useState('')
  const [filesLoading, setFilesLoading] = useState(false)

  // --- Editor tabs ---
  const [openTabs, setOpenTabs] = useState<EditorTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)

  // --- Editor state ---
  const [fileContent, setFileContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [currentEditingFile, setCurrentEditingFile] = useState<string | null>(null)
  const [currentEditingPath, setCurrentEditingPath] = useState<string | null>(null)

  // --- States ---
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // --- Rename/new dialog ---
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameMode, setRenameMode] = useState<'rename' | 'newFile' | 'newFolder'>('rename')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // --- Search ---
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ file: string; line: number; content: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [showSearch, setShowSearch] = useState(false)

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }, [])

  // ==================== API: Load directory ====================

  const loadDir = useCallback(async (subPath: string = '') => {
    setFilesLoading(true)
    try {
      const pathQuery = subPath ? `${projectName}/${subPath}` : projectName
      const res = await fetch(`${API_BASE}/files?path=${pathQuery}`)
      const data = await res.json()
      setProjectFiles((data.entries || []) as FileEntry[])
      setFilesSubPath(subPath)
    } catch {
      showToast(t('compose.loadFilesFailed'), 'error')
    } finally {
      setFilesLoading(false)
    }
  }, [projectName, showToast])

  // Load on mount & when projectName changes
  useEffect(() => {
    setOpenTabs([])
    setActiveTabPath(null)
    setCurrentEditingFile(null)
    setCurrentEditingPath(null)
    setFileContent('')
    setOriginalContent('')
    loadDir('')
  }, [projectName, loadDir])

  // ==================== Tab Management ====================

  const openTab = useCallback(async (displayName: string, fullPath: string) => {
    const existing = openTabs.find(t => t.filePath === fullPath)
    if (existing) {
      setActiveTabPath(fullPath)
      setCurrentEditingFile(existing.fileName)
      setCurrentEditingPath(existing.filePath)
      setFileContent(existing.content)
      setOriginalContent(existing.originalContent)
      return
    }
    try {
      const res = await fetch(`${API_BASE}/files/${fullPath}`)
      const data = await res.json()
      if (data.type === 'directory') return
      // 拒绝大于 3MB 的文件
      if (data.size > 3 * 1024 * 1024) {
        showToast(t('compose.fileTooLarge'), 'error')
        return
      }
      const content = data.content as string
      const newTab: EditorTab = { fileName: displayName, filePath: fullPath, content, originalContent: content }
      setOpenTabs(prev => [...prev, newTab])
      setActiveTabPath(fullPath)
      setCurrentEditingFile(displayName)
      setCurrentEditingPath(fullPath)
      setFileContent(content)
      setOriginalContent(content)
    } catch {
      showToast(t('compose.readFileFailed'), 'error')
    }
  }, [openTabs, showToast])

  const closeTab = useCallback((filePath: string) => {
    // Compute new tabs synchronously
    const saved = openTabs.map(t =>
      (t.filePath === filePath && t.filePath === currentEditingPath && fileContent !== originalContent)
        ? { ...t, content: fileContent } : t
    )
    const newTabs = saved.filter(t => t.filePath !== filePath)
    setOpenTabs(newTabs)

    if (filePath === activeTabPath) {
      if (newTabs.length === 0) {
        setActiveTabPath(null); setCurrentEditingFile(null)
        setCurrentEditingPath(null); setFileContent(''); setOriginalContent('')
      } else {
        const nt = newTabs[0]!
        setActiveTabPath(nt.filePath); setCurrentEditingFile(nt.fileName)
        setCurrentEditingPath(nt.filePath); setFileContent(nt.content);
        setOriginalContent(nt.originalContent)
      }
    }
  }, [activeTabPath, currentEditingPath, fileContent, originalContent, openTabs])

  const selectTab = useCallback((filePath: string) => {
    const tab = openTabs.find(t => t.filePath === filePath)
    if (!tab) return
    if (currentEditingPath && currentEditingPath !== filePath) {
      setOpenTabs(prev => prev.map(t =>
        t.filePath === currentEditingPath ? { ...t, content: fileContent } : t
      ))
    }
    setActiveTabPath(filePath); setCurrentEditingFile(tab.fileName)
    setCurrentEditingPath(tab.filePath); setFileContent(tab.content)
    setOriginalContent(tab.originalContent)
  }, [openTabs, currentEditingPath, fileContent])

  // ==================== File Operations ====================

  const handleSelectFile = useCallback((fileName: string) => {
    const fullPath = filesSubPath
      ? `${projectName}/${filesSubPath}/${fileName}`
      : `${projectName}/${fileName}`
    openTab(fileName, fullPath)
  }, [projectName, filesSubPath, openTab])

  const handleEnterDir = useCallback((dirName: string) => {
    const newPath = filesSubPath ? `${filesSubPath}/${dirName}` : dirName
    setRenameTarget(null)
    loadDir(newPath)
  }, [filesSubPath, loadDir])

  const handleNavigate = useCallback((subPath: string) => {
    setRenameTarget(null)
    loadDir(subPath)
  }, [loadDir])

  const saveFile = useCallback(async () => {
    if (!currentEditingPath) return
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/files/${currentEditingPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fileContent }),
      })
      if (!res.ok) throw new Error(t('compose.saveFailed'))
      setOriginalContent(fileContent)
      setOpenTabs(prev => prev.map(t =>
        t.filePath === currentEditingPath ? { ...t, content: fileContent, originalContent: fileContent } : t
      ))
      showToast(t('compose.saved'))
      loadDir(filesSubPath)
    } catch (e: any) {
      showToast(e.message || t('compose.saveFailed'), 'error')
    } finally { setSaving(false) }
  }, [currentEditingPath, fileContent, filesSubPath, showToast, loadDir])

  const handleUpload = useCallback(async (fileList: FileList) => {
    setUploading(true)
    try {
      const formData = new FormData()
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i]
        if (file) formData.append('files', file)
      }
      const dirPath = filesSubPath ? `${projectName}/${filesSubPath}` : projectName
      const res = await fetch(`${API_BASE}/files/upload?path=${dirPath}`, { method: 'POST', body: formData })
      const data = await res.json()
      if (data.success) {
        showToast(t('compose.uploadSuccess', { count: data.files?.length || fileList.length }))
        loadDir(filesSubPath)
      } else {
        showToast(data.error || t('compose.uploadFailed'), 'error')
      }
    } catch (e: any) {
      showToast(e.message || t('compose.uploadFailed'), 'error')
    } finally { setUploading(false) }
  }, [projectName, filesSubPath, showToast, loadDir])

  const handleNewFile = useCallback((dirPath: string) => {
    if (currentEditingPath && fileContent !== originalContent) {
      setOpenTabs(prev => prev.map(t =>
        t.filePath === currentEditingPath ? { ...t, content: fileContent } : t
      ))
    }
    setRenameMode('newFile'); setRenameTarget(dirPath); setRenameValue('')
    setTimeout(() => renameInputRef.current?.focus(), 50)
  }, [currentEditingPath, fileContent, originalContent])

  const handleNewFolder = useCallback((dirPath: string) => {
    setRenameMode('newFolder'); setRenameTarget(dirPath); setRenameValue('')
    setTimeout(() => renameInputRef.current?.focus(), 50)
  }, [])

  const handleRename = useCallback((fullPath: string) => {
    const name = fullPath.split('/').pop() || ''
    setRenameMode('rename'); setRenameTarget(fullPath); setRenameValue(name)
    setTimeout(() => renameInputRef.current?.focus(), 50)
  }, [])

  const handleDelete = useCallback(async (fullPath: string, _isDir: boolean) => {
    try {
      const res = await fetch(`${API_BASE}/files/${fullPath}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        showToast(t('compose.deleteSuccess'))
        setOpenTabs(prev => prev.filter(t => t.filePath !== fullPath))
        if (currentEditingPath === fullPath) {
          setCurrentEditingFile(null); setCurrentEditingPath(null)
          setFileContent(''); setOriginalContent(''); setActiveTabPath(null)
        }
        loadDir(filesSubPath)
      } else {
        showToast(data.error || t('compose.deleteFailed'), 'error')
      }
    } catch (e: any) { showToast(e.message || t('compose.deleteFailed'), 'error') }
  }, [filesSubPath, currentEditingPath, showToast, loadDir])

  const handleDownload = useCallback((filePath: string) => {
    const a = document.createElement('a')
    a.href = `${API_BASE}/files/download/${encodeURIComponent(filePath)}`
    a.download = filePath.split('/').pop() || 'file'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }, [])

  const handleRenameConfirm = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) return
    try {
      if (renameMode === 'newFile') {
        const fp = `${renameTarget}/${renameValue.trim()}`
        const res = await fetch(`${API_BASE}/files/${fp}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '' }),
        })
        const data = await res.json()
        if (data.success) { showToast(t('compose.fileCreated')); loadDir(filesSubPath); openTab(renameValue.trim(), fp) }
        else showToast(data.error || t('compose.createFailed'), 'error')
      } else if (renameMode === 'newFolder') {
        const dp = `${renameTarget}/${renameValue.trim()}`
        const res = await fetch(`${API_BASE}/files/mkdir`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: dp }),
        })
        const data = await res.json()
        if (data.success) { showToast(t('compose.folderCreated')); loadDir(filesSubPath) }
        else showToast(data.error || t('compose.createFailed'), 'error')
      } else {
        const dir = renameTarget.split('/').slice(0, -1).join('/')
        const np = `${dir}/${renameValue.trim()}`
        const res = await fetch(`${API_BASE}/files/rename`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPath: renameTarget, newPath: np }),
        })
        const data = await res.json()
        if (data.success) {
          showToast(t('compose.renameSuccess'))
          setOpenTabs(prev => prev.map(t =>
            t.filePath === renameTarget ? { ...t, fileName: renameValue.trim(), filePath: np } : t
          ))
          if (currentEditingPath === renameTarget) {
            setCurrentEditingPath(np); setCurrentEditingFile(renameValue.trim()); setActiveTabPath(np)
          }
          loadDir(filesSubPath)
        } else showToast(data.error || t('compose.renameFailed'), 'error')
      }
    } catch (e: any) { showToast(e.message || t('compose.operationFailed'), 'error') }
    setRenameTarget(null)
  }, [renameTarget, renameValue, renameMode, filesSubPath, showToast, loadDir, openTab, currentEditingPath])

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) return
    setSearching(true); setShowSearch(true)
    try {
      const res = await fetch(`${API_BASE}/files/search?path=${projectName}&query=${encodeURIComponent(searchQuery.trim())}`)
      const data = await res.json()
      setSearchResults(data.results || [])
    } catch { showToast(t('compose.searchFailed'), 'error') }
    finally { setSearching(false) }
  }, [projectName, searchQuery, showToast])

  // ==================== Keyboard Shortcuts ====================

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (currentEditingPath) saveFile()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault(); setShowSearch(true); return
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault(); setShowSearch(true); return
      }
      if (e.key === 'Escape' && renameTarget) { setRenameTarget(null); return }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [currentEditingPath, saveFile, renameTarget])

  // ==================== Derived ====================

  const hasChanges = fileContent !== originalContent

  // ==================== Render ====================

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-in fade-in ${
          toast.type === 'success' ? 'bg-running/20 border border-running/30 text-running' : 'bg-error/20 border border-error/30 text-error'
        }`}>{toast.msg}</div>
      )}

      {/* Top Toolbar (only in non-minimal mode) */}
      {!minimal && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {onBack && (
              <button onClick={onBack} className="flex items-center gap-1 text-sm text-textMuted hover:text-textPrimary transition-colors shrink-0">
                <Play className="w-4 h-4 rotate-180" />
              </button>
            )}
            {toolbarLeft || <span className="text-sm font-semibold text-textPrimary truncate">{projectName}</span>}
            {openTabs.length > 0 && (
              <span className="text-xs text-textMuted shrink-0">({t('compose.tabsCount', { count: openTabs.length })})</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Search */}
            {showSearch ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearch(); if (e.key === 'Escape') setShowSearch(false) }}
                  placeholder={t('compose.searchPlaceholder')}
                  className="text-xs bg-surface border border-border rounded px-2 py-1 w-48 outline-none focus:border-accent text-textPrimary"
                />
                <button onClick={handleSearch} disabled={searching || searchQuery.trim().length < 2}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors"
                >{searching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}</button>
                <button onClick={() => { setShowSearch(false); setSearchResults([]); setSearchQuery('') }}
                  className="px-1 py-1 text-xs text-textMuted hover:text-textPrimary"><XCircle className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button onClick={() => setShowSearch(true)} className="flex items-center gap-1 px-2 py-1 text-xs text-textMuted hover:text-textPrimary rounded transition-colors" title="Ctrl+Shift+F">
                <Search className="w-3 h-3" />
              </button>
            )}

            {/* Compose actions */}
            {onComposeAction && (
              <>
                <button onClick={() => onComposeAction('up')} disabled={composeActionLoading === 'up'}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-accent/10 text-accent hover:bg-accent/20 rounded transition-colors disabled:opacity-50"
                >{composeActionLoading === 'up' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}{t('compose.up')}</button>
                <button onClick={() => onComposeAction('down')} disabled={composeActionLoading === 'down'}
                  className="flex items-center gap-1 px-2 py-1 text-xs border border-border text-warning hover:bg-warning/10 rounded transition-colors disabled:opacity-50"
                >{composeActionLoading === 'down' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}{t('compose.down')}</button>
                <button onClick={() => onComposeAction('restart')} disabled={composeActionLoading === 'restart'}
                  className="flex items-center gap-1 px-2 py-1 text-xs border border-border hover:bg-border/20 rounded transition-colors disabled:opacity-50"
                >{composeActionLoading === 'restart' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}{t('compose.restart')}</button>
                <button onClick={() => onComposeAction('pull')} disabled={composeActionLoading === 'pull'}
                  className="flex items-center gap-1 px-2 py-1 text-xs border border-border hover:bg-border/20 rounded transition-colors disabled:opacity-50"
                >{composeActionLoading === 'pull' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}{t('compose.pull')}</button>
                <button onClick={() => onComposeAction('rebuild')} disabled={composeActionLoading === 'rebuild'}
                  className="flex items-center gap-1 px-2 py-1 text-xs border border-border hover:bg-border/20 rounded transition-colors disabled:opacity-50"
                >{composeActionLoading === 'rebuild' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}{t('compose.rebuild')}</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Search Results */}
      {showSearch && searchResults.length > 0 && (
        <div className="border-b border-border bg-surface max-h-[200px] overflow-y-auto shrink-0">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
            <span className="text-xs text-textMuted">{t('compose.searchResults', { count: searchResults.length })}</span>
            <button onClick={() => { setSearchResults([]); setSearchQuery(''); setShowSearch(false) }}
              className="text-xs text-textMuted hover:text-textPrimary">✕</button>
          </div>
          {searchResults.map((r, i) => (
            <div key={i}
              onClick={() => openTab(r.file, `${projectName}/${r.file}`)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-border/20 transition-colors"
            >
              <FileText className="w-3 h-3 text-accent shrink-0" />
              <span className="font-mono text-textPrimary truncate">{r.file}</span>
              <span className="text-textMuted shrink-0">:{r.line}</span>
              <span className="text-textMuted truncate">- {r.content}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main Content: FileTree + Editor */}
      <div className={`flex-1 flex overflow-hidden bg-surface ${minimal ? '' : 'rounded-lg border border-border m-3'}`}>
        {/* Left: FileTree */}
        <div className="w-52 shrink-0 border-r border-border bg-surface flex flex-col relative rounded-l-lg overflow-hidden">
          <FileTree
            projectName={projectName}
            files={projectFiles}
            selectedPath={currentEditingPath}
            subPath={filesSubPath}
            loading={filesLoading}
            uploading={uploading}
            onSelectFile={handleSelectFile}
            onEnterDir={handleEnterDir}
            onNavigate={handleNavigate}
            onNewFile={handleNewFile}
            onNewFolder={handleNewFolder}
            onDelete={handleDelete}
            onRename={handleRename}
            onDownload={handleDownload}
            onUpload={handleUpload}
          />
        </div>

        {/* Right: Editor Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <EditorTabs
            tabs={openTabs} activeTabPath={activeTabPath}
            onSelectTab={selectTab} onCloseTab={closeTab}
          />

          <div className="flex-1 flex flex-col overflow-hidden">
            {currentEditingFile ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between px-3 py-1.5 shrink-0 border-b border-border">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-accent shrink-0" />
                    <span className="text-sm text-textPrimary truncate">{currentEditingFile}</span>
                    {hasChanges && <span className="text-xs text-warning bg-warning/10 px-1.5 rounded shrink-0">{t('compose.unsaved')}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={saveFile} disabled={saving || !hasChanges}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs bg-accent/10 text-accent hover:bg-accent/20 rounded transition-colors disabled:opacity-40"
                    >{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}{t('compose.save')}</button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {currentEditingFile.endsWith('.yml') || currentEditingFile.endsWith('.yaml') ? (
                    <div className="h-full p-2">
                      <YamlEditor value={fileContent} onChange={setFileContent} rows={30} />
                    </div>
                  ) : (
                    <textarea value={fileContent} onChange={e => setFileContent(e.target.value)} spellCheck={false}
                      className="w-full h-full bg-panel border-0 px-3 py-2 text-sm font-mono text-textPrimary placeholder:text-textMuted outline-none resize-none leading-relaxed"
                    />
                  )}
                </div>
                <div className="flex items-center justify-between px-3 py-1 text-[11px] text-textMuted border-t border-border shrink-0">
                  <div className="flex items-center gap-3">
                    <span>{t('compose.lines', { count: fileContent.split('\n').length })}</span>
                    <span>UTF-8</span>
                    <span>{currentEditingFile.split('.').pop()?.toUpperCase() || 'Plain Text'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasChanges && <span>● {t('compose.modified')}</span>}
                    <span>{t('compose.ctrlS')}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-textMuted">
                <FileText className="w-12 h-12 mb-3 opacity-20" />
                <p className="text-sm">{t('compose.selectFile')}</p>
                <p className="text-xs mt-1 opacity-60">{t('compose.dragHint')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Rename/New Dialog */}
      {renameTarget && (
        <div className="fixed inset-0 z-[90] bg-black/20 flex items-center justify-center" onClick={() => setRenameTarget(null)}>
          <div className="bg-surface border border-border rounded-lg shadow-xl p-4 min-w-[320px]" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-textPrimary mb-3">
              {renameMode === 'newFile' ? t('compose.newFile') : renameMode === 'newFolder' ? t('compose.newFolder') : t('compose.rename')}
            </h3>
            <div className="flex items-center gap-2">
              <input ref={renameInputRef} value={renameValue} onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleRenameConfirm(); if (e.key === 'Escape') setRenameTarget(null) }}
                placeholder={renameMode === 'newFolder' ? t('compose.folderName') : t('compose.fileName')}
                className="flex-1 bg-panel border border-border rounded px-2 py-1.5 text-sm text-textPrimary outline-none focus:border-accent"
              />
              <button onClick={handleRenameConfirm} disabled={!renameValue.trim()}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent/80 disabled:opacity-40"
              ><Check className="w-3 h-3" /> {t('common.confirm')}</button>
              <button onClick={() => setRenameTarget(null)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs border border-border rounded hover:bg-border/20"
              ><X className="w-3 h-3" /> {t('common.cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
