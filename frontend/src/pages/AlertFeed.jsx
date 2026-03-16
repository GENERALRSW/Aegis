import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAllAlerts, getAllEvents } from '../services/alertService'
import '../components/SharedStyles.css'
import './AlertFeed.css'

const TYPE_CONFIG = {
  weapon:   { label: 'Weapon',   color: '#E24B4A', bg: 'rgba(226,75,74,0.12)'   },
  conflict: { label: 'Conflict', color: '#F5C518', bg: 'rgba(245,197,24,0.12)'  },
  intruder: { label: 'Intruder', color: '#4A9FE2', bg: 'rgba(74,159,226,0.12)'  },
  multi:    { label: 'Multi',    color: '#9b8fef', bg: 'rgba(155,143,239,0.12)' },
}
const STATUS_CONFIG = {
  unreviewed: { label: 'Unreviewed', color: '#F5C518', bg: 'rgba(245,197,24,0.12)'  },
  verified:   { label: 'Verified',   color: '#22C55E', bg: 'rgba(34,197,94,0.12)'   },
  escalated:  { label: 'Escalated',  color: '#E24B4A', bg: 'rgba(226,75,74,0.12)'   },
  fp:         { label: 'False +',    color: '#666',    bg: 'rgba(102,102,102,0.12)' },
}

function ConfRing({ value, color }) {
  const r = 16, circ = 2 * Math.PI * r, fill = (value / 100) * circ
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" style={{flexShrink:0}}>
      <circle cx="22" cy="22" r={r} fill="none" stroke="#2a2a2a" strokeWidth="3"/>
      <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={`${fill} ${circ-fill}`} strokeLinecap="round"
        style={{transform:'rotate(-90deg)',transformOrigin:'22px 22px'}}/>
      <text x="22" y="26" textAnchor="middle" fill="white" fontSize="10" fontWeight="700"
        fontFamily="var(--font-mono)">{value}%</text>
    </svg>
  )
}

// Normalise event from backend to UI shape
const normaliseEvent = (e) => ({
  id: e.event_id || e.id,
  type: e.event_type?.toLowerCase() || 'intruder',
  status: e.status || 'unreviewed',
  title: `${(e.event_type || 'Detection').charAt(0).toUpperCase() + (e.event_type||'').slice(1)} detected`,
  summary: e.description || e.metadata?.description || `Detection at ${e.camera_id}`,
  camera: e.camera_id,
  zone: e.metadata?.zone || e.location || 'Unknown',
  time: e.created_at ? new Date(e.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '—',
  duration: e.metadata?.duration || '—',
  confidence: Math.round((e.confidence || 0) * 100),
})

export default function AlertFeed() {
  const navigate = useNavigate()
  const [events, setEvents]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [filterType, setFilterType]   = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAllEvents({ limit: 50 })
        setEvents(Array.isArray(data) ? data.map(normaliseEvent) : [])
      } catch (err) {
        console.error('AlertFeed error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered = events.filter(a => {
    if (filterType !== 'all' && a.type !== filterType) return false
    if (filterStatus !== 'all' && a.status !== filterStatus) return false
    return true
  })

  const counts = {
    total: events.length,
    unreviewed: events.filter(a => a.status === 'unreviewed').length,
    verified:   events.filter(a => a.status === 'verified').length,
    escalated:  events.filter(a => a.status === 'escalated').length,
  }

  return (
    <div className="page-wrapper">
      <div className="page-header af-header">
        <div>
          <h1 className="page-title">Alert Feed</h1>
          <p className="page-subtitle">Real-time CV detection events</p>
        </div>
        <div className="af-count-row">
          <div className="af-count total">{counts.total} total</div>
          <div className="af-count unreviewed">{counts.unreviewed} unreviewed</div>
          <div className="af-count verified">{counts.verified} verified</div>
          <div className="af-count escalated">{counts.escalated} escalated</div>
        </div>
      </div>

      <div className="af-filters">
        <select className="filter-select" value={filterType} onChange={e=>setFilterType(e.target.value)}>
          <option value="all">All types</option>
          <option value="weapon">Weapon</option>
          <option value="conflict">Conflict</option>
          <option value="intruder">Intruder</option>
        </select>
        <select className="filter-select" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="unreviewed">Unreviewed</option>
          <option value="verified">Verified</option>
          <option value="escalated">Escalated</option>
          <option value="fp">False positive</option>
        </select>
        <button className="btn" style={{marginLeft:'auto'}}>Export CSV</button>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="af-empty">Loading alerts...</div>
        ) : filtered.length === 0 ? (
          <div className="af-empty">No alerts match the current filters.</div>
        ) : (
          <div className="af-list">
            {filtered.map(alert => {
              const tc = TYPE_CONFIG[alert.type] || TYPE_CONFIG.intruder
              const sc = STATUS_CONFIG[alert.status] || STATUS_CONFIG.unreviewed
              return (
                <div key={alert.id} className="af-card" style={{borderLeftColor:tc.color}}
                  onClick={() => navigate(`/alerts/${alert.id}`)}>
                  <div className="af-thumb" style={{background:tc.bg}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke={tc.color} strokeWidth="1.8" strokeLinejoin="round"/>
                      <path d="M12 9v4M12 17h.01" stroke={tc.color} strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div className="af-body">
                    <div className="af-top">
                      <span className="af-title">{alert.title}</span>
                      <span className="af-badge" style={{color:tc.color,background:tc.bg}}>{tc.label}</span>
                      <span className="af-badge" style={{color:sc.color,background:sc.bg}}>{sc.label}</span>
                    </div>
                    <p className="af-summary">{alert.summary}</p>
                    <div className="af-meta">
                      <span>{alert.camera}</span>
                      <span>{alert.zone}</span>
                      <span>{alert.time}</span>
                      {alert.duration !== '—' && <span>Duration: {alert.duration}</span>}
                    </div>
                  </div>
                  <div className="af-right">
                    <ConfRing value={alert.confidence} color={tc.color} />
                    <div className="af-actions" onClick={e=>e.stopPropagation()}>
                      <button className="af-btn review" onClick={()=>navigate(`/alerts/${alert.id}`)}>Review</button>
                      <button className="af-btn">FP</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
