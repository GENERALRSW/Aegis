import { Navigate } from 'react-router-dom'
import { getToken } from '../services/api'

/**
 * Wraps any route that requires authentication.
 * If no JWT token in localStorage → redirect to /login.
 */
export default function ProtectedRoute({ children }) {
  const token = getToken()
  if (!token) return <Navigate to="/login" replace />
  return children
}
