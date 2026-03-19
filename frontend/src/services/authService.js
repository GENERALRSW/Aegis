import { get, post, put, setToken, clearToken, getToken } from './api'

const BASE_URL = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '')

/** Login — JSON body: { email, password } */
export const login = async (email, password) => {
  const res = await fetch(`${BASE_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',   // receive the HttpOnly cookie the backend sets
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.detail || `Login failed: ${res.status}`)
  }
  const data = await res.json()
  // The JWT is now in an HttpOnly cookie — JS never sees it.
  // Set a plain flag so ProtectedRoute knows the user is logged in.
  setToken()
  return data
}

/** Register — requires: username, email, password, role, full_name */
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
  // Tell the backend to clear the HttpOnly cookie, then clear our local flag.
  await post('/api/users/logout').catch(() => {})
  clearToken()
  window.location.href = '/login'
}
export const getCurrentUser = () => get('/api/users/me')
export const getAllUsers    = () => get('/api/users')
export const isAuthenticated = () => !!getToken()

/** role is a query param not body */
export const updateUserRole = (userId, role) =>
  put(`/api/users/${userId}/role?role=${role}`)
