import { useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Folder, FileText, File, ChevronDown, Plus, Upload, Pencil, Trash2, Download } from 'lucide-react'
import ContextMenu from './ContextMenu'
import type { ContextMenuItem } from './ContextMenu'

export interface FileNode {
  name: string
  isDir: boolean
  isFile: boolean
  size?: number
  mtime?: string
  children?: FileNode[]
  isLoading?: boolean
}

interface FileTreeProps {
  projectName: string
  files: { name: string; isDir: boolean; isFile: boolean; size?: number; mtime?: string }[]
  selectedPath: string | null
  subPath: string
  loading: boolean
  uploading: boolean
  onSelectFile: (fileName: string) => void
  onEnterDir: (dirName: string) => void
  onNavigate: (subPath: string) => void
  onNewFile: (dirPath: string) => void
  onNewFolder: (dirPath: string) => void
  onDelete: (path: string, isDir: boolean) => void
  onRename: (oldName: string) => void
  onDownload: (filePath: string) => void
  onUpload: (files: FileList) => void
}

export default function FileTree({
  projectName, files, selectedPath, subPath, loading, uploading,
  onSelectFile, onEnterDir, onNavigate, onNewFile, onNewFolder,
  onDelete, onRename, onDownload, onUpload,
}: FileTreeProps) {
  const { t } = useTranslation()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targetPath: string; targetIsDir: boolean } | null>(null)
  const [bgContextMenu, setBgContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounter = useRef(0)

  const curDirPath = subPath ? `${projectName}/${subPath}` : projectName

  const getFullPath = (name: string) => subPath ? `${projectName}/${subPath}/${name}` : `${projectName}/${name}`

  const handleContextMenu = useCallback((e: React.MouseEvent, name: string, isDir: boolean) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, targetPath: name, targetIsDir: isDir })
  }, [])

  const handleBgContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setBgContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
    setBgContextMenu(null)
  }, [])

  const buildContextItems = (): ContextMenuItem[] => {
    if (!contextMenu) return []
    const isDir = contextMenu.targetIsDir
    const fullPath = getFullPath(contextMenu.targetPath)
    const dirPath = subPath ? `${projectName}/${subPath}` : projectName

    const items: ContextMenuItem[] = [
      {
        label: isDir ? t('compose.openDir') : t('compose.openFile'),
        icon: isDir ? <FolderOpen className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />,
        onClick: () => {
          if (isDir) onEnterDir(contextMenu.targetPath)
          else onSelectFile(contextMenu.targetPath)
        },
      },
      { label: '', divider: true, onClick: () => {} },
      {
        label: t('compose.newFile'),
        icon: <Plus className="w-3.5 h-3.5" />,
        onClick: () => onNewFile(isDir ? fullPath : dirPath),
      },
      {
        label: t('compose.newFolder'),
        icon: <Folder className="w-3.5 h-3.5" />,
        onClick: () => onNewFolder(isDir ? fullPath : dirPath),
      },
      { label: '', divider: true, onClick: () => {} },
      {
        label: t('compose.rename'),
        icon: <Pencil className="w-3.5 h-3.5" />,
        onClick: () => onRename(fullPath),
      },
      { label: '', divider: true, onClick: () => {} },
    ]

    if (!isDir) {
      items.push({
        label: t('compose.download'),
        icon: <Download className="w-3.5 h-3.5" />,
        onClick: () => onDownload(fullPath),
      })
      items.push({ label: '', divider: true, onClick: () => {} })
    }

    items.push({
      label: t('compose.delete'),
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onClick: () => {
        const confirmed = isDir
          ? window.confirm(t('compose.confirmDeleteDir', { name: contextMenu.targetPath }))
          : window.confirm(t('compose.confirmDeleteFile', { name: contextMenu.targetPath }))
        if (confirmed) onDelete(fullPath, isDir)
      },
    })

    return items
  }

  // 拖拽上传处理
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    setIsDragOver(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragOver(false)
  }
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    dragCounter.current = 0
    if (e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files)
    }
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatTime = (iso: string): string => {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60000) return t('time.justNow')
    if (diff < 3600000) return t('time.minutesAgo', { count: Math.floor(diff / 60000) })
    if (diff < 86400000) return t('time.hoursAgo', { count: Math.floor(diff / 3600000) })
    return d.toLocaleDateString()
  }

  return (
    <div
      className="flex flex-col h-full"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* 拖拽覆盖层 */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-accent/10 border-2 border-dashed border-accent rounded-lg flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <Upload className="w-8 h-8 text-accent mx-auto mb-2" />
            <span className="text-sm text-accent font-medium">{t('compose.dropToUpload')}</span>
          </div>
        </div>
      )}

      {/* 当前目录标题 + 返回上级 */}
      <div className="flex items-center gap-1.5 px-3 py-2 text-xs border-b border-border/50 shrink-0">
        <FolderOpen className="w-3.5 h-3.5 text-warning shrink-0" />
        <span className="text-textPrimary font-medium truncate">
          {subPath ? subPath.split('/').pop() : projectName}
        </span>
        {subPath && (
          <button
            onClick={() => {
              const parts = subPath.split('/')
              parts.pop()
              onNavigate(parts.join('/'))
            }}
            className="ml-auto text-textMuted hover:text-textPrimary shrink-0"
            title={t('compose.backToParent')}
          >
            <ChevronDown className="w-3.5 h-3.5 rotate-180" />
          </button>
        )}
      </div>

      {/* 快捷操作栏 - 图标模式 */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onNewFile(subPath ? `${projectName}/${subPath}` : projectName)}
            className="p-1.5 text-textMuted hover:text-accent hover:bg-accent/10 rounded transition-colors"
            title={t('compose.newFile')}
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={() => onNewFolder(subPath ? `${projectName}/${subPath}` : projectName)}
            className="p-1.5 text-textMuted hover:text-warning hover:bg-warning/10 rounded transition-colors"
            title={t('compose.newFolder')}
          >
            <Folder className="w-4 h-4" />
          </button>
        </div>
        <label 
          className="p-1.5 text-textMuted hover:text-running hover:bg-running/10 rounded transition-colors cursor-pointer"
          title={uploading ? t('compose.uploading') : t('compose.upload')}
        >
          <Upload className={`w-4 h-4 ${uploading ? 'animate-pulse' : ''}`} />
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files?.length) onUpload(e.target.files); e.target.value = '' }}
          />
        </label>
      </div>

      {/* 文件列表 */}
      <div className="flex-1 overflow-y-auto" onContextMenu={handleBgContextMenu}>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-textMuted text-xs">{t('compose.loadingFiles')}</div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-textMuted">
            <FileText className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">{t('compose.emptyDir')}</p>
            <p className="text-xs mt-1 opacity-60">{t('compose.emptyDirHint')}</p>
          </div>
        ) : (
          files.map(f => {
            const fullPath = getFullPath(f.name)
            const isSelected = selectedPath === fullPath
            return (
              <div
                key={f.name}
                className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-accent/15 text-accent'
                    : 'text-textSecondary hover:bg-border/20'
                }`}
                onClick={() => {
                  if (f.isDir) {
                    onEnterDir(f.name)
                  } else {
                    onSelectFile(f.name)
                  }
                }}
                onContextMenu={(e) => handleContextMenu(e, f.name, f.isDir)}
              >

                {/* 图标 */}
                {f.isDir
                  ? (isSelected ? <FolderOpen className="w-4 h-4 text-warning shrink-0" /> : <Folder className="w-4 h-4 text-warning shrink-0" />)
                  : (isSelected ? <FileText className="w-4 h-4 text-accent shrink-0" /> : <File className="w-4 h-4 text-textMuted shrink-0" />)
                }

                {/* 文件名 */}
                <span className={`truncate text-xs min-w-0 ${isSelected ? 'font-medium' : ''}`}>
                  {f.name}
                </span>

                {/* 文件元信息 */}
                {!f.isDir && (
                  <span className="hidden group-hover:inline text-[10px] text-textMuted ml-auto shrink-0">
                    {f.size !== undefined && formatSize(f.size)}
                    {f.mtime && <span className="ml-2">{formatTime(f.mtime)}</span>}
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 文件/文件夹右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextItems()}
          onClose={closeContextMenu}
        />
      )}

      {/* 空白区域右键菜单 */}
      {bgContextMenu && (
        <ContextMenu
          x={bgContextMenu.x}
          y={bgContextMenu.y}
          items={[
            {
              label: t('compose.newFile'),
              icon: <Plus className="w-3.5 h-3.5" />,
              onClick: () => onNewFile(curDirPath),
            },
            {
              label: t('compose.newFolder'),
              icon: <Folder className="w-3.5 h-3.5" />,
              onClick: () => onNewFolder(curDirPath),
            },
          ]}
          onClose={closeContextMenu}
        />
      )}
    </div>
  )
}
