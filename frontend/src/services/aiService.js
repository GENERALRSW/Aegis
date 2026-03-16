import { get, post } from './api'

// ─── CV Detection ─────────────────────────────────────────────────────────────
export const detectJSON = (payload) => post('/api/cv/detect/json', payload)
export const getCVStatus = () => get('/api/cv/status')

// ─── NL Query — backend calls Gemini, returns answer ─────────────────────────
export const processNLQuery = (question) =>
  post('/api/cv/query', { question })

// ─── Incident summary — ask the backend LLM ──────────────────────────────────
export const generateIncidentSummary = (event) =>
  post('/api/cv/query', {
    question:
      `Generate a brief professional incident summary (max 80 words) for a security event. ` +
      `Event type: ${event.event_type}. Camera: ${event.camera_id}. ` +
      `Severity: ${event.severity}. Risk score: ${event.risk_score}. ` +
      `Timestamp: ${event.timestamp}. ` +
      `CV summary: ${event.summary || 'none'}. ` +
      `Detections: ${JSON.stringify(event.detections || [])}. ` +
      `End with a recommended action.`,
  }).then(res => res?.answer || res?.response || event.summary || 'No summary available.')

// ─── Report narrative — ask the backend LLM ───────────────────────────────────
export const generateReportNarrative = (events, type = 'single') =>
  post('/api/cv/query', {
    question:
      `Generate a professional security incident report in third person for ${events.length} event(s). ` +
      `Include: summary, timeline, detections, recommendations. Max 300 words. ` +
      `Start with [AI-GENERATED REPORT]. Events: ` +
      events.map((e, i) =>
        `${i + 1}. ${e.event_type} | Camera: ${e.camera_id} | Severity: ${e.severity} | Risk: ${e.risk_score} | ${e.timestamp}`
      ).join('; '),
  }).then(res => res?.answer || res?.response || 'Report generation failed.')

// ─── Combined risk assessment — ask the backend LLM ──────────────────────────
export const assessCombinedRisk = (events) =>
  post('/api/cv/query', {
    question:
      `Assess the combined threat level from these simultaneous detections and respond with ONLY a JSON object: ` +
      `{ "riskLevel": "LOW|MEDIUM|HIGH|CRITICAL", "score": 0-100, "reasoning": "string", "recommendedAction": "string" }. ` +
      `Detections: ${JSON.stringify(events)}`,
  }).then(res => {
    const text = res?.answer || res?.response || ''
    try {
      const match = text.match(/\{[\s\S]*\}/)
      return match ? JSON.parse(match[0]) : { riskLevel: 'UNKNOWN', score: 0, reasoning: text, recommendedAction: 'Manual review required' }
    } catch {
      return { riskLevel: 'UNKNOWN', score: 0, reasoning: text, recommendedAction: 'Manual review required' }
    }
  })