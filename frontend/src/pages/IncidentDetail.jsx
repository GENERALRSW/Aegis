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

  const confidence = Math.round((event.confidence || 0) * 100)
  const eventType  = event.event_type || 'unknown'
  const detections = event.detections || []
  const time       = event.created_at ? new Date(event.created_at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—'

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
              </div>
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
            </div>

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
