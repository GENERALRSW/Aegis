import { useState, useEffect } from 'react'
import { getTodayStats, getWeekStats, getDailyTrend, getDetectionsByZone, getModelPerformance } from '../services/analyticsService'
import '../components/SharedStyles.css'
import './Analytics.css'

const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const MAX_VAL = 30

function heatColor(v) {
  if (v <= 2) return 'rgba(26,122,74,0.15)'
  if (v <= 4) return 'rgba(26,122,74,0.4)'
  if (v <= 6) return 'rgba(245,197,24,0.5)'
  if (v <= 8) return 'rgba(226,75,74,0.7)'
  return 'rgba(226,75,74,0.95)'
}

export default function Analytics() {
  const [range, setRange]       = useState('7days')
  const [stats, setStats]       = useState({ total:0, weapon:0, conflict:0, intruder:0 })
  const [trend, setTrend]       = useState({})
  const [zones, setZones]       = useState([])
  const [models, setModels]     = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [s, t, z, m] = await Promise.all([
          range === 'today' ? getTodayStats() : getWeekStats(),
          getDailyTrend(range === 'today' ? 1 : 7),
          getDetectionsByZone(new Date(Date.now() - 7*86400000).toISOString().split('T')[0]),
          getModelPerformance(),
        ])
        setStats(s || { total:0, weapon:0, conflict:0, intruder:0 })
        setTrend(t || {})
        setZones(Array.isArray(z) ? z : [])
        setModels(Array.isArray(m) ? m : [])
      } catch (err) { console.error('Analytics error:', err) }
      finally { setLoading(false) }
    }
    load()
  }, [range])

  const maxZone = Math.max(...zones.map(z=>z.count), 1)
  const weaponData  = DAYS.map(d => trend[d]?.weapon   || 0)
  const conflictData= DAYS.map(d => trend[d]?.conflict  || 0)
  const intruderData= DAYS.map(d => trend[d]?.intruder  || 0)
  const maxBar = Math.max(...weaponData, ...conflictData, ...intruderData, 1)

  return (
    <div className="page-wrapper">
      <div className="page-header an-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p className="page-subtitle">Detection patterns and model performance intelligence</p>
        </div>
        <div className="an-header-right">
          <select className="filter-select" value={range} onChange={e=>setRange(e.target.value)}>
            <option value="today">Today</option>
            <option value="7days">Last 7 days</option>
          </select>
          <button className="btn">Export report</button>
        </div>
      </div>

      <div className="page-content">
        {loading ? (
          <div style={{padding:40,color:'var(--muted)',fontSize:13,textAlign:'center'}}>Loading analytics...</div>
        ) : (
          <>
            <div className="an-stats">
              {[['Total detections',stats.total,null,null],['Weapons',stats.weapon,'#E24B4A',null],['Conflicts',stats.conflict,'#F5C518',null],['Intruders',stats.intruder,'#4A9FE2',null]].map(([l,v,c])=>(
                <div key={l} className="card an-stat">
                  <div className="an-stat-label">{l}</div>
                  <div className="an-stat-val" style={c?{color:c}:{}}>{v}</div>
                </div>
              ))}
            </div>

            <div className="an-row2">
              <div className="card an-chart-card">
                <div className="id-card-header">
                  <span className="card-title">Detection trends</span>
                  <div className="an-legend">
                    {[['Weapon','#E24B4A'],['Conflict','#F5C518'],['Intruder','#4A9FE2']].map(([l,c])=>(
                      <div key={l} className="an-legend-item"><div style={{width:8,height:3,background:c,borderRadius:2}}/><span>{l}</span></div>
                    ))}
                  </div>
                </div>
                <div className="an-chart-body">
                  <div className="an-bars">
                    {DAYS.map((day, i) => (
                      <div key={day} className="an-bar-group">
                        <div className="an-bar-col">
                          {[[weaponData,'#E24B4A'],[conflictData,'#F5C518'],[intruderData,'#4A9FE2']].map(([data,color],j)=>(
                            <div key={j} className="an-bar" style={{height:`${(data[i]/maxBar)*100}%`,background:color}}/>
                          ))}
                        </div>
                        <div className="an-bar-label">{day}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="card an-donut-card">
                <div className="id-card-header"><span className="card-title">Breakdown</span></div>
                <div className="an-donut-body">
                  <svg width="110" height="110" viewBox="0 0 110 110">
                    <circle cx="55" cy="55" r="44" fill="none" stroke="#2a2a2a" strokeWidth="12"/>
                    {stats.total > 0 && <>
                      <circle cx="55" cy="55" r="44" fill="none" stroke="#4A9FE2" strokeWidth="12"
                        strokeDasharray={`${(stats.intruder/stats.total)*276} ${276-(stats.intruder/stats.total)*276}`}
                        style={{transform:'rotate(-90deg)',transformOrigin:'55px 55px'}}/>
                      <circle cx="55" cy="55" r="44" fill="none" stroke="#F5C518" strokeWidth="12"
                        strokeDasharray={`${(stats.conflict/stats.total)*276} ${276-(stats.conflict/stats.total)*276}`}
                        strokeDashoffset={`-${(stats.intruder/stats.total)*276}`}
                        style={{transform:'rotate(-90deg)',transformOrigin:'55px 55px'}}/>
                      <circle cx="55" cy="55" r="44" fill="none" stroke="#E24B4A" strokeWidth="12"
                        strokeDasharray={`${(stats.weapon/stats.total)*276} ${276-(stats.weapon/stats.total)*276}`}
                        strokeDashoffset={`-${((stats.intruder+stats.conflict)/stats.total)*276}`}
                        style={{transform:'rotate(-90deg)',transformOrigin:'55px 55px'}}/>
                    </>}
                    <text x="55" y="50" textAnchor="middle" fill="white" fontSize="18" fontWeight="700" fontFamily="var(--font-mono)">{stats.total}</text>
                    <text x="55" y="64" textAnchor="middle" fill="#666" fontSize="9" fontFamily="var(--font-sans)">total</text>
                  </svg>
                  <div className="an-donut-legend">
                    {[['Intruder',stats.intruder,'#4A9FE2'],['Conflict',stats.conflict,'#F5C518'],['Weapon',stats.weapon,'#E24B4A']].map(([l,v,c])=>(
                      <div key={l} className="an-dl-item"><div style={{width:10,height:10,borderRadius:2,background:c,flexShrink:0}}/><span>{l}</span><span className="an-dl-val">{v}</span></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {zones.length > 0 && (
              <div className="card" style={{marginTop:12}}>
                <div className="id-card-header"><span className="card-title">Zone comparison</span></div>
                <div style={{padding:'12px 14px',display:'flex',flexDirection:'column',gap:8}}>
                  {zones.slice(0,6).map(z=>(
                    <div key={z.zone} className="an-zone-row">
                      <div className="an-zone-label">{z.zone}</div>
                      <div className="an-zone-track"><div style={{width:`${Math.round((z.count/maxZone)*100)}%`,height:'100%',background:'#E24B4A',borderRadius:4,transition:'width 0.5s ease'}}/></div>
                      <div className="an-zone-count">{z.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {models.length > 0 && (
              <div className="card" style={{marginTop:12}}>
                <div className="id-card-header"><span className="card-title">Model performance</span></div>
                <div className="an-models">
                  {models.map(m=>(
                    <div key={m.type} className="an-model-card">
                      <div className="an-model-name">{m.type?.charAt(0).toUpperCase()+m.type?.slice(1)} Detection</div>
                      {[['Total',m.total],['Verified',m.verified,{color:'#22C55E'}],['False positives',m.fp,{color:'#E24B4A'}],['Accuracy',m.accuracy+'%',{fontWeight:600}]].map(([k,v,s])=>(
                        <div key={k} className="an-model-row"><span className="mp-detail-key">{k}</span><span style={{fontSize:12,color:'var(--text)',fontFamily:'var(--font-sans)',...(s||{})}}>{v}</span></div>
                      ))}
                      <div className="an-acc-bar"><div style={{width:m.accuracy+'%',height:'100%',background:m.accuracy>=80?'#22C55E':'#F5C518',borderRadius:2}}/></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
