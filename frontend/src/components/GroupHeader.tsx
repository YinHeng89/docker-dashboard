import { ChevronDown, ChevronRight, Box } from 'lucide-react'
import type { WorkspaceGroupedContainers } from '../types'

interface GroupHeaderProps {
  group: WorkspaceGroupedContainers
  collapsed: boolean
  onToggle: () => void
}

export default function GroupHeader({
  group,
  collapsed,
  onToggle,
}: GroupHeaderProps) {
  const total = group.projectGroups.length
  const running = group.projectGroups.filter(pg => pg.status === 'running').length
  const hasWarning = group.projectGroups.some(pg => pg.status === 'warning')
  const hasError = group.projectGroups.some(pg => pg.status === 'error')
  const allRunning = running === total && !hasError && !hasWarning
  const someRunning = running > 0 && !allRunning

  const dotColor = hasError
    ? 'bg-red-500'
    : hasWarning
    ? 'bg-yellow-500'
    : allRunning
    ? 'bg-green-500'
    : someRunning
    ? 'bg-yellow-400'
    : 'bg-gray-400'

  return (
    <div
      className="flex items-center gap-2 py-2 px-1 cursor-pointer select-none"
      onClick={onToggle}
    >
      <span className="text-textMuted transition-transform duration-200">
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </span>
      <Box className="w-4 h-4 text-accent" />
      <span className="text-sm font-semibold text-textPrimary">{group.groupName}</span>
      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
      <span className="text-xs text-textMuted">{running}/{total}</span>
    </div>
  )
}

export function getGroupContainerIds(group: WorkspaceGroupedContainers): string[] {
  const ids: string[] = []
  for (const pg of group.projectGroups) {
    for (const c of pg.containers) {
      ids.push(c.id)
    }
  }
  return ids
}
