// ─── reportService.js ─────────────────────────────────────────────────────────
// Reports are generated client-side from event data + AI summaries.
// Stored in localStorage for the hackathon; swap to a reports endpoint when ready.
import { get } from './api'

const STORE_KEY = 'aegis_reports'

const load = () => JSON.parse(localStorage.getItem(STORE_KEY) || '[]')
const save = (reports) => localStorage.setItem(STORE_KEY, JSON.stringify(reports))

/** Fetch all reports */
export const getAllReports = async () => load()

/** Fetch single report by ID */
export const getReportById = async (id) =>
  load().find(r => r.id === id) || null

/** Fetch by status */
export const getReportsByStatus = async (status) =>
  load().filter(r => r.status === status)

/** Create a new report */
export const createReport = async (reportData, generatedBy = 'auto') => {
  const id = `RPT-${Date.now()}`
  const report = {
    ...reportData,
    id,
    generatedBy,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const reports = load()
  reports.unshift(report)
  save(reports)
  return id
}

/** Update report status */
const updateReport = (id, updates) => {
  const reports = load().map(r =>
    r.id === id ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r
  )
  save(reports)
}

/** Finalise a draft */
export const finaliseReport = (id, reviewedBy) =>
  updateReport(id, { status: 'final', reviewedBy })

/** Mark as submitted to JDF */
export const submitToJDF = (id, officerId) =>
  updateReport(id, {
    status: 'submitted',
    submittedBy: officerId,
    submittedAt: new Date().toISOString(),
  })

/** Update AI summary */
export const updateAISummary = (id, aiSummary) =>
  updateReport(id, { aiSummary })
