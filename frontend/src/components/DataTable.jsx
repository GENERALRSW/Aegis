import './DataTable.css'

/**
 * DataTable
 * Reusable sortable table for Aegis
 *
 * @param {string[]}  columns  - Column header labels
 * @param {string[]}  keys     - Data keys matching each column
 * @param {object[]}  data     - Array of row data objects
 * @param {function}  onRowClick - Optional row click handler
 * @param {string}    emptyMsg - Message when no data
 */
export default function DataTable({ columns, keys, data, onRowClick, emptyMsg = 'No data found' }) {
  return (
    <div className="data-table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th key={i}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="data-table-empty">
                {emptyMsg}
              </td>
            </tr>
          ) : (
            data.map((row, ri) => (
              <tr
                key={ri}
                className={onRowClick ? 'clickable' : ''}
                onClick={() => onRowClick?.(row)}
              >
                {keys.map((key, ki) => (
                  <td key={ki}>{row[key] ?? '—'}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
