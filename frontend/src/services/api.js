// ─── api.js ───────────────────────────────────────────────────────────────────
// Base HTTP client for Aegis Railway backend.
//
// In DEVELOPMENT: Vite proxies /api/* to Railway (see vite.config.js)
//   → BASE_URL is empty string so requests go to /api/... (proxied)
// In PRODUCTION: VITE_API_URL points directly to Railway
//   → BASE_URL is https://aegis-backend-2-production.up.railway.app

const BASE_URL = import.meta.env.DEV
  ? ''   // Vite proxy handles it — use relative URLs
  : (import.meta.env.VITE_API_URL || '')

// ─── Token management ─────────────────────────────────────────────────────────
export const getToken  = ()      => localStorage.getItem('aegis_token')
export const setToken  = (token) => localStorage.setItem('aegis_token', token)
export const clearToken = ()     => localStorage.removeItem('aegis_token')

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
export const get  = (path, opts)        => request('GET',    path, null, opts)
export const post = (path, body, opts)  => request('POST',   path, body, opts)
export const put  = (path, body, opts)  => request('PUT',    path, body, opts)
export const del  = (path, opts)        => request('DELETE', path, null, opts)

// ─── Multipart (CV frame upload) ──────────────────────────────────────────────
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
