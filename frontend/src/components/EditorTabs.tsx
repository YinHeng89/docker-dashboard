import { FileText, X, Circle } from 'lucide-react'

export interface EditorTab {
  fileName: string
  filePath: string
  content: string
  originalContent: string
}

interface EditorTabsProps {
  tabs: EditorTab[]
  activeTabPath: string | null
  onSelectTab: (filePath: string) => void
  onCloseTab: (filePath: string) => void
}

export default function EditorTabs({
  tabs, activeTabPath, onSelectTab, onCloseTab,
}: EditorTabsProps) {
  if (tabs.length === 0) return null

  return (
    <div className="flex items-center border-b border-border shrink-0 bg-surface overflow-x-auto overflow-y-hidden" style={{ height: 35 }}>
      <div className="flex items-center gap-0 min-w-0">
        {tabs.map(tab => {
          const isActive = tab.filePath === activeTabPath
          const hasChanges = tab.content !== tab.originalContent
          return (
            <div
              key={tab.filePath}
              onClick={() => onSelectTab(tab.filePath)}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onCloseTab(tab.filePath) } }}
              className={`group flex items-center gap-1.5 px-3 py-1 text-xs border-r border-border cursor-pointer transition-colors shrink-0 select-none ${
                isActive
                  ? 'bg-surface text-textPrimary border-b-2 border-b-accent -mb-[1px]'
                  : 'text-textMuted hover:text-textPrimary hover:bg-border/10'
              }`}
            >
              <FileText className="w-3 h-3 shrink-0" />
              <span className="max-w-[120px] truncate">{tab.fileName}</span>
              {hasChanges && (
                <Circle className="w-2 h-2 fill-current text-warning shrink-0" />
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.filePath) }}
                className={`shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-border/50 transition-colors ${
                  isActive ? 'visible' : 'invisible group-hover:visible'
                }`}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
