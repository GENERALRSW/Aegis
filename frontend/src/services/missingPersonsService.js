import { get, post, put, del, getToken } from './api'

const BASE_URL = import.meta.env.VITE_API_URL || ''

// ─── Multipart helpers ────────────────────────────────────────────────────────

const multipartRequest = async (method, path, formData) => {
  const token = getToken()

  if (!token) throw new Error('Not authenticated — please log in again.')

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      // Do NOT set Content-Type — browser sets it with boundary automatically
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  })

  if (res.status === 401) throw new Error('Session expired — please log in again.')

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.detail?.[0]?.msg || err?.detail || `Request failed: ${res.status}`)
  }

  return res.json()
}

const postForm = (path, formData) => multipartRequest('POST', path, formData)
const putForm  = (path, formData) => multipartRequest('PUT',  path, formData)

// ─── Missing persons (/api/security/missing) ──────────────────────────────────

export const getAllProfiles = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return get(`/api/security/missing${q ? '?' + q : ''}`)
}

export const getActiveProfiles = () => getAllProfiles({ status: 'active' })

export const createProfile = (data) => post('/api/security/missing', data)

export const createProfileWithPhoto = (photoFile, fields) => {
  const form = new FormData()
  form.append('photo',       photoFile)
  form.append('name',        fields.name)
  form.append('description', fields.description || '')
  form.append('category',    fields.category || 'missing')
  if (fields.missing_since) form.append('missing_since', fields.missing_since)
  return postForm('/api/security/missing/upload', form)
}

export const updateProfilePhoto = (personId, photoFile) => {
  const form = new FormData()
  form.append('photo', photoFile)
  return putForm(`/api/security/missing/${personId}/photo`, form)
}

export const markAsFound  = (personId) => put(`/api/security/missing/${personId}/found`)
export const enrollGait   = (payload)  => post('/api/security/gait/enroll', payload)

// ─── Restricted persons (/api/security/restricted) ────────────────────────────

export const getRestrictedPersons = (params = {}) => {
  const q = new URLSearchParams({ active_only: true, ...params }).toString()
  return get(`/api/security/restricted?${q}`)
}

export const registerRestrictedPerson = (data) => post('/api/security/restricted', data)

export const registerRestrictedWithPhoto = (photoFile, fields) => {
  const form = new FormData()
  form.append('photo',  photoFile)
  form.append('name',   fields.name)
  form.append('reason', fields.reason)
  return postForm('/api/security/restricted/upload', form)
}

export const updateRestrictedPhoto = (personId, photoFile) => {
  const form = new FormData()
  form.append('photo', photoFile)
  return putForm(`/api/security/restricted/${personId}/photo`, form)
}

export const removeRestrictedPerson = (personId) => del(`/api/security/restricted/${personId}`)

// ─── Security feature flags ───────────────────────────────────────────────────

export const getSecurityFeatures   = ()              => get('/api/security/features')
export const toggleSecurityFeature = (flag, enabled) => put(`/api/security/features/${flag}?enabled=${enabled}`)
export const resetSecurityFeature  = (flag)          => del(`/api/security/features/${flag}`)
export const getFRStatus           = ()              => get('/api/security/fr/status')
export const toggleFR              = (enabled)       => put(`/api/security/fr/toggle?enabled=${enabled}`)

// ─── Audit log ────────────────────────────────────────────────────────────────

export const getSecurityAuditLog = (params = {}) => {
  const q = new URLSearchParams(params).toString()
  return get(`/api/security/audit${q ? '?' + q : ''}`)
}

export const acknowledgeAuditEntry = (logId) => put(`/api/security/audit/${logId}/acknowledge`)