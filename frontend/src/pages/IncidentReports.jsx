import { useState, useEffect } from 'react'
import { getAllReports, finaliseReport, submitToJDF } from '../services/reportService'
import { generateReportNarrative } from '../services/aiService'
import '../components/SharedStyles.css'
import './IncidentReports.css'

const STATUS_CONFIG = {
  submitted: { label: 'Submitted to JDF', color: '#4A9FE2', bg: 'rgba(74,159,226,0.12)' },
  final:     { label: 'Final',            color: '#22C55E', bg: 'rgba(34,197,94,0.12)'   },
  draft:     { label: 'Draft',            color: '#F5C518', bg: 'rgba(245,197,24,0.12)'  },
}
const TYPE_COLORS = { weapon:'#E24B4A', conflict:'#F5C518', intruder:'#4A9FE2', multi:'#9b8fef', single:'#9b8fef' }

export default function IncidentReports() {
  const [reports, setReports]   = useState([])
  const [selected, setSelected] = useState(null)
  const [filter, setFilter]     = useState('all')
  const [loading, setLoading]   = useState(true)
  const [genLoading, setGenLoading] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAllReports()
        const r = Array.isArray(data) ? data : []
        setReports(r)
        if (r.length > 0) setSelected(r[0])
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const handleFinalise = async () => {
    if (!selected) return
    await finaliseReport(selected.id, 'J. Green')
    const updated = reports.map(r => r.id===selected.id ? {...r,status:'final'} : r)
    setReports(updated)
    setSelected(prev => ({...prev,status:'final'}))
  }

  const handleSubmitJDF = async () => {
    if (!selected) return
    await submitToJDF(selected.id, 'J. Green')
    const updated = reports.map(r => r.id===selected.id ? {...r,status:'submitted'} : r)
    setReports(updated)
    setSelected(prev => ({...prev,status:'submitted'}))
  }

  const filtered = reports.filter(r => filter==='all' || r.status===filter)
  const sc = selected ? (STATUS_CONFIG[selected.status] || STATUS_CONFIG.draft) : null

  return (
    <div className="page-wrapper" style={{paddingRight:0}}>
      <div className="page-header ir-header">
        <div>
          <h1 className="page-title">Incident Reports</h1>
          <p className="page-subtitle">Auto-generated and manual incident documentation</p>
        </div>
      </div>

      <div className="ir-body">
        <div className="ir-list-pane">
          <div className="ir-filters">
            <select className="filter-select" style={{width:'100%'}} value={filter} onChange={e=>setFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="final">Final</option>
              <option value="submitted">Submitted to JDF</option>
            </select>
          </div>
          <div className="ir-list">
            {loading ? (
              <div style={{padding:20,fontSize:12,color:'var(--muted)',textAlign:'center'}}>Loading reports...</div>
            ) : filtered.length === 0 ? (
              <div style={{padding:20,fontSize:12,color:'var(--muted)',textAlign:'center'}}>No reports yet. Reports are auto-generated when you click "Generate Report" on an incident.</div>
            ) : filtered.map(r => {
              const s = STATUS_CONFIG[r.status] || STATUS_CONFIG.draft
              const color = TYPE_COLORS[r.type] || '#9b8fef'
              return (
                <div key={r.id} className={`ir-list-item ${selected?.id===r.id?'selected':''}`} style={{borderLeftColor:color}} onClick={()=>setSelected(r)}>
                  <div className="ir-item-top">
                    <span className="ir-item-id">{r.id}</span>
                    <span className="af-badge" style={{color:s.color,background:s.bg,fontSize:9}}>{s.label}</span>
                  </div>
                  <div className="ir-item-title">{r.title}</div>
                  <div className="ir-item-meta">{r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'} · {r.generatedBy}</div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="ir-detail page-content">
          {selected ? (
            <div className="card ir-doc">
              <div className="ir-doc-header">
                <div>
                  <div className="ir-doc-classification">
                    <span className="af-badge" style={{color:'#4A9FE2',background:'rgba(74,159,226,0.12)',fontSize:10}}>{selected.classification==='jdf_confidential'?'JDF CONFIDENTIAL':'INTERNAL'}</span>
                    <span style={{fontSize:10,color:'var(--muted)',marginLeft:6}}>{selected.id}</span>
                  </div>
                  <h2 className="ir-doc-title">{selected.title}</h2>
                  <p className="ir-doc-meta">Generated {selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '—'} · {selected.generatedBy}</p>
                </div>
                <div className="ir-doc-actions">
                  {selected.status === 'draft' && <button className="btn" style={{borderColor:'rgba(34,197,94,0.4)',color:'#22C55E',background:'rgba(34,197,94,0.06)'}} onClick={handleFinalise}>Finalise</button>}
                  {selected.status === 'final' && <button className="btn" style={{borderColor:'rgba(74,159,226,0.4)',color:'#4A9FE2',background:'rgba(74,159,226,0.06)'}} onClick={handleSubmitJDF}>Submit to JDF</button>}
                </div>
              </div>

              <div className="ir-section">
                <div className="ir-section-title">AI-generated incident summary</div>
                <div className="id-ai-block">
                  <div className="id-ai-label">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" stroke="#9b8fef" strokeWidth="1.8" strokeLinejoin="round"/></svg>
                    AI-generated · For operator guidance only
                  </div>
                  <p className="id-ai-text">{selected.aiSummary || 'No AI summary generated for this report.'}</p>
                </div>
              </div>

              <div className="ir-section">
                <div className="ir-section-title">Report details</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,padding:'0 0 4px'}}>
                  {[['Report ID',selected.id],['Type',selected.type||'single'],['Status',selected.status],['Generated by',selected.generatedBy],['Classification',selected.classification||'internal'],['Created',selected.createdAt?new Date(selected.createdAt).toLocaleString():'—']].map(([k,v])=>(
                    <div key={k} className="id-meta-item"><div className="id-meta-key">{k}</div><div className="id-meta-val">{v}</div></div>
                  ))}
                </div>
              </div>

              <div className="ir-section">
                <div className="ir-section-title">Signatures</div>
                <div className="ir-sigs">
                  <div className="ir-sig-box"><div className="ir-sig-label">Reviewing officer</div><div className="ir-sig-line">{selected.reviewedBy || 'Awaiting review'}</div></div>
                  <div className="ir-sig-box"><div className="ir-sig-label">Supervisor approval</div><div className="ir-sig-line ir-sig-pending">Awaiting signature</div></div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{padding:40,color:'var(--muted)',fontSize:13,textAlign:'center'}}>
              {loading ? 'Loading reports...' : 'Select a report from the list to view it.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
