import { type ReactNode } from 'react'

export type DataTableColumn<TRow> = {
  id: string
  header: string
  width?: string
  align?: 'left' | 'right' | 'center'
  truncate?: boolean
  render: (row: TRow) => ReactNode
  title?: (row: TRow) => string
}

type DataTableProps<TRow> = {
  columns: DataTableColumn<TRow>[]
  rows: TRow[]
  rowKey: (row: TRow, index: number) => string
  emptyMessage: string
  compact?: boolean
}

function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  emptyMessage,
  compact = false,
}: DataTableProps<TRow>) {
  return (
    <div className="table-wrap">
      <table className={`data-table${compact ? ' compact' : ''}`}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                style={column.width ? { width: column.width } : undefined}
                className={column.align ? `align-${column.align}` : ''}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row, index) => (
              <tr key={rowKey(row, index)}>
                {columns.map((column) => (
                  <td key={column.id} className={column.align ? `align-${column.align}` : ''}>
                    <span
                      className={column.truncate ? 'cell-truncate' : ''}
                      title={column.title ? column.title(row) : undefined}
                    >
                      {column.render(row)}
                    </span>
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="empty-row">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default DataTable
