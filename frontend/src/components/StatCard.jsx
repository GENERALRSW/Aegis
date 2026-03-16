import './StatCard.css'

/**
 * StatCard
 * @param {string} label   - Card label shown at top
 * @param {string|number} value  - Main large value
 * @param {string} sub     - Subtext shown below value
 * @param {string} subColor - CSS color for subtext (default: var(--muted))
 */
export default function StatCard({ label, value, sub, subColor }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && (
        <div className="stat-sub" style={{ color: subColor || 'var(--muted)' }}>
          {sub}
        </div>
      )}
    </div>
  )
}
