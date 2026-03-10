import { type ReactNode } from 'react'

type MetricChipTone = 'default' | 'improving' | 'flat' | 'declining' | 'insufficient'

type MetricChipProps = {
  label: string
  value: ReactNode
  tone?: MetricChipTone
  className?: string
}

function MetricChip({ label, value, tone = 'default', className = '' }: MetricChipProps) {
  return (
    <div className={`metric-chip tone-${tone} ${className}`.trim()}>
      <span className="label">{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default MetricChip
