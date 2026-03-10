import { type ReactNode } from 'react'

type SectionHeaderProps = {
  title: string
  description?: string
  eyebrow?: string
  actions?: ReactNode
}

function SectionHeader({ title, description, eyebrow, actions }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <div className="section-title-group">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="section-title">{title}</h2>
        {description && <p className="subtle">{description}</p>}
      </div>
      {actions ? <div className="section-actions">{actions}</div> : null}
    </div>
  )
}

export default SectionHeader
