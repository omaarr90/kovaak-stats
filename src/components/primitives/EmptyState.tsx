type EmptyStateProps = {
  title: string
  description: string
  className?: string
}

function EmptyState({ title, description, className = '' }: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`.trim()} role="status" aria-live="polite">
      <strong>{title}</strong>
      <span className="subtle">{description}</span>
    </div>
  )
}

export default EmptyState
