import { get, post, put, setToken, clearToken, getToken } from './api'

const BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

/** Login — stores the real JWT in localStorage for Bearer auth */
export const login = async (email, password) => {
  const res = await fetch(`${BASE_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.detail || `Login failed: ${res.status}`)
  }
  const data = await res.json()
  // Store the actual token — sent as Bearer header on every subsequent request
  if (data.access_token) {
    setToken(data.access_token)
  } else {
    throw new Error('No access token returned from server')
  }
  return data
}

/** Register */
export const register = async (userData) => {
  const res = await fetch(`${BASE_URL}/api/users/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.detail?.[0]?.msg || err?.detail || `Registration failed: ${res.status}`)
  }
  return res.json()
}

export const logout = async () => {
  await post('/api/users/logout').catch(() => {})
  clearToken()
  window.location.href = '/login'
}

export const getCurrentUser  = ()              => get('/api/users/me')
export const getAllUsers      = ()              => get('/api/users')
export const isAuthenticated = ()              => !!getToken()
export const updateUserRole  = (userId, role)  => put(`/api/users/${userId}/role?role=${role}`)