import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { register } from '../services/authService'
import './Register.css'

const ROLES = [
  { value: 'operator',   label: 'Security Operator' },
  { value: 'viewer',     label: 'Viewer (Read Only)' },
  { value: 'jdf_member', label: 'JDF Member' },
  { value: 'admin',      label: 'System Administrator' },
]

export default function Register() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    fullName: '', username: '', role: '',
    email: '', password: '', confirmPassword: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value })
    if (error) setError('')
  }

  const validateStep1 = () => {
    if (!form.fullName.trim()) return 'Full name is required.'
    if (!form.username.trim()) return 'Username is required.'
    if (form.username.length < 3) return 'Username must be at least 3 characters.'
    if (!form.role) return 'Please select a role.'
    return ''
  }

  const validateStep2 = () => {
    if (!form.email.trim()) return 'Email address is required.'
    if (!form.email.includes('@')) return 'Please enter a valid email.'
    if (!form.password) return 'Password is required.'
    if (form.password.length < 8) return 'Password must be at least 8 characters.'
    if (form.password !== form.confirmPassword) return 'Passwords do not match.'
    return ''
  }

  const handleNext = (e) => {
    e.preventDefault()
    const err = validateStep1()
    if (err) { setError(err); return }
    setStep(2)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const err = validateStep2()
    if (err) { setError(err); return }
    setLoading(true)
    try {
      await register({
        username:  form.username,
        email:     form.email,
        password:  form.password,
        full_name: form.fullName,
        role:      form.role || 'operator',
      })
      navigate('/login')
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.')
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

        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">A</div>
          <div className="auth-logo-text">
            <span className="auth-logo-name">Aegis</span>
            <span className="auth-logo-sub">Campus Safety Intelligence</span>
          </div>
        </div>

        <div className="auth-divider" />

        {/* Heading + step indicator */}
        <div className="auth-heading">
          <div className="reg-step-row">
            <h1 className="auth-title">
              {step === 1 ? 'Create account' : 'Set credentials'}
            </h1>
            <div className="reg-steps">
              <div className={`reg-step ${step >= 1 ? 'done' : ''}`}>1</div>
              <div className="reg-step-line" />
              <div className={`reg-step ${step >= 2 ? 'done' : ''}`}>2</div>
            </div>
          </div>
          <p className="auth-subtitle">
            {step === 1
              ? 'Enter your officer details to request access'
              : 'Set up your login credentials'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="auth-error">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/>
              <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            {error}
          </div>
        )}

        {/* ── Step 1: Officer details ── */}
        {step === 1 && (
          <form className="auth-form" onSubmit={handleNext} noValidate>

            <div className="auth-field">
              <label className="auth-label" htmlFor="fullName">Full name</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/>
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </span>
                <input
                  id="fullName" name="fullName" type="text"
                  className="auth-input" placeholder="Officer J. Green"
                  value={form.fullName} onChange={handleChange} autoFocus
                />
              </div>
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="username">Username</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/>
                    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </span>
                <input
                  id="username" name="username" type="text"
                  className="auth-input" placeholder="jgreen_sec"
                  value={form.username} onChange={handleChange}
                />
              </div>
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="role">Role</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
                  </svg>
                </span>
                <select
                  id="role" name="role"
                  className="auth-input auth-select"
                  value={form.role} onChange={handleChange}
                >
                  <option value="">Select your role</option>
                  {ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <button type="submit" className="auth-submit">
              Continue
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </form>
        )}

        {/* ── Step 2: Credentials ── */}
        {step === 2 && (
          <form className="auth-form" onSubmit={handleSubmit} noValidate>

            <div className="auth-field">
              <label className="auth-label" htmlFor="email">Email address</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                    <path d="M2 7l10 7 10-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                <input
                  id="email" name="email" type="email"
                  className="auth-input" placeholder="officer@aegis.jm"
                  value={form.email} onChange={handleChange} autoFocus
                />
              </div>
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="password">Password</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8"/>
                    <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                  </svg>
                </span>
                <input
                  id="password" name="password"
                  type={showPassword ? 'text' : 'password'}
                  className="auth-input" placeholder="Min. 8 characters"
                  value={form.password} onChange={handleChange}
                />
                <button type="button" className="auth-eye-btn"
                  onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                  {showPassword ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="1.8"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/>
                    </svg>
                  )}
                </button>
              </div>
              {/* Password strength bar */}
              {form.password && (
                <div className="reg-strength">
                  <div className="reg-strength-bar">
                    <div
                      className="reg-strength-fill"
                      style={{
                        width: form.password.length >= 12
                          ? '100%' : form.password.length >= 8
                          ? '66%' : '33%',
                        background: form.password.length >= 12
                          ? '#22c55e' : form.password.length >= 8
                          ? '#f5c518' : '#e24b4a',
                      }}
                    />
                  </div>
                  <span className="reg-strength-label">
                    {form.password.length >= 12 ? 'Strong'
                      : form.password.length >= 8 ? 'Good'
                      : 'Weak'}
                  </span>
                </div>
              )}
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="confirmPassword">Confirm password</label>
              <div className="auth-input-wrap">
                <span className="auth-input-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </span>
                <input
                  id="confirmPassword" name="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  className={`auth-input ${
                    form.confirmPassword && form.password !== form.confirmPassword
                      ? 'input-error' : ''
                  }`}
                  placeholder="Re-enter your password"
                  value={form.confirmPassword} onChange={handleChange}
                />
              </div>
            </div>

            <div className="reg-btn-row">
              <button
                type="button"
                className="auth-submit reg-back-btn"
                onClick={() => { setStep(1); setError('') }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M19 12H5M11 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Back
              </button>
              <button
                type="submit"
                className={`auth-submit reg-submit-btn ${loading ? 'loading' : ''}`}
                disabled={loading}
              >
                {loading ? (
                  <><span className="auth-spinner" />Creating account...</>
                ) : (
                  <>Create account
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        <div className="auth-divider" />

        <p className="auth-footer">
          Already have an account?{' '}
          <Link to="/login" className="auth-link">Sign in</Link>
        </p>

        <div className="auth-security">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
          Secured connection · JDF Authorised Personnel Only
        </div>
      </div>
    </div>
  )
}
