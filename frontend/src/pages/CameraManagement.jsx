import { useState, useEffect } from 'react'
import { getAllCameras, updateCamera, deactivateCamera } from '../services/cameraService'
import { getToken } from '../services/api'
import WebcamFeed from '../components/WebcamFeed.jsx'
import { QRCodeSVG } from 'qrcode.react'
import '../components/SharedStyles.css'
import './CameraManagement.css'

const SENS_COLORS = { high:'#E24B4A', medium:'#F5C518', low:'#22C55E' }
const STATUS_COLORS = { active:'#22C55E', online:'#22C55E', alert:'#E24B4A', inactive:'#444', offline:'#444' }

export default function CameraManagement() {
  const [cameras, setCameras]     = useState([])
  const [selected, setSelected]   = useState(null)
  const [filter, setFilter]       = useState('all')
  const [view, setView]           = useState('grid')
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState('registered') // 'registered' | 'webcam' | 'phone'
  const [copied, setCopied]       = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAllCameras()
        const cams = Array.isArray(data) ? data : []
        setCameras(cams)
        if (cams.length > 0) setSelected(cams[0])
      } catch (err) {
        console.error('CameraManagement error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filtered        = cameras.filter(c => filter === 'all' || c.status === filter || (filter === 'online' && c.status === 'active'))
  const onlineCount     = cameras.filter(c => ['active','online'].includes(c.status)).length
  const offlineCount    = cameras.filter(c => ['inactive','offline'].includes(c.status)).length
  const totalDetections = cameras.reduce((a, c) => a + (c.detections_today || 0), 0)

  const handleSensitivity = async (sensitivity) => {
    if (!selected) return
    try {
      await updateCamera(selected.camera_id, { metadata: { ...selected.metadata, sensitivity } })
      setCameras(cameras.map(c => c.camera_id === selected.camera_id ? { ...c, metadata: { ...c.metadata, sensitivity } } : c))
      setSelected(prev => ({ ...prev, metadata: { ...prev.metadata, sensitivity } }))
    } catch (err) { console.error(err) }
  }

  const handleDeactivate = async () => {
    if (!selected) return
    try {
      await deactivateCamera(selected.camera_id)
      setCameras(cameras.map(c => c.camera_id === selected.camera_id ? { ...c, status: 'inactive' } : c))
      setSelected(prev => ({ ...prev, status: 'inactive' }))
    } catch (err) { console.error(err) }
  }

  const sensitivity = selected?.metadata?.sensitivity || 'medium'
  const statusColor = STATUS_COLORS[selected?.status] || '#444'

  // Phone camera URL — embeds token so no login needed on mobile
  const token    = getToken()
  const phoneUrl = `${window.location.origin}/phone-camera${token ? `?t=${token}` : ''}`
  const mobileUrl = `${window.location.origin}/mobile${token ? `?t=${token}` : ''}`

  const handleCopy = (url) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="page-wrapper" style={{ paddingRight: 0 }}>

      {/* Header */}
      <div className="page-header cm-header">
        <div>
          <h1 className="page-title">Cameras</h1>
          <p className="page-subtitle">{cameras.length} cameras · {onlineCount} online · {offlineCount} offline</p>
        </div>
        <div className="cm-header-right">
          <div className="cm-view-toggle">
            <button className={`cm-view-btn ${activeTab==='registered'?'active':''}`} onClick={() => setActiveTab('registered')}>
              Registered
            </button>
            <button className={`cm-view-btn ${activeTab==='webcam'?'active':''}`} onClick={() => setActiveTab('webcam')}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" style={{marginRight:4}}>
                <rect x="2" y="6" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="1.8"/>
                <path d="M8 6l2-3h4l2 3" stroke="currentColor" strokeWidth="1.8"/>
              </svg>
              Live Webcam
            </button>
            <button className={`cm-view-btn ${activeTab==='phone'?'active':''}`} onClick={() => setActiveTab('phone')}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style={{marginRight:4}}>
                <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                <circle cx="12" cy="18" r="1" fill="currentColor"/>
              </svg>
              Connect Phone
            </button>
          </div>
          {activeTab === 'registered' && <>
            <select className="filter-select" value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="active">Online</option>
              <option value="alert">Alert</option>
              <option value="inactive">Offline</option>
            </select>
            <div className="cm-view-toggle">
              {['grid','list'].map(v => (
                <button key={v} className={`cm-view-btn ${view===v?'active':''}`} onClick={() => setView(v)}>{v}</button>
              ))}
            </div>
          </>}
        </div>
      </div>

      {/* Stats bar */}
      <div className="cm-stats">
        {[['Online',onlineCount,'#22C55E'],['Offline',offlineCount,'#E24B4A'],['Detections today',totalDetections,'#F5C518'],['Registered',cameras.length,'#4A9FE2']].map(([l,v,c]) => (
          <div key={l} className="cm-stat">
            <div className="cm-stat-dot" style={{background:c}}/>
            <div><div className="cm-stat-val">{v}</div><div className="cm-stat-label">{l}</div></div>
          </div>
        ))}
      </div>

      {/* ── Webcam tab ── */}
      {activeTab === 'webcam' && (
        <div className="cm-webcam-tab">
          <div className="cm-webcam-grid">
            <WebcamFeed onEventDetected={(event) => console.log('Detection event:', event)} />
            <div className="cm-webcam-info">
              <div className="card" style={{padding:'16px 18px',display:'flex',flexDirection:'column',gap:12}}>
                <div style={{fontSize:13,fontWeight:600,color:'var(--text)',fontFamily:'var(--font-sans)'}}>How it works</div>
                <div style={{fontSize:12,color:'var(--text-sub)',lineHeight:1.6,fontFamily:'var(--font-sans)'}}>
                  Clicking <strong>Start Feed</strong> will:<br/><br/>
                  1. Request access to your webcam<br/>
                  2. Register this laptop as a camera (<code style={{fontSize:10,background:'var(--elevated)',padding:'1px 4px',borderRadius:3}}>camera_type: laptop</code>)<br/>
                  3. Capture a JPEG frame every 2 seconds<br/>
                  4. Send to <code style={{fontSize:10,background:'var(--elevated)',padding:'1px 4px',borderRadius:3}}>POST /api/cv/detect/json</code><br/>
                  5. Display YOLOv8 + MediaPipe detections in real-time
                </div>
                <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-sans)',lineHeight:1.5,padding:'8px 10px',background:'var(--elevated)',borderRadius:8,borderLeft:'2px solid rgba(245,197,24,0.4)'}}>
                  Frame capture rate is 1 frame per 2 seconds to stay within backend limits. High/critical events are automatically passed to the alert feed.
                </div>
              </div>

              {cameras.filter(c => c.camera_type === 'laptop').length > 0 && (
                <div className="card" style={{padding:'14px 16px'}}>
                  <div style={{fontSize:11,fontWeight:500,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:10,fontFamily:'var(--font-sans)'}}>Registered laptop cameras</div>
                  {cameras.filter(c => c.camera_type === 'laptop').map(c => (
                    <div key={c.camera_id} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                      <div style={{width:7,height:7,borderRadius:'50%',background:c.status==='active'?'var(--online)':'#444',flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,color:'var(--text)',fontFamily:'var(--font-mono)'}}>{c.camera_id}</div>
                        <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-sans)'}}>{c.location}</div>
                      </div>
                      <span style={{fontSize:10,color:c.status==='active'?'var(--online)':'var(--muted)'}}>{c.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Phone tab ── */}
      {activeTab === 'phone' && (
        <div className="cm-webcam-tab">
          <div className="cm-webcam-grid">
            {/* QR code card */}
            <div className="card" style={{padding:'24px',display:'flex',flexDirection:'column',alignItems:'center',gap:20}}>
              <div style={{fontSize:13,fontWeight:600,color:'var(--text)',fontFamily:'var(--font-sans)',alignSelf:'flex-start'}}>Scan to open on your phone</div>

              <div style={{background:'#fff',padding:12,borderRadius:10,lineHeight:0}}>
                <QRCodeSVG value={phoneUrl} size={180} bgColor="#ffffff" fgColor="#0a0a0a" level="M" />
              </div>

              {/* PhoneCamera link */}
              <div style={{width:'100%',display:'flex',flexDirection:'column',gap:6}}>
                <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-sans)',textTransform:'uppercase',letterSpacing:'0.06em'}}>/phone-camera route</div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <code style={{flex:1,fontSize:10,background:'var(--elevated)',padding:'8px 10px',borderRadius:6,color:'var(--text-sub)',wordBreak:'break-all',lineHeight:1.5,fontFamily:'var(--font-mono)'}}>
                    {phoneUrl}
                  </code>
                  <button onClick={() => handleCopy(phoneUrl)}
                    style={{flexShrink:0,padding:'8px 12px',background:copied?'rgba(34,197,94,0.12)':'var(--elevated)',border:`1px solid ${copied?'rgba(34,197,94,0.3)':'var(--border)'}`,borderRadius:6,color:copied?'#22C55E':'var(--text-sub)',fontSize:11,cursor:'pointer',fontFamily:'var(--font-sans)',transition:'all 0.15s'}}>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* MobileCamera link */}
              <div style={{width:'100%',display:'flex',flexDirection:'column',gap:6}}>
                <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-sans)',textTransform:'uppercase',letterSpacing:'0.06em'}}>/mobile route</div>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  <code style={{flex:1,fontSize:10,background:'var(--elevated)',padding:'8px 10px',borderRadius:6,color:'var(--text-sub)',wordBreak:'break-all',lineHeight:1.5,fontFamily:'var(--font-mono)'}}>
                    {mobileUrl}
                  </code>
                  <button onClick={() => handleCopy(mobileUrl)}
                    style={{flexShrink:0,padding:'8px 12px',background:'var(--elevated)',border:'1px solid var(--border)',borderRadius:6,color:'var(--text-sub)',fontSize:11,cursor:'pointer',fontFamily:'var(--font-sans)'}}>
                    Copy
                  </button>
                </div>
              </div>
            </div>

            {/* Info card */}
            <div className="card" style={{padding:'16px 18px',display:'flex',flexDirection:'column',gap:12}}>
              <div style={{fontSize:13,fontWeight:600,color:'var(--text)',fontFamily:'var(--font-sans)'}}>How it works</div>
              <div style={{fontSize:12,color:'var(--text-sub)',lineHeight:1.7,fontFamily:'var(--font-sans)'}}>
                1. Scan the QR code or copy a link<br/>
                2. Open it on your phone — your auth token is embedded so no login needed<br/>
                3. Enter a location label (e.g. <em>Main Gate</em>)<br/>
                4. Tap <strong>Start Camera</strong> and allow camera access<br/>
                5. The phone registers as a camera and streams frames to the CV engine every 2 seconds
              </div>
              <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-sans)',lineHeight:1.5,padding:'8px 10px',background:'var(--elevated)',borderRadius:8,borderLeft:'2px solid rgba(74,159,226,0.4)'}}>
                The link contains your session token. Do not share it with untrusted parties. It expires when you log out.
              </div>

              {cameras.filter(c => c.camera_type === 'phone').length > 0 && (
                <div style={{marginTop:4}}>
                  <div style={{fontSize:11,fontWeight:500,color:'var(--muted)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8,fontFamily:'var(--font-sans)'}}>Active phone cameras</div>
                  {cameras.filter(c => c.camera_type === 'phone').map(c => (
                    <div key={c.camera_id} style={{display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:'1px solid var(--border)'}}>
                      <div style={{width:7,height:7,borderRadius:'50%',background:c.status==='active'?'var(--online)':'#444',flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,color:'var(--text)',fontFamily:'var(--font-mono)'}}>{c.camera_id}</div>
                        <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-sans)'}}>{c.location}</div>
                      </div>
                      <span style={{fontSize:10,color:c.status==='active'?'var(--online)':'var(--muted)'}}>{c.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Registered tab ── */}
      {activeTab === 'registered' && (
        <div className="cm-body">
          <div className="page-content cm-content">
            {loading ? (
              <div style={{padding:40,color:'var(--muted)',fontSize:13,textAlign:'center'}}>Loading cameras...</div>
            ) : filtered.length === 0 ? (
              <div style={{padding:40,color:'var(--muted)',fontSize:13,textAlign:'center'}}>No cameras registered yet.</div>
            ) : (
              <div className={`cm-${view}`}>
                {filtered.map(cam => {
                  const isOffline = ['inactive','offline'].includes(cam.status)
                  const isAlert   = cam.status === 'alert'
                  return (
                    <div key={cam.camera_id}
                      className={`cm-card ${isOffline?'offline':''} ${isAlert?'alert':''} ${selected?.camera_id===cam.camera_id?'selected':''}`}
                      onClick={() => setSelected(cam)}>
                      <div className="cm-feed">
                        {isOffline
                          ? <div className="cm-offline-label">NO SIGNAL</div>
                          : <div className="cm-feed-lines">{[...Array(6)].map((_,i) => <div key={i} className="cm-feed-line" style={{width:`${50+Math.sin(i*.8)*35}%`}}/>)}</div>
                        }
                        <div className="cm-feed-status" style={{background: isOffline?'rgba(68,68,68,0.85)':isAlert?'rgba(226,75,74,0.85)':'rgba(34,197,94,0.85)'}}>
                          {isOffline ? 'OFFLINE' : isAlert ? 'ALERT' : 'LIVE'}
                        </div>
                        {(cam.detections_today || 0) > 0 && <div className="cm-det-count">{cam.detections_today} today</div>}
                      </div>
                      <div className="cm-card-info">
                        <div className="cm-card-name">{cam.camera_id || cam.name}</div>
                        <div className="cm-card-zone">{cam.location}</div>
                        <div className="cm-card-footer">
                          <span className="cm-sens-badge" style={{color:SENS_COLORS[cam.metadata?.sensitivity||'medium'],background:`${SENS_COLORS[cam.metadata?.sensitivity||'medium']}18`,border:`1px solid ${SENS_COLORS[cam.metadata?.sensitivity||'medium']}33`}}>
                            {cam.metadata?.sensitivity || 'Medium'}
                          </span>
                          {isOffline && <span style={{fontSize:10,color:'#E24B4A'}}>Offline</span>}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {selected && (
            <div className="cm-side">
              <div className="cm-side-header">
                <span className="card-title">{selected.camera_id} · {selected.location}</span>
                <div className="cm-side-dot" style={{background:statusColor}}/>
              </div>
              <div className="cm-side-feed">
                {['inactive','offline'].includes(selected.status)
                  ? <span className="cm-offline-label">NO SIGNAL</span>
                  : <div className="cm-feed-lines" style={{padding:'14px 10px',gap:4,display:'flex',flexDirection:'column',height:'100%',justifyContent:'center',opacity:0.15}}>
                      {[...Array(6)].map((_,i) => <div key={i} className="cm-feed-line" style={{width:`${50+Math.sin(i*.8)*35}%`}}/>)}
                    </div>
                }
              </div>
              <div className="cm-side-body">
                {[
                  ['Status',    <span style={{color:statusColor,fontWeight:600}}>{selected.status}</span>],
                  ['Location',  selected.location || '—'],
                  ['Camera type', selected.camera_type || '—'],
                  ['Detections today', selected.detections_today || 0],
                ].map(([k, v]) => (
                  <div key={k} className="cm-meta-row">
                    <span className="cm-meta-key">{k}</span>
                    <span className="cm-meta-val">{v}</span>
                  </div>
                ))}
                <div className="cm-meta-section">Sensitivity</div>
                <div className="cm-sens-row">
                  {['low','medium','high'].map(s => (
                    <button key={s}
                      className={`cm-sens-btn ${sensitivity===s?'active':''}`}
                      style={sensitivity===s ? {borderColor:SENS_COLORS[s],color:SENS_COLORS[s],background:`${SENS_COLORS[s]}18`} : {}}
                      onClick={() => handleSensitivity(s)}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
                <button className="btn"
                  style={{width:'100%',marginTop:8,borderColor:'rgba(226,75,74,0.3)',color:'#E24B4A',background:'rgba(226,75,74,0.06)'}}
                  onClick={handleDeactivate}>
                  Deactivate camera
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}