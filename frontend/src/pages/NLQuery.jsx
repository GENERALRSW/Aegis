import { useState, useRef, useEffect } from 'react'
import { processNLQuery } from '../services/aiService'
import '../components/SharedStyles.css'
import './NLQuery.css'

const SUGGESTIONS = [
  { cat: 'Detections', items: ['Show me all weapon detections above 80% today', 'Which zone had the most conflicts this week?', 'List unreviewed high-risk events'] },
  { cat: 'Cameras',    items: ['Show cameras with no activity today', 'Which cameras have been offline longest?'] },
  { cat: 'Missing',    items: ['Show active missing person profiles', 'Any gait matches in the last hour?'] },
  { cat: 'Reports',    items: ["Generate today's incident summary", 'Show all events from the last 24 hours'] },
]

const HISTORY_KEY = 'aegis_query_history'
const loadHistory = () => JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
const saveHistory = (h) => localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 10)))

export default function NLQuery() {
  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [history, setHistory]     = useState(loadHistory)
  const bottomRef = useRef()

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const send = async (msg) => {
    if (!msg.trim() || loading) return
    setInput('')

    const userMsg = { role: 'user', text: msg }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    // Save to history
    const newHistory = [msg, ...history.filter(h => h !== msg)]
    setHistory(newHistory)
    saveHistory(newHistory)

    try {
      const resp = await processNLQuery(msg)
      const answer = typeof resp === 'string' ? resp : resp?.answer || resp?.response || JSON.stringify(resp)
      const results = Array.isArray(resp?.data) ? resp.data : []
      setMessages(prev => [...prev, { role: 'system', text: answer, results }])
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', text: `Error: ${err.message}. Please check your backend connection.`, results: [] }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-wrapper">
      <div className="page-header nq-header">
        <div>
          <h1 className="page-title">Intelligence Query</h1>
          <p className="page-subtitle">Ask anything about campus safety data in plain language</p>
        </div>
      </div>

      <div className="nq-body">
        <div className="nq-chat">
          <div className="nq-messages">
            {messages.length === 0 && (
              <div style={{textAlign:'center',padding:'40px 20px',color:'var(--muted)',fontSize:12}}>
                Ask a question to get started. Try "Show me all events today" or click a suggestion on the right.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`nq-msg nq-msg-${m.role}`}>
                {m.role === 'system' && <div className="nq-ai-avatar">AI</div>}
                <div className="nq-bubble">
                  <p className="nq-bubble-text">{m.text}</p>
                  {m.results?.length > 0 && (
                    <div className="nq-results">
                      <div className="nq-results-header">
                        <span>{m.results.length} results</span>
                      </div>
                      {m.results.slice(0, 5).map((r, ri) => (
                        <div key={ri} className="nq-result-row">
                          <span className="nq-result-badge" style={{color:'#E24B4A',background:'rgba(226,75,74,0.12)'}}>{r.event_type || r.type || 'event'}</span>
                          <span className="nq-result-cam">{r.camera_id || r.camera || '—'}</span>
                          {r.confidence && <span className="nq-result-conf" style={{color:'#E24B4A'}}>{Math.round(r.confidence*100)}%</span>}
                          <span className="nq-result-time">{r.created_at ? new Date(r.created_at).toLocaleTimeString() : '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {m.role === 'user' && <div className="nq-user-avatar">JG</div>}
              </div>
            ))}
            {loading && (
              <div className="nq-msg nq-msg-system">
                <div className="nq-ai-avatar">AI</div>
                <div className="nq-bubble nq-bubble-loading">
                  <div className="nq-dots"><span/><span/><span/></div>
                  <span style={{fontSize:11,color:'var(--muted)',marginLeft:6}}>Querying system...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef}/>
          </div>

          <div className="nq-input-area">
            <div className="nq-chips">
              {['Weapon detections today','Cameras offline now','High risk this week','Missing person matches'].map(s=>(
                <button key={s} className="nq-chip" onClick={()=>send(s)}>{s}</button>
              ))}
            </div>
            <div className="nq-input-row">
              <input className="nq-input" placeholder="Ask anything about campus safety data..."
                value={input} onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&send(input)}/>
              <button className="nq-send" onClick={()=>send(input)} disabled={!input.trim()||loading}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            </div>
          </div>
        </div>

        <div className="nq-side">
          {history.length > 0 && (
            <div className="nq-side-section">
              <div className="nq-side-title">Query history</div>
              {history.map((h, i)=>(
                <button key={i} className="nq-history-chip" onClick={()=>send(h)}>{h}</button>
              ))}
            </div>
          )}
          {SUGGESTIONS.map(sg=>(
            <div key={sg.cat} className="nq-side-section">
              <div className="nq-side-cat">{sg.cat}</div>
              {sg.items.map((item,i)=>(
                <button key={i} className="nq-suggest-item" onClick={()=>send(item)}>{item}</button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
