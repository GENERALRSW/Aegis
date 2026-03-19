import { Navigate } from 'react-router-dom'
import { getToken } from '../services/api'

/**
 * Wraps any route that requires authentication.
 *
 * The real JWT lives in an HttpOnly cookie — JavaScript cannot read it.
 * Instead we check for a plain 'aegis_authenticated' flag in localStorage,
 * which is set on login and cleared on logout/401.
 *
 * Even if XSS reads this flag, it gains nothing — the actual token is
 * inaccessible. Any protected API call will still require the valid cookie,
 * which the backend verifies independently.
 */
export default function ProtectedRoute({ children }) {
  const isAuthenticated = getToken()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}
