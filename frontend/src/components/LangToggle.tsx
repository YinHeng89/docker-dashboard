interface LangToggleProps {
  on: boolean
  onToggle: () => void
  leftLabel: string
  rightLabel: string
  title?: string
}

const Globe = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
)

export default function LangToggle({ on, onToggle, leftLabel, rightLabel, title }: LangToggleProps) {
  return (
    <div className="lang-group">
      <span className="lang-label right">{leftLabel}</span>
      <div className={`lang-track${on ? ' on' : ''}`} onClick={onToggle} title={title}>
        <span className="lang-track-icon left">{Globe}</span>
        <span className="lang-track-icon right">{Globe}</span>
        <span className="lang-knob">
          <span className="lang-knob-icon lang-knob-off">{Globe}</span>
          <span className="lang-knob-icon lang-knob-on">{Globe}</span>
        </span>
      </div>
      <span className="lang-label left">{rightLabel}</span>
    </div>
  )
}
