import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { login } from '../services/authService'
import './Login.css'

export default function Login() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    if (error) setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.email || !form.password) { setError('Please fill in all fields.'); return }
    setLoading(true)
    try {
      await login(form.email, form.password)
      navigate('/overview')
    } catch (err) {
      setError(err.message || 'Invalid credentials. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-grid" aria-hidden="true" />
      <div className="auth-orb auth-orb-1" aria-hidden="true" />
      <div className="auth-orb auth-orb-2" aria-hidden="true" />
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">A</div>
          <div className="auth-logo-text">
            <span className="auth-logo-name">Aegis</span>
            <span className="auth-logo-sub">Campus Safety Intelligence</span>
          </div>
        </div>
        <div className="auth-divider" />
        <div className="auth-heading">
          <h1 className="auth-title">Welcome back</h1>
          <p className="auth-subtitle">Sign in to access the command centre</p>
        </div>
        {error && (
          <div className="auth-error">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/><path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            {error}
          </div>
        )}
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label className="auth-label" htmlFor="email">Email address</label>
            <div className="auth-input-wrap">
              <span className="auth-input-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="M2 7l10 7 10-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span>
              <input id="email" name="email" type="email" className="auth-input" placeholder="officer@aegis.jm" value={form.email} onChange={handleChange} autoComplete="email" autoFocus />
            </div>
          </div>
          <div className="auth-field">
            <div className="auth-label-row">
              <label className="auth-label" htmlFor="password">Password</label>
              <Link to="/forgot-password" className="auth-forgot">Forgot password?</Link>
            </div>
            <div className="auth-input-wrap">
              <span className="auth-input-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8"/><path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span>
              <input id="password" name="password" type={showPassword ? 'text' : 'password'} className="auth-input" placeholder="Enter your password" value={form.password} onChange={handleChange} autoComplete="current-password" />
              <button type="button" className="auth-eye-btn" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                {showPassword ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg> : <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/></svg>}
              </button>
            </div>
          </div>
          <button type="submit" className={`auth-submit ${loading ? 'loading' : ''}`} disabled={loading}>
            {loading ? <><span className="auth-spinner" />Authenticating...</> : <>Sign in <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></>}
          </button>
        </form>
        <div className="auth-divider" />
        <p className="auth-footer">Don't have an account? <Link to="/register" className="auth-link">Request access</Link></p>
        <div className="auth-security">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>
          Secured connection · JDF Authorised Personnel Only
        </div>
      </div>
    </div>
  )
}
