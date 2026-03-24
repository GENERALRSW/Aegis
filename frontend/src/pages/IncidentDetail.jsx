import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getEventById } from '../services/alertService'
import { generateIncidentSummary } from '../services/aiService'
import { createReport } from '../services/reportService'
import '../components/SharedStyles.css'
import './IncidentDetail.css'

const STATUS_OPTS = ['unreviewed','verified','escalated','fp']
const TIMELINE_COLORS = { danger:'#E24B4A', warning:'#F5C518', success:'#22C55E' }

export default function IncidentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [event, setEvent]         = useState(null)
  const [status, setStatus]       = useState('unreviewed')
  const [notes, setNotes]         = useState('')
  const [aiSummary, setAiSummary] = useState('')
  const [loadingAI, setLoadingAI] = useState(false)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getEventById(id)
        setEvent(data)
        setStatus(data?.status || 'unreviewed')
        // Auto-generate AI summary
        if (data) {
          setLoadingAI(true)
          try {
            const summary = await generateIncidentSummary(data)
            setAiSummary(summary)
          } catch { setAiSummary('Unable to generate summary. Please review manually.') }
          finally { setLoadingAI(false) }
        }
      } catch (err) {
        console.error('IncidentDetail error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const handleGenerateReport = async () => {
    if (!event) return
    await createReport({ title: `${event.event_type} — ${event.location}`, alertIds: [id], aiSummary, type: 'single', classification: 'internal' })
    navigate('/reports')
  }

  if (loading) return <div className="page-wrapper"><div style={{padding:40,color:'var(--muted)',fontSize:13}}>Loading incident...</div></div>
  if (!event)  return <div className="page-wrapper"><div style={{padding:40,color:'var(--muted)',fontSize:13}}>Incident not found.</div></div>

  const confidence       = Math.round((event.confidence || 0) * 100)
  const eventType        = event.event_type || 'unknown'
  const detections       = event.detections || []
  const time             = event.created_at ? new Date(event.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—'
  const securityAlerts   = event.security_alerts || []
  const authorizedIds    = event.authorized_identities || []
  const visitorSummaries = event.visitor_summaries || []
  const allIdentities    = [...securityAlerts, ...authorizedIds, ...visitorSummaries]

  const IDENTITY_CLASS_STYLE = {
    authorized:           { color: 'var(--online)',   bg: 'rgba(34,197,94,0.12)',   label: 'Authorized' },
    visitor:              { color: 'var(--muted)',    bg: 'rgba(102,102,102,0.12)', label: 'Visitor' },
    intruder:             { color: 'var(--weapon)',   bg: 'rgba(226,75,74,0.12)',   label: 'Intruder' },
    unidentified_intruder:{ color: 'var(--weapon)',   bg: 'rgba(226,75,74,0.12)',   label: 'Intruder' },
    missing_person_match: { color: '#F59E0B',          bg: 'rgba(245,158,11,0.12)', label: 'Missing Person' },
  }

  return (
    <div className="page-wrapper">
      <div className="id-breadcrumb">
        <button className="id-back" onClick={()=>navigate('/alerts')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          Alert Feed
        </button>
        <span className="id-sep">/</span>
        <span className="id-crumb-active">Incident #{id}</span>
        <div className="id-header-actions">
          <select className="filter-select id-status-select" value={status} onChange={e=>setStatus(e.target.value)}
            style={{borderColor: status==='unreviewed'?'rgba(245,197,24,0.4)':status==='verified'?'rgba(34,197,94,0.4)':'rgba(226,75,74,0.4)'}}>
            {STATUS_OPTS.map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
          </select>
          <button className="btn" style={{borderColor:'rgba(226,75,74,0.4)',color:'#E24B4A',background:'rgba(226,75,74,0.06)'}}>Escalate to JDF</button>
          <button className="btn btn-primary" onClick={handleGenerateReport}>Generate Report</button>
        </div>
      </div>

      <div className="page-content">
        <div className="id-grid">
          <div className="id-left">
            <div className="card id-player-card">
              <div className="id-card-header">
                <span className="card-title">Flagged clip — {event.camera_id} · {event.location}</span>
                <span style={{fontSize:11,color:'var(--muted)'}}>{time}</span>
              </div>
              <div className="id-player">
                <div className="id-player-lines">{[...Array(8)].map((_,i)=><div key={i} className="id-player-line" style={{width:`${55+Math.sin(i*.9)*35}%`}}/>)}</div>
                <div className="id-bbox"><span className="id-bbox-label">{eventType} · {confidence}%</span></div>
                <div className="id-conf-overlay">CV Model · {confidence}% confidence</div>
                {event.glare_detected && (
                  <div style={{position:'absolute',top:6,right:6,padding:'2px 8px',background:'rgba(245,158,11,0.15)',border:'1px solid rgba(245,158,11,0.4)',borderRadius:4,fontSize:10,color:'#F59E0B',fontFamily:'var(--font-mono)',fontWeight:600}}>
                    ⚡ Glare — gait-priority mode
                  </div>
                )}
              </div>
              {event.clip_path && (
                <div style={{padding:'8px 12px',display:'flex',alignItems:'center',gap:8,fontSize:11,fontFamily:'var(--font-sans)',borderTop:'1px solid var(--border)'}}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="var(--muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span style={{color:'var(--muted)'}}>Evidence clip:</span>
                  <a href={`/api/incidents/clip?path=${encodeURIComponent(event.clip_path)}`} download
                    style={{color:'#4A9FE2',textDecoration:'none',fontFamily:'var(--font-mono)'}}>
                    {event.clip_path.split('/').pop()}
                  </a>
                </div>
              )}
              <div className="id-controls">
                <button className="id-play-btn"><svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M5 3l14 9-14 9V3z" fill="white"/></svg></button>
                <span className="id-time">0.0s / —</span>
                <div className="id-scrubber"><div className="id-scrubber-fill"/></div>
                {['0.5x','1x','2x'].map(s=><button key={s} className={`id-speed ${s==='1x'?'active':''}`}>{s}</button>)}
              </div>
            </div>

            <div className="card">
              <div className="id-card-header"><span className="card-title">Detection breakdown</span></div>
              <table className="id-table">
                <thead><tr>{['Detection type','Model','Confidence','Frames'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {detections.length > 0 ? detections.map((d,i)=>(
                    <tr key={i}>
                      <td>{d.label || d.type || eventType}</td>
                      <td style={{color:'var(--muted)'}}>{d.model || 'YOLOv8'}</td>
                      <td style={{color:d.confidence>=0.8?'#E24B4A':d.confidence>=0.6?'#F5C518':'#4A9FE2',fontWeight:600}}>{Math.round((d.confidence||0)*100)}%</td>
                      <td style={{color:'var(--muted)'}}>{d.frame_count || '—'}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={4} style={{color:'var(--muted)',textAlign:'center',padding:'12px 0'}}>No detection breakdown available</td></tr>
                  )}
                </tbody>
              </table>
              <div className="id-risk-row">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#E24B4A" strokeWidth="1.8"/></svg>
                <span>Confidence: <strong style={{color: confidence>=80?'#E24B4A':confidence>=60?'#F5C518':'#4A9FE2'}}>{confidence}%</strong></span>
              </div>
              {event.frame_quality && (
                <details style={{marginTop:8,fontSize:11,color:'var(--muted)',fontFamily:'var(--font-sans)'}}>
                  <summary style={{cursor:'pointer',userSelect:'none',padding:'4px 0'}}>Frame quality</summary>
                  <div style={{marginTop:6,display:'flex',flexDirection:'column',gap:4,paddingLeft:8}}>
                    <span>Mean luminance: {event.frame_quality.mean_luminance?.toFixed(0) ?? '—'} / 255</span>
                    <span>Glare fraction: {((event.frame_quality.glare_fraction ?? 0) * 100).toFixed(1)}%</span>
                    {event.frame_quality.is_overexposed && <span style={{color:'#F59E0B'}}>⚡ Overexposed</span>}
                    {event.frame_quality.is_dark && <span style={{color:'#6B7280'}}>🌑 Underexposed</span>}
                  </div>
                </details>
              )}
            </div>

            {allIdentities.length > 0 && (
              <div className="card">
                <div className="id-card-header"><span className="card-title">Identity analysis</span></div>
                {event.fr_operational === false && (
                  <div style={{margin:'8px 0 12px',padding:'8px 12px',background:'rgba(245,197,24,0.08)',border:'1px solid rgba(245,197,24,0.2)',borderRadius:'var(--radius-sm)',fontSize:11,color:'#F5C518',fontFamily:'var(--font-sans)'}}>
                    ⚠ Facial recognition was offline for this detection — classification based on behaviour only
                  </div>
                )}
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {allIdentities.map((entry, i) => {
                    const cls = entry.identity_classification || (entry.alert_type === 'authorized_person' ? 'authorized' : entry.alert_type === 'visitor' ? 'visitor' : 'intruder')
                    const style = IDENTITY_CLASS_STYLE[cls] || IDENTITY_CLASS_STYLE.intruder
                    const matchType = entry.match_type || 'none'
                    const matchLabel = matchType === 'face' ? 'FACE MATCH' : matchType === 'gait' ? 'GAIT MATCH' : matchType === 'combined' ? 'COMBINED' : null
                    return (
                      <div key={i} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 12px',background:'var(--elevated)',borderRadius:'var(--radius-sm)',border:'1px solid var(--border)'}}>
                        <span style={{padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:600,background:style.bg,color:style.color,whiteSpace:'nowrap',fontFamily:'var(--font-mono)'}}>
                          {style.label}
                        </span>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                            <div style={{fontSize:12,color:'var(--text)',fontFamily:'var(--font-sans)',fontWeight:500}}>{entry.person_name || 'Unknown'}</div>
                            {(entry.fused_confidence ?? entry.face_confidence) != null && (
                              <span style={{fontSize:12,fontWeight:700,color:style.color,fontFamily:'var(--font-mono)'}}>
                                {Math.round(((entry.fused_confidence ?? entry.face_confidence) * 100))}%
                              </span>
                            )}
                          </div>
                          <div style={{fontSize:10,color:'var(--muted)',fontFamily:'var(--font-sans)',marginTop:2,textTransform:'capitalize'}}>{entry.alert_type?.replace(/_/g,' ')}</div>
                          {entry.fused_confidence != null && (() => {
                            const fPct = Math.round(entry.fused_confidence * 100)
                            const barCol = fPct >= 80 ? '#22C55E' : fPct >= 60 ? '#F5C518' : '#E24B4A'
                            return (
                              <div style={{marginTop:6}}>
                                <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--muted)',fontFamily:'var(--font-sans)',marginBottom:3}}>
                                  <span>Fused</span>
                                  <span style={{color:barCol,fontWeight:600}}>{fPct}%</span>
                                </div>
                                <div style={{height:4,borderRadius:2,background:'var(--elevated)',overflow:'hidden'}}>
                                  <div style={{height:'100%',width:`${fPct}%`,background:barCol,borderRadius:2}}/>
                                </div>
                              </div>
                            )
                          })()}
                          {(entry.face_confidence != null || entry.gait_confidence != null) && (
                            <div style={{display:'flex',gap:8,marginTop:5,flexWrap:'wrap'}}>
                              <span style={{fontSize:10,color:'var(--text-sub)',fontFamily:'var(--font-sans)'}}>
                                Face: {entry.face_confidence != null ? `${Math.round(entry.face_confidence*100)}%` : '—'}
                              </span>
                              <span style={{fontSize:10,color:'var(--text-sub)',fontFamily:'var(--font-sans)'}}>
                                Gait: {entry.gait_confidence != null ? `${Math.round(entry.gait_confidence*100)}%` : '—'}
                              </span>
                            </div>
                          )}
                          {entry._maintained && (
                            <div style={{marginTop:5,fontSize:10,color:'var(--muted)',fontFamily:'var(--font-sans)',padding:'2px 6px',background:'var(--dim)',borderRadius:3,display:'inline-block'}}>
                              Smoothed — held from prior frames
                            </div>
                          )}
                          {entry.extra?.partial_match && (
                            <div style={{marginTop:5,padding:'4px 8px',background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.25)',borderRadius:'var(--radius-sm)',fontSize:10,color:'#F59E0B',fontFamily:'var(--font-sans)'}}>
                              Low-confidence partial match — manual review required
                            </div>
                          )}
                        </div>
                        {matchLabel && (
                          <span style={{padding:'2px 6px',borderRadius:4,fontSize:9,fontWeight:700,background:'var(--dim)',color:'var(--text-sub)',whiteSpace:'nowrap',fontFamily:'var(--font-mono)'}}>
                            {matchLabel}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="card">
              <div className="id-card-header"><span className="card-title">Action history</span></div>
              <div className="id-timeline">
                <div className="id-tl-row"><div className="id-tl-dot" style={{background:'#E24B4A'}}/><div><div className="id-tl-text">Event ingested by CV system</div><div className="id-tl-time">{time}</div></div></div>
                <div className="id-tl-row"><div className="id-tl-dot" style={{background:'#F5C518'}}/><div><div className="id-tl-text">Alert assigned for review</div><div className="id-tl-time">{time}</div></div></div>
              </div>
            </div>
          </div>

          <div className="id-right">
            <div className="card">
              <div className="id-card-header">
                <span className="card-title">AI-generated summary</span>
                <button className="btn" style={{padding:'3px 8px',fontSize:10}} onClick={async()=>{setLoadingAI(true);try{const s=await generateIncidentSummary(event);setAiSummary(s)}finally{setLoadingAI(false)}}}>Regenerate</button>
              </div>
              <div className="id-ai-block">
                <div className="id-ai-label">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" stroke="#9b8fef" strokeWidth="1.8" strokeLinejoin="round"/></svg>
                  AI-generated · For operator guidance only
                </div>
                <p className="id-ai-text">{loadingAI ? 'Generating summary...' : aiSummary || 'No summary available.'}</p>
              </div>
              <textarea className="id-notes" placeholder="Add field notes here..." value={notes} onChange={e=>setNotes(e.target.value)} rows={3}/>
            </div>

            <div className="card">
              <div className="id-card-header"><span className="card-title">Incident metadata</span></div>
              <div className="id-meta-grid">
                {[
                  ['Camera', event.camera_id || '—'],
                  ['Location', event.location || '—'],
                  ['Timestamp', time],
                  ['Event Type', event.event_type || '—'],
                  ['Confidence', <span style={{color:confidence>=80?'#E24B4A':confidence>=60?'#F5C518':'#4A9FE2',fontWeight:600}}>{confidence}%</span>],
                  ['Event ID', id?.slice(0,12)+'...'],
                ].map(([k,v])=>(
                  <div key={k} className="id-meta-item">
                    <div className="id-meta-key">{k}</div>
                    <div className="id-meta-val">{v}</div>
                  </div>
                ))}
              </div>
              {event.glare_detected && (
                <div style={{marginTop:8,padding:'6px 10px',background:'rgba(245,158,11,0.08)',border:'1px solid rgba(245,158,11,0.25)',borderRadius:'var(--radius-sm)',fontSize:11,color:'#F59E0B',fontFamily:'var(--font-sans)'}}>
                  ⚡ Glare — gait-priority mode active during this detection
                </div>
              )}
              <div className="id-map">
                <div className="id-map-grid"/>
                <div className="id-map-pin"/>
                <span className="id-map-label">{event.location} — {event.camera_id}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="id-bottom-bar">
        <button className="btn">Save changes</button>
        <button className="btn">Mark false positive</button>
        <button className="btn" style={{borderColor:'rgba(34,197,94,0.4)',color:'#22C55E',background:'rgba(34,197,94,0.06)'}}>Verify incident</button>
        <button className="btn" style={{borderColor:'rgba(226,75,74,0.4)',color:'#E24B4A',background:'rgba(226,75,74,0.06)',marginLeft:'auto'}}>Escalate to JDF</button>
        <button className="btn btn-primary" onClick={handleGenerateReport}>Generate report</button>
      </div>
    </div>
  )
}
