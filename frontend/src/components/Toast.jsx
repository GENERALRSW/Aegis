import { useEffect } from 'react'
import './Toast.css'

/**
 * Toast
 * @param {string}   message   - Toast message
 * @param {string}   type      - 'success' | 'error' | 'warning' | 'info'
 * @param {function} onClose   - Called when dismissed
 * @param {number}   duration  - Auto-dismiss ms (default: 3500)
 */
export default function Toast({ message, type = 'info', onClose, duration = 3500 }) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [onClose, duration])

  const icons = {
    success: '✓',
    error:   '✕',
    warning: '⚠',
    info:    'ℹ',
  }

  return (
    <div className={`toast toast-${type}`}>
      <span className="toast-icon">{icons[type]}</span>
      <span className="toast-message">{message}</span>
      <button className="toast-close" onClick={onClose}>✕</button>
    </div>
  )
}

/**
 * ToastContainer
 * Place this once in DashboardLayout or App.
 * Pass an array of toast objects: [{ id, message, type }]
 */
export function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          type={t.type}
          onClose={() => removeToast(t.id)}
        />
      ))}
    </div>
  )
}
