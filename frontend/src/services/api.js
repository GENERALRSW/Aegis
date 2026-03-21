// ─── api.js ───────────────────────────────────────────────────────────────────
// In DEVELOPMENT: Vite proxies /api/* to Railway (see vite.config.js)
// In PRODUCTION:  VITE_API_URL points directly to Railway

const BASE_URL = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_API_URL || '')

const TOKEN_KEY = 'aegis_token'

// ─── Auth token helpers ───────────────────────────────────────────────────────
export const getToken   = ()      => localStorage.getItem(TOKEN_KEY)
export const setToken   = (token) => localStorage.setItem(TOKEN_KEY, token)
export const clearToken = ()      => localStorage.removeItem(TOKEN_KEY)

// ─── Core request ─────────────────────────────────────────────────────────────
export const request = async (method, path, body = null, options = {}) => {
  const token = getToken()

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const config = {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  }

  const res = await fetch(`${BASE_URL}${path}`, config)

  if (res.status === 401) {
    clearToken()
    window.location.href = '/login'
    return
  }

  const contentType = res.headers.get('content-type')
  const data = contentType?.includes('application/json')
    ? await res.json()
    : await res.text()

  if (!res.ok) {
    const message =
      (typeof data === 'object' && (data?.detail?.[0]?.msg || data?.detail || data?.message))
      || `Request failed: ${res.status}`
    throw new Error(message)
  }

  return data
}

// ─── Shorthands ───────────────────────────────────────────────────────────────
export const get  = (path, opts)       => request('GET',    path, null, opts)
export const post = (path, body, opts) => request('POST',   path, body, opts)
export const put  = (path, body, opts) => request('PUT',    path, body, opts)
export const del  = (path, opts)       => request('DELETE', path, null, opts)

// ─── Multipart (photo / frame upload) ────────────────────────────────────────
export const postFormData = async (path, formData) => {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })
  if (res.status === 401) { clearToken(); window.location.href = '/login'; return }
  const data = await res.json()
  if (!res.ok) throw new Error(data?.detail || 'Upload failed')
  return data
}