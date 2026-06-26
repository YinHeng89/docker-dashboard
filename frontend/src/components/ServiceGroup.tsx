import type { Service } from '../types'
import ServiceCard from './ServiceCard'

interface ServiceGroupProps {
  groupName: string
  icon: React.ReactNode
  services: Service[]
  managedProjects: string[]
}

export default function ServiceGroup({ groupName, icon, services, managedProjects }: ServiceGroupProps) {
  if (services.length === 0) return null

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-textPrimary">{icon}</span>
        <h2 className="text-base font-semibold text-textPrimary">{groupName}</h2>
        <span className="text-xs text-textMuted font-mono">({services.length})</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3">
        {services.map((s) => (
          <ServiceCard key={s.id} service={s} managedProjects={managedProjects} />
        ))}
      </div>
    </section>
  )
}
