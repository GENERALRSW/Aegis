import { get, put } from './api'

// ─── Core events ─────────────────────────────────────────────────────────────

export const getEvents = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return get(`/api/events${q ? '?' + q : ''}`)
}

// ─── Dashboard endpoints (new) ────────────────────────────────────────────────

/**
 * Aggregate stats — total events, by type, by severity for last N hours.
 * Returns: { total_events, by_type: {}, by_severity: {}, ... }
 * @param {number} hours — 1-168, default 24
 */
export const getDashboardStats = (hours = 24) =>
  get(`/api/dashboard/stats?hours=${hours}`)

/**
 * Heatmap data — event density per camera for visualization.
 * Returns array of { camera_id, location, count, lat?, lng?, ... }
 * @param {number} hours — 1-168, default 24
 */
export const getHeatmapData = (hours = 24) =>
  get(`/api/dashboard/heatmap?hours=${hours}`)

/**
 * Timeline — events bucketed by hour.
 * Returns array of { hour, count, by_type: {} }
 * @param {number} hours — 1-168, default 24
 * @param {string} camera_id — optional filter
 */
export const getTimeline = (hours = 24, camera_id = null) => {
  const q = new URLSearchParams({ hours, ...(camera_id ? { camera_id } : {}) }).toString()
  return get(`/api/dashboard/timeline?${q}`)
}

// ─── Paginated total count ────────────────────────────────────────────────────

export const getTotalEventCount = async () => {
  // Use dashboard stats if available — much faster than paginating
  try {
    const stats = await getDashboardStats(168) // 7 days
    if (typeof stats?.total_events === 'number') return stats.total_events
  } catch {}
  // Fallback: paginate events
  let total = 0, skip = 0
  const limit = 500
  while (true) {
    const batch = await get(`/api/events?limit=${limit}&skip=${skip}`)
    if (!Array.isArray(batch) || batch.length === 0) break
    total += batch.length
    if (batch.length < limit) break
    skip += limit
  }
  return total
}

// ─── Today stats ─────────────────────────────────────────────────────────────

export const getTodayStats = async () => {
  // Try dashboard stats endpoint first
  try {
    const stats = await getDashboardStats(24)
    if (stats?.total_events !== undefined) {
      return {
        total:    stats.total_events    || 0,
        weapon:   stats.by_type?.weapon   || 0,
        conflict: stats.by_type?.conflict || 0,
        intruder: stats.by_type?.intruder || 0,
        motion:   stats.by_type?.motion   || 0,
      }
    }
  } catch {}
  // Fallback: query events directly
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const events = await get(`/api/events?limit=500&from_ts=${start.toISOString()}`)
  return aggregateByType(Array.isArray(events) ? events : [])
}

export const getWeekStats = async () => {
  try {
    const stats = await getDashboardStats(168)
    if (stats?.total_events !== undefined) return {
      total:    stats.total_events    || 0,
      weapon:   stats.by_type?.weapon   || 0,
      conflict: stats.by_type?.conflict || 0,
      intruder: stats.by_type?.intruder || 0,
    }
  } catch {}
  const from = new Date(Date.now() - 7 * 86400000)
  const events = await get(`/api/events?limit=500&from_ts=${from.toISOString()}`)
  return aggregateByType(Array.isArray(events) ? events : [])
}

// ─── Legacy helpers (kept for backwards compat) ───────────────────────────────

export const getDetectionsByZone = async (from_ts) => {
  try {
    const data = await getHeatmapData(24)
    if (Array.isArray(data)) {
      return data.map(d => ({ zone: d.location || d.camera_id, count: d.count }))
                 .sort((a, b) => b.count - a.count)
    }
  } catch {}
  const events = await get(`/api/events?limit=500${from_ts ? '&from_ts=' + from_ts : ''}`)
  const zoneMap = {}
  ;(Array.isArray(events) ? events : []).forEach(e => {
    const zone = e.raw_metadata?.zone || e.location || e.camera_id || 'Unknown'
    zoneMap[zone] = (zoneMap[zone] || 0) + 1
  })
  return Object.entries(zoneMap).map(([zone, count]) => ({ zone, count })).sort((a,b) => b.count - a.count)
}

export const getDailyTrend = async (days = 7) => {
  try {
    const data = await getTimeline(days * 24)
    if (Array.isArray(data) && data.length > 0) return data
  } catch {}
  const from = new Date(Date.now() - days * 86400000)
  const events = await get(`/api/events?limit=500&from_ts=${from.toISOString()}`)
  const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const trend = {}
  ;(Array.isArray(events) ? events : []).forEach(e => {
    const label = dayLabels[new Date(e.timestamp).getDay()]
    if (!trend[label]) trend[label] = { weapon:0, conflict:0, intruder:0 }
    const t = e.event_type?.toLowerCase()
    if (trend[label][t] !== undefined) trend[label][t]++
  })
  return trend
}

export const getModelPerformance = async () => {
  const events = await get('/api/events?limit=500')
  const stats = { weapon:{total:0,high:0,low:0}, conflict:{total:0,high:0,low:0}, intruder:{total:0,high:0,low:0} }
  ;(Array.isArray(events) ? events : []).forEach(e => {
    const t = e.event_type?.toLowerCase()
    if (!stats[t]) return
    stats[t].total++
    if (['high','critical'].includes(e.severity)) stats[t].high++
    else stats[t].low++
  })
  return Object.entries(stats).map(([type, s]) => ({
    type, total: s.total, verified: s.high, fp: s.low,
    accuracy: s.total > 0 ? Math.round((s.high / s.total) * 100) : 0,
  }))
}

export const getAuditLog = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return get(`/api/security/audit${q ? '?' + q : ''}`)
}

export const acknowledgeAuditEntry = (logId) =>
  put(`/api/security/audit/${logId}/acknowledge`)

export const getAllEventsDB = async () => {
  const all = []
  let skip = 0
  const limit = 500
  while (true) {
    const batch = await get(`/api/events?limit=${limit}&skip=${skip}`)
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < limit) break
    skip += limit
  }
  return all
}

// ─── helper ───────────────────────────────────────────────────────────────────
const aggregateByType = (events = []) => {
  const s = { weapon:0, conflict:0, intruder:0, motion:0, unknown:0, total:0 }
  events.forEach(e => {
    const t = e.event_type?.toLowerCase() || 'unknown'
    s[t] = (s[t] || 0) + 1
    s.total++
  })
  return s
}