import { useState, useEffect } from 'react'
import MultiCameraFeed from '../components/MultiCameraFeed.jsx'
import StatCard from '../components/StatCard.jsx'
import Gauge from '../components/Gauge.jsx'
import { getAllCameras } from '../services/cameraService'
import { getAllEvents } from '../services/alertService'
import { getActiveProfiles } from '../services/missingPersonsService'
import { getTodayStats } from '../services/analyticsService'
import './Overview.css'
import '../components/SharedStyles.css'

const TABS = ['All', 'MAIN', 'ENG RM 01', 'ENG RM 02']
const TYPE_CONFIG = {
  weapon:   { color: 'var(--weapon)',   label: 'Weapon Detected',   gaugeMax: 24 },
  conflict: { color: 'var(--conflict)', label: 'Conflict Behavior', gaugeMax: 24 },
  intruder: { color: 'var(--intruder)', label: 'Intruder Detected', gaugeMax: 24 },
}

export default function Overview() {
  const [activeTab, setActiveTab]         = useState('All')
  const [jdfOnline, setJdfOnline]         = useState(true)
  const [cameras, setCameras]             = useState([])
  const [alerts, setAlerts]               = useState([])
  const [missingProfiles, setMissing]     = useState([])
  const [stats, setStats]                 = useState({ total: 0, weapon: 0, conflict: 0, intruder: 0 })
  const [loading, setLoading]             = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const [cams, allAlerts, profiles, todayStats] = await Promise.all([
          getAllCameras(),
          getAllEvents({ limit: 10, severity: 'high' }),
          getActiveProfiles(),
          getTodayStats(),
        ])
        setCameras(Array.isArray(cams) ? cams : [])
        setAlerts(Array.isArray(allAlerts) ? allAlerts : [])
        setMissing(Array.isArray(profiles) ? profiles : [])
        setStats(todayStats || { total: 0, weapon: 0, conflict: 0, intruder: 0 })
      } catch (err) {
        console.error('Overview load error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const onlineCams   = cameras.filter(c => c.status === 'active' || c.status === 'online')
  const offlineCams  = cameras.filter(c => c.status === 'inactive' || c.status === 'offline')
  const unreviewed   = alerts.filter(a => a.status === 'unreviewed')
  const weaponAlerts = alerts.filter(a => a.event_type === 'weapon')
  const conflictAlerts = alerts.filter(a => a.event_type === 'conflict')

  const filteredCameras = activeTab === 'All' ? cameras.slice(0, 4)
    : cameras.filter(c => c.location?.toLowerCase().includes(activeTab.toLowerCase())).slice(0, 4)

  const maxDetections = Math.max(...cameras.map(c => c.detections_today || 0), 1)

  return (
    <div className="overview-wrapper">
      {/* Header */}
      <div className="overview-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">Lays out the features as a whole.</p>
        </div>
        <div className="overview-controls">
          <div className="controls-row">
            <div className="notif-btn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" stroke="var(--muted)" strokeWidth="1.8" strokeLinecap="round"/></svg>
              {unreviewed.length > 0 && <div className="notif-dot" />}
            </div>
            <div className="user-chip">
              <div className="user-chip-avatar">JG</div>
              <span className="user-chip-time">{new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
              <div className="user-chip-date">{new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short' })}</div>
            </div>
          </div>
          <div className="jdf-chip">
            <div className="jdf-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="var(--muted)" strokeWidth="1.8"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="var(--muted)" strokeWidth="1.8" strokeLinecap="round"/></svg></div>
            <div className="jdf-info">
              <span className="jdf-label">JDF Liaison</span>
              <span className="jdf-status" style={{ color: jdfOnline ? 'var(--online)' : 'var(--muted)' }}>{jdfOnline ? 'Online' : 'Offline'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="overview-stats">
        <StatCard label="Total detection today" value={loading ? '—' : stats.total} sub={`+${stats.total} today`} subColor="var(--weapon)" />
        <StatCard label="Unreviewed alerts"      value={loading ? '—' : unreviewed.length} sub="Requires attention" />
        <StatCard label="Camera online"          value={loading ? '—' : <>{onlineCams.length}<span className="stat-denom">/{cameras.length}</span></>} sub="Online" subColor="var(--online)" />
        <StatCard label="Acting missing profiles" value={loading ? '—' : missingProfiles.length} sub="Active searches" />
      </div>

      {/* Main grid */}
      <div className="overview-grid">
        {/* Camera panel — live webcam feed + camera list */}
        <div className="camera-panel">
          <MultiCameraFeed
            onEventDetected={(event) => {
              console.log('New detection from overview feed:', event)
            }}
          />

          {/* Camera list below the feed */}
          <div className="cam-list-wrap card">
            <div className="cam-tabs">
              {TABS.map(tab => <button key={tab} className={`cam-tab ${activeTab===tab?'active':''}`} onClick={()=>setActiveTab(tab)}>{tab}</button>)}
            </div>
            
            <div className="cam-list-header"><span>Location/Camera</span><span>#</span></div>

            <div className="cam-list">
              {loading ? (
                <div style={{padding:'20px 0',textAlign:'center',fontSize:11,color:'var(--muted)'}}>Loading cameras...</div>
              ) : filteredCameras.length > 0 ? filteredCameras.map((cam, i) => {
                const count = cam.detections_today || 0
                const pct = `${Math.round((count / maxDetections) * 100)}%`
                const color = count > 10 ? 'var(--weapon)' : count > 5 ? 'var(--conflict)' : 'var(--online)'
                return (
                  <div key={cam.camera_id || i} className="cam-row">
                    <div className="cam-row-info">
                      <span className="cam-row-zone">{cam.location || 'Unknown'}</span>
                      <span className="cam-row-name">{cam.camera_id || cam.name}</span>
                      <div className="cam-bar-track"><div className="cam-bar-fill" style={{width:pct,background:color}}/></div>
                    </div>
                    <span className="cam-row-count">{String(count).padStart(2,'0')}</span>
                  </div>
                )
              }) : (
                <div style={{padding:'20px 0',textAlign:'center',fontSize:11,color:'var(--muted)'}}>No cameras registered</div>
              )}
            </div>
          </div>
        </div>

        {/* Detection cards */}
        <div className="detection-col">
          <div className="card detection-card">
            <div className="detection-main">
              <div className="detection-info">
                <h2 className="detection-title">Weapon<br/>Detected</h2>
                <p className="detection-subtitle">{weaponAlerts[0]?.metadata?.description || 'Bladed object detected'}</p>
              </div>
              <Gauge value={weaponAlerts.length} max={24} color="var(--weapon)" size={110} />
            </div>
            {weaponAlerts[0] && (
              <div className="detection-tags">
                <span className="badge badge-weapon">{weaponAlerts[0].created_at ? new Date(weaponAlerts[0].created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '—'}</span>
                <span className="badge badge-weapon">{weaponAlerts[0].metadata?.zone || 'Unknown Zone'}</span>
                <span className="badge badge-weapon">{weaponAlerts[0].camera_id || '—'}</span>
              </div>
            )}
            <p className="detection-desc">{weaponAlerts[0]?.description || 'No weapon detections yet today.'}</p>
          </div>

          <div className="card detection-card">
            <div className="detection-main">
              <div className="detection-info">
                <h2 className="detection-title">Conflict<br/>Behavior</h2>
              </div>
              <Gauge value={conflictAlerts.length} max={24} color="var(--conflict)" size={110} />
            </div>
            {conflictAlerts[0] && (
              <div className="detection-tags">
                <span className="badge badge-conflict">{conflictAlerts[0].metadata?.zone || 'Unknown Zone'}</span>
                <span className="badge badge-conflict">{conflictAlerts[0].camera_id || '—'}</span>
              </div>
            )}
            <p className="detection-desc">{conflictAlerts[0]?.description || 'No conflict detections yet today.'}</p>
          </div>
        </div>

        {/* Right column */}
        <div className="right-col">
          <div className="card right-card">
            <div className="detection-main">
              <h2 className="detection-title">Intruder<br/>Detected</h2>
              <Gauge value={alerts.filter(a=>a.event_type==='intruder').length} max={24} color="var(--intruder)" size={100} />
            </div>
            <div className="detection-tags">
              {alerts.filter(a=>a.event_type==='intruder').slice(0,3).map((a,i)=>(
                <span key={i} className="badge badge-intruder">{a.metadata?.zone || a.camera_id || '—'}</span>
              ))}
            </div>
            <p className="detection-desc">Un-authorised zone entry</p>
          </div>

          <div className="card right-card">
            <div className="missing-header">
              <h2 className="detection-title">Missing<br/>Persons</h2>
              <div className="missing-count">
                <span className="missing-num">{loading ? '—' : missingProfiles.filter(p=>p.status==='matched').length}<span className="missing-denom">/{missingProfiles.length}</span></span>
                <span className="missing-label">Matched</span>
              </div>
            </div>
            {missingProfiles.slice(0, 2).map(p => (
              <div key={p.person_id} className="missing-row">
                <div className="missing-avatar">{p.name?.slice(0,2).toUpperCase() || 'MP'}</div>
                <div className="missing-info">
                  <span className="missing-name">{p.name || `Profile #${p.person_id?.slice(-4)}`}</span>
                  <span className="missing-detail">{p.last_seen_location || 'Location unknown'}</span>
                </div>
                <span className={`badge ${p.status==='matched'?'badge-online':'badge-intruder'}`}>
                  {p.status==='matched' ? `${p.match_score||0}%` : 'Active'}
                </span>
              </div>
            ))}
            {missingProfiles.length === 0 && !loading && (
              <p style={{fontSize:11,color:'var(--muted)',padding:'8px 0'}}>No active missing person profiles</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
