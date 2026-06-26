interface ThemeToggleProps {
  on: boolean
  onToggle: () => void
  leftLabel: string
  rightLabel: string
  title?: string
}

const Sun = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="12" r="5"/>
    <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>
)

const Moon = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
)

export default function ThemeToggle({ on, onToggle, leftLabel, rightLabel, title }: ThemeToggleProps) {
  return (
    <div className="theme-group">
      <span className="theme-label right">{leftLabel}</span>
      <div className={`theme-track${on ? ' on' : ''}`} onClick={onToggle} title={title}>
        <span className="theme-track-icon left">{Sun}</span>
        <span className="theme-track-icon right">{Moon}</span>
        <span className="theme-knob">
          <span className="theme-knob-icon theme-knob-off">{Sun}</span>
          <span className="theme-knob-icon theme-knob-on">{Moon}</span>
        </span>
      </div>
      <span className="theme-label left">{rightLabel}</span>
    </div>
  )
}
