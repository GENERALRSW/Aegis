import './AlertCard.css'

const TYPE_MAP = {
  weapon:         { label: 'Weapon',         color: 'var(--weapon)',   bg: 'rgba(226,75,74,0.15)' },
  conflict:       { label: 'Conflict',       color: 'var(--conflict)', bg: 'rgba(245,197,24,0.15)' },
  intruder:       { label: 'Intruder',       color: 'var(--intruder)', bg: 'rgba(74,159,226,0.15)' },
  multi:          { label: 'Multi',          color: '#7F77DD',          bg: 'rgba(127,119,221,0.15)' },
  visitor:        { label: 'Visitor',        color: 'var(--muted)',    bg: 'rgba(102,102,102,0.12)' },
  authorized:     { label: 'Authorized',     color: 'var(--online)',   bg: 'rgba(34,197,94,0.12)' },
  missing_person: { label: 'Missing Person', color: '#F59E0B',          bg: 'rgba(245,158,11,0.12)' },
}

const STATUS_MAP = {
  unreviewed: { label: 'Unreviewed', color: '#854F0B', bg: 'rgba(245,197,24,0.15)' },
  verified:   { label: 'Verified',   color: '#3B6D11', bg: 'rgba(34,197,94,0.15)' },
  escalated:  { label: 'Escalated',  color: '#A32D2D', bg: 'rgba(226,75,74,0.15)' },
  fp:         { label: 'False Positive', color: 'var(--muted)', bg: 'var(--elevated)' },
}

/**
 * AlertCard
 * @param {object} alert   - Alert data object
 * @param {function} onClick - Click handler → routes to IncidentDetail
 */
export default function AlertCard({ alert, onClick }) {
  const type   = TYPE_MAP[alert.type]   || TYPE_MAP.weapon
  const status = STATUS_MAP[alert.status] || STATUS_MAP.unreviewed

  return (
    <div
      className="alert-card"
      style={{ borderLeftColor: type.color }}
      onClick={onClick}
    >
      {/* Thumb */}
      <div className="alert-thumb" style={{ background: type.bg }}>
        <span style={{ fontSize: 20 }}>{alert.emoji || '⚠️'}</span>
      </div>

      {/* Body */}
      <div className="alert-body">
        <div className="alert-top">
          <span className="alert-type">{alert.title}</span>
          <span className="alert-badge" style={{ background: type.bg, color: type.color }}>
            {type.label}
          </span>
          <span className="alert-badge" style={{ background: status.bg, color: status.color }}>
            {status.label}
          </span>
        </div>
        <p className="alert-summary">{alert.summary}</p>
        <div className="alert-meta">
          <span>{alert.camera}</span>
          <span>{alert.zone}</span>
          <span>{alert.time}</span>
          {alert.duration && <span>Duration: {alert.duration}</span>}
        </div>
      </div>

      {/* Confidence */}
      <div className="alert-right">
        <div className="conf-circle" style={{ '--conf-color': type.color }}>
          <span style={{ color: type.color }}>{alert.confidence}%</span>
        </div>
        <div className="alert-actions" onClick={(e) => e.stopPropagation()}>
          <button className="alert-btn review">Review</button>
          <button className="alert-btn">FP</button>
        </div>
      </div>
    </div>
  )
}
