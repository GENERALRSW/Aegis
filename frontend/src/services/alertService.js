import { get, post } from './api'

// ─── Alerts (/api/alerts) ─────────────────────────────────────────────────────
// Note: alerts are push notification records — not the same as events
// Use /api/events for CV detection events

/** List alerts — params: event_id?, limit?, skip? */
export const getAllAlerts = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return get(`/api/alerts${q ? '?' + q : ''}`)
}

export const getAlertById = (alertId) => get(`/api/alerts/${alertId}`)

/**
 * Send a push notification alert.
 * @param {object} payload - { event_id, title, body, target_tokens?, topic?, data? }
 */
export const sendAlert = (payload) => post('/api/alerts/send', payload)

// ─── Events (/api/events) ────────────────────────────────────────────────────
// CV detection events ingested from cameras

/**
 * Query events.
 * Params: camera_id?, event_type?, severity?, from_ts?, to_ts?, limit?, skip?
 * event_type: 'intruder' | 'weapon' | 'conflict' | 'motion' | 'unknown'
 * severity:   'low' | 'medium' | 'high' | 'critical'
 */
export const getAllEvents = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return get(`/api/events${q ? '?' + q : ''}`)
}

export const getEventById = (eventId) => get(`/api/events/${eventId}`)

/**
 * Ingest a detection event manually.
 * @param {object} payload - { camera_id, event_type, detections, frame_timestamp?, raw_metadata? }
 */
export const ingestEvent = (payload) => post('/api/events/ingest', payload)

// Convenience wrappers
export const getUnreviewedAlerts = (limit = 20) => getAllEvents({ severity: 'high', limit })
export const getAlertsByType     = (event_type)  => getAllEvents({ event_type })
export const getAlertsByCamera   = (camera_id)   => getAllEvents({ camera_id })
