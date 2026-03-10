import { type ReactNode } from 'react'

type PanelCardProps = {
  children: ReactNode
  className?: string
}

function PanelCard({ children, className = '' }: PanelCardProps) {
  return <section className={`panel ${className}`.trim()}>{children}</section>
}

export default PanelCard
