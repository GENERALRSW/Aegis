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

export default function Overview() {
  const [activeTab, setActiveTab]     = useState('All')
  const [jdfOnline]                   = useState(true)
  const [cameras, setCameras]         = useState([])
  const [alerts, setAlerts]           = useState([])
  const [missingProfiles, setMissing] = useState([])
  const [stats, setStats]             = useState({ total:0, weapon:0, conflict:0, intruder:0 })
  const [loading, setLoading]         = useState(true)
  const [now, setNow]                 = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(t)
  }, [])

  const loadData = async () => {
    try {
      const [cams, allAlerts, profiles, todayStats] = await Promise.all([
        getAllCameras(),
        getAllEvents({ limit: 20, severity: 'high' }),
        getActiveProfiles(),
        getTodayStats(),
      ])
      setCameras(Array.isArray(cams) ? cams : [])
      setAlerts(Array.isArray(allAlerts) ? allAlerts : [])
      setMissing(Array.isArray(profiles) ? profiles : [])
      setStats(todayStats || { total:0, weapon:0, conflict:0, intruder:0 })
    } catch (err) {
      console.error('Overview load error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const onlineCams     = cameras.filter(c => ['active','online'].includes(c.status))
  const offlineCams    = cameras.filter(c => ['inactive','offline'].includes(c.status))
  const unreviewed     = alerts.filter(a => a.status === 'unreviewed')
  const weaponAlerts   = alerts.filter(a => a.event_type === 'weapon')
  const conflictAlerts = alerts.filter(a => a.event_type === 'conflict')
  const intruderAlerts = alerts.filter(a => a.event_type === 'intruder')
  const maxDetections  = Math.max(...cameras.map(c => c.detections_today || 0), 1)

  const filteredCameras = activeTab === 'All'
    ? cameras.slice(0, 6)
    : cameras.filter(c => c.location?.toLowerCase().includes(activeTab.toLowerCase())).slice(0, 6)

  const timeStr = now.toLocaleTimeString('en-US', { weekday:'short', hour:'2-digit', minute:'2-digit' })
  const dateStr = now.toLocaleDateString('en-US', { day:'2-digit', month:'short' })

  return (
    <div className="overview-wrapper">

      {/* ── Title row — breathing room ── */}
      <div className="overview-title-row">
        <h1 className="page-title">Overview</h1>
        <p className="page-subtitle">Lays out the features as a whole.</p>
      </div>

      {/* ── Stats + controls on the same row ── */}
      <div className="overview-header">

        {/* Stat cards */}
        <div className="overview-stats">
          <div className="ov-glass-chip stat-card">
            <div className="stat-card-label">Total detection today</div>
            <div className="stat-card-val">{loading ? '—' : stats.total}</div>
            <div className="stat-card-sub" style={{color:'var(--weapon)'}}>+{stats.total} today</div>
          </div>
          <div className="ov-glass-chip stat-card">
            <div className="stat-card-label">Unreviewed alerts</div>
            <div className="stat-card-val">{loading ? '—' : unreviewed.length}</div>
            <div className="stat-card-sub">Requires attention</div>
          </div>
          <div className="ov-glass-chip stat-card">
            <div className="stat-card-label">Camera online</div>
            <div className="stat-card-val">
              {loading ? '—' : <>{onlineCams.length}<span className="stat-denom">/{cameras.length}</span></>}
            </div>
            <div className="stat-card-sub" style={{color:'var(--online)'}}>{offlineCams.length} offline</div>
          </div>
          <div className="ov-glass-chip stat-card">
            <div className="stat-card-label">Acting missing profiles</div>
            <div className="stat-card-val">{loading ? '—' : missingProfiles.length}</div>
            <div className="stat-card-sub" style={{color:'var(--online)'}}>
              {missingProfiles.filter(p=>p.status==='matched').length} match today
            </div>
          </div>
        </div>

        {/* Controls — notif, user, JDF */}
        <div className="overview-controls">
          <div className="controls-row">
            <div className="ov-glass-chip notif-btn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              {unreviewed.length > 0 && <div className="notif-dot"/>}
            </div>
            <div className="ov-glass-chip user-chip">
              <div className="user-chip-avatar">JG</div>
              <span className="user-chip-time">{timeStr}</span>
              <div className="user-chip-date">{dateStr}</div>
            </div>
          </div>
          <div className="ov-glass-chip jdf-chip">
            <div className="jdf-icon">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="jdf-info">
              <span className="jdf-label">JDF Liaison</span>
              <span className="jdf-status" style={{color: jdfOnline ? 'var(--online)' : 'var(--muted)'}}>
                {jdfOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="jdf-presence-dot" style={{
              background: jdfOnline ? 'var(--online)' : 'rgba(255,255,255,0.15)',
              boxShadow:  jdfOnline ? '0 0 7px var(--online)' : 'none',
            }}/>
          </div>
        </div>

      </div>

      {/* ── Main grid ── */}
      <div className="overview-grid">

        {/* Left — camera panel */}
        <div className="camera-panel ov-glass-chip">
          <MultiCameraFeed onEventDetected={() => setTimeout(loadData, 1500)}/>

          <div className="cam-list-inner">
            <div className="cam-tabs">
              {TABS.map(tab => (
                <button key={tab}
                  className={`cam-tab ${activeTab===tab?'active':''}`}
                  onClick={() => setActiveTab(tab)}>
                  {tab}
                </button>
              ))}
            </div>
            <div className="cam-list-header">
              <span>#</span><span>Location/Camera</span><span>Activity</span>
            </div>
            <div className="cam-list">
              {loading ? (
                <div className="cam-empty">Loading cameras...</div>
              ) : filteredCameras.length > 0 ? filteredCameras.map((cam, i) => {
                const count = cam.detections_today || 0
                const pct   = `${Math.round((count / maxDetections) * 100)}%`
                const color = count > 10 ? 'var(--weapon)' : count > 5 ? 'var(--conflict)' : 'var(--online)'
                return (
                  <div key={cam.camera_id || i} className="cam-row">
                    <div className="cam-row-info">
                      <span className="cam-row-zone">{cam.location || 'Unknown'}</span>
                      <span className="cam-row-name">{cam.camera_id || cam.name}</span>
                      <div className="cam-bar-track">
                        <div className="cam-bar-fill" style={{width:pct, background:color}}/>
                      </div>
                    </div>
                    <span className="cam-row-count">{String(count).padStart(2,'0')}</span>
                  </div>
                )
              }) : <div className="cam-empty">No cameras registered</div>}
            </div>
          </div>
        </div>

        {/* Right — 2×2 detection grid */}
        <div className="detection-grid">

          {/* Weapon Detected */}
          <div className="ov-glass-chip detection-card">
            <div className="detection-main">
              <div className="detection-info">
                <h2 className="detection-title">Weapon<br/>Detected</h2>
                <p className="detection-subtitle">
                  {weaponAlerts[0]?.summary || 'Bladed object detected'}
                </p>
              </div>
              <Gauge value={weaponAlerts.length} max={24} color="var(--weapon)" size={110}/>
            </div>
            {weaponAlerts[0] && (
              <div className="detection-tags">
                <span className="badge badge-weapon">
                  {new Date(weaponAlerts[0].timestamp).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}
                </span>
                <span className="badge badge-weapon">{weaponAlerts[0].camera_id || '—'}</span>
                <span className="badge badge-weapon">{weaponAlerts[0].severity || 'high'}</span>
              </div>
            )}
            <p className="detection-desc">
              {weaponAlerts[0]?.summary || 'No weapon detections yet today.'}
            </p>
          </div>

          {/* Intruder Detected */}
          <div className="ov-glass-chip detection-card">
            <div className="detection-main">
              <div className="detection-info">
                <h2 className="detection-title">Intruder<br/>Detected</h2>
              </div>
              <Gauge value={intruderAlerts.length} max={24} color="var(--intruder)" size={110}/>
            </div>
            {intruderAlerts[0] && (
              <div className="detection-tags">
                <span className="badge badge-intruder">
                  {new Date(intruderAlerts[0].timestamp).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}
                </span>
                <span className="badge badge-intruder">{intruderAlerts[0].camera_id || '—'}</span>
              </div>
            )}
            <p className="detection-desc">Un-authorised zone entry</p>
          </div>

          {/* Conflict Behavior */}
          <div className="ov-glass-chip detection-card">
            <div className="detection-main">
              <div className="detection-info">
                <h2 className="detection-title">Conflict<br/>Behavior</h2>
              </div>
              <Gauge value={conflictAlerts.length} max={24} color="var(--conflict)" size={110}/>
            </div>
            {conflictAlerts[0] && (
              <div className="detection-tags">
                <span className="badge badge-conflict">
                  {new Date(conflictAlerts[0].timestamp).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}
                </span>
                <span className="badge badge-conflict">{conflictAlerts[0].camera_id || '—'}</span>
              </div>
            )}
            <p className="detection-desc">
              {conflictAlerts[0]?.summary || 'Aggressive movement pattern'}
            </p>
          </div>

          {/* Missing Persons */}
          <div className="ov-glass-chip detection-card">
            <div className="missing-header">
              <h2 className="detection-title">Missing<br/>Persons</h2>
              <div className="missing-count">
                <span className="missing-num">
                  {loading ? '—' : missingProfiles.filter(p=>p.status==='matched').length}
                  <span className="missing-denom">/{missingProfiles.length}</span>
                </span>
                <span className="missing-label">Matched</span>
              </div>
            </div>
            <div className="missing-list">
              {missingProfiles.slice(0,3).map(p => (
                <div key={p.person_id} className="missing-row">
                  <div className="missing-avatar">{p.name?.slice(0,2).toUpperCase()||'MP'}</div>
                  <div className="missing-info">
                    <span className="missing-name">{p.name || `Profile #${p.person_id?.slice(-4)}`}</span>
                    <span className="missing-detail">{p.description || 'No match identified yet'}</span>
                  </div>
                  <span className={`badge ${p.status==='matched'?'badge-online':'badge-intruder'}`}>
                    {p.status==='matched' ? `${Math.round((p.match_score||0)*100)}%` : 'Active'}
                  </span>
                </div>
              ))}
              {missingProfiles.length === 0 && !loading && (
                <p className="cam-empty">No active profiles</p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}