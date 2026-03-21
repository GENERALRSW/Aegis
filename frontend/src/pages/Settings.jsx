import { useState, useEffect } from 'react'
import {
  getSecurityFeatures, toggleSecurityFeature, resetSecurityFeature,
  getFRStatus, toggleFR,
} from '../services/missingPersonsService'
import '../components/SharedStyles.css'
import './Settings.css'

// ─── Reusable components ──────────────────────────────────────────────────────

function Toggle({ on, onChange, loading }) {
  return (
    <div
      className={`stt-toggle ${on ? 'on' : ''} ${loading ? 'stt-toggle-loading' : ''}`}
      onClick={() => !loading && onChange(!on)}
    >
      <div className="stt-thumb" />
    </div>
  )
}

function SettingRow({ label, sub, children, source }) {
  return (
    <div className="stt-row">
      <div className="stt-row-text">
        <div className="stt-row-label">
          {label}
          {source && (
            <span className={`stt-source ${source}`}>{source}</span>
          )}
        </div>
        {sub && <div className="stt-row-sub">{sub}</div>}
      </div>
      <div className="stt-row-control">{children}</div>
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div className="stt-section">
      <div className="stt-section-title">{title}</div>
      {subtitle && <div className="stt-section-sub">{subtitle}</div>}
      <div className="card stt-card">{children}</div>
    </div>
  )
}

function StatusPill({ ok, label }) {
  return (
    <span className="stt-pill" style={{
      color: ok ? '#22C55E' : '#E24B4A',
      background: ok ? 'rgba(34,197,94,0.1)' : 'rgba(226,75,74,0.1)',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.25)' : 'rgba(226,75,74,0.25)'}`,
    }}>{label}</span>
  )
}

// ─── Flag metadata ────────────────────────────────────────────────────────────

const FLAG_META = {
  facial_recognition: {
    label: 'Facial recognition',
    sub:   'Match faces in camera feeds against registered restricted persons. Requires DeepFace.',
    warn:  'DPA-sensitive — ensure legal basis before enabling',
  },
  authorized_persons: {
    label: 'Authorized Personnel Check',
    sub:   'Cross-check detected persons against the authorized staff database to prevent false intruder alerts for known personnel.',
  },
  restricted_persons: {
    label: 'Restricted persons check',
    sub:   'Alert when a registered restricted person is detected in camera feeds.',
  },
  missing_persons: {
    label: 'Missing persons search',
    sub:   'Actively scan footage for profiles registered as missing.',
  },
  criminal_search: {
    label: 'Criminal profile search',
    sub:   'Include persons registered under the criminal category in missing/restricted scans.',
    warn:  'Ensure JDF authorisation before enabling',
  },
  gait_analysis: {
    label: 'Gait analysis matching',
    sub:   'Use MediaPipe gait signatures to identify persons without facial recognition.',
  },
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Settings() {
  // ── Security feature flags (from /api/security/features) ──
  const [flags, setFlags]         = useState({})
  const [flagsLoading, setFlagsLoading]   = useState(true)
  const [togglingFlag, setTogglingFlag]   = useState(null) // flag name currently toggling

  // ── FR status (from /api/security/fr/status) ──
  const [frStatus, setFrStatus]   = useState(null)
  const [togglingFR, setTogglingFR] = useState(false)

  // ── Local UI preferences (no backend endpoint) ──
  const [confidence, setConfidence]       = useState(70)
  const [pushAlerts, setPushAlerts]       = useState(true)
  const [soundAlerts, setSoundAlerts]     = useState(false)
  const [jdfAutoNotify, setJdfAutoNotify] = useState(true)
  const [emailDigest, setEmailDigest]     = useState(true)
  const [compactView, setCompactView]     = useState(false)
  const [autoRefresh, setAutoRefresh]     = useState(true)

  // ── Toast ──
  const [toast, setToast]         = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Load on mount ──
  useEffect(() => {
    const load = async () => {
      try {
        const [featData, frData] = await Promise.all([
          getSecurityFeatures(),
          getFRStatus(),
        ])
        setFlags(featData || {})
        setFrStatus(frData || null)
      } catch (err) {
        console.error('Settings load error:', err)
        showToast('Failed to load security settings', 'error')
      } finally {
        setFlagsLoading(false)
      }
    }
    load()
  }, [])

  // ── Toggle a feature flag ──
  const handleToggleFlag = async (flag, newVal) => {
    setTogglingFlag(flag)
    // Optimistic update
    setFlags(prev => ({
      ...prev,
      [flag]: { ...prev[flag], enabled: newVal }
    }))
    try {
      await toggleSecurityFeature(flag, newVal)
      showToast(`${FLAG_META[flag]?.label || flag} ${newVal ? 'enabled' : 'disabled'}`)
    } catch (err) {
      // Revert on failure
      setFlags(prev => ({
        ...prev,
        [flag]: { ...prev[flag], enabled: !newVal }
      }))
      showToast(err.message || 'Failed to update flag', 'error')
    } finally {
      setTogglingFlag(null)
    }
  }

  // ── Reset a flag to config default ──
  const handleResetFlag = async (flag) => {
    setTogglingFlag(flag)
    try {
      await resetSecurityFeature(flag)
      const updated = await getSecurityFeatures()
      setFlags(updated || {})
      showToast(`${FLAG_META[flag]?.label || flag} reset to default`)
    } catch (err) {
      showToast(err.message || 'Failed to reset flag', 'error')
    } finally {
      setTogglingFlag(null)
    }
  }

  // ── Toggle facial recognition ──
  const handleToggleFR = async (newVal) => {
    setTogglingFR(true)
    try {
      await toggleFR(newVal)
      setFrStatus(prev => ({ ...prev, enabled: newVal }))
      showToast(`Facial recognition ${newVal ? 'enabled' : 'disabled'}`)
    } catch (err) {
      showToast(err.message || 'Failed to toggle FR', 'error')
    } finally {
      setTogglingFR(false)
    }
  }

  const flagEnabled = (key) => flags[key]?.enabled ?? false
  const flagSource  = (key) => flags[key]?.source || null

  return (
    <div className="page-wrapper">
      {/* Toast */}
      {toast && (
        <div className={`stt-toast ${toast.type}`}>
          {toast.type === 'success' ? '✓' : '✕'} {toast.msg}
        </div>
      )}

      <div className="page-header stt-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Security configuration and system preferences</p>
        </div>
      </div>

      <div className="page-content stt-content">
        <div className="stt-grid">

          {/* ── LEFT COLUMN ── */}
          <div className="stt-col">

            {/* Facial Recognition */}
            <Section
              title="Facial Recognition"
              subtitle="Controls whether the CV engine runs face matching. Regional DPA rules may restrict this."
            >
              {frStatus && (
                <div className="stt-fr-status-bar">
                  <StatusPill ok={frStatus.deepface_available} label={frStatus.deepface_available ? 'DeepFace ready' : 'DeepFace unavailable'} />
                  <StatusPill ok={frStatus.region_allowed}     label={frStatus.region_allowed ? `${frStatus.system_region} — allowed` : `${frStatus.system_region} — restricted`} />
                  <StatusPill ok={frStatus.enabled}            label={frStatus.enabled ? 'Currently ON' : 'Currently OFF'} />
                </div>
              )}
              <SettingRow
                label="Enable facial recognition"
                sub={frStatus?.region_allowed === false ? '⚠ Not permitted in your region' : 'Match camera frames against registered restricted persons'}
              >
                <Toggle
                  on={frStatus?.enabled ?? false}
                  onChange={handleToggleFR}
                  loading={togglingFR}
                />
              </SettingRow>
              {frStatus?.model && (
                <SettingRow label="Active model" sub="Face recognition model in use">
                  <span className="stt-mono">{frStatus.model}</span>
                </SettingRow>
              )}
            </Section>

            {/* Security Feature Flags */}
            <Section
              title="Security Intelligence Flags"
              subtitle="Enable or disable individual CV intelligence modules. Changes take effect immediately on the backend."
            >
              {flagsLoading ? (
                <div className="stt-loading">Loading flags from backend...</div>
              ) : (
                Object.keys(FLAG_META).map(flag => (
                  <SettingRow
                    key={flag}
                    label={FLAG_META[flag].label}
                    sub={FLAG_META[flag].warn
                      ? <><span style={{color:'#F5C518'}}>⚠ {FLAG_META[flag].warn}</span><br/>{FLAG_META[flag].sub}</>
                      : FLAG_META[flag].sub
                    }
                    source={flagSource(flag)}
                  >
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <Toggle
                        on={flagEnabled(flag)}
                        onChange={(val) => handleToggleFlag(flag, val)}
                        loading={togglingFlag === flag}
                      />
                      {flags[flag]?.source === 'runtime' && (
                        <button
                          className="stt-reset-btn"
                          onClick={() => handleResetFlag(flag)}
                          title="Reset to config default"
                        >↺</button>
                      )}
                    </div>
                  </SettingRow>
                ))
              )}
            </Section>

          </div>

          {/* ── RIGHT COLUMN ── */}
          <div className="stt-col">

            {/* Detection Thresholds */}
            <Section title="Detection Thresholds">
              <SettingRow
                label="Confidence threshold"
                sub={`Minimum CV confidence to trigger an alert — currently ${confidence}%`}
              >
                <div className="stt-slider-wrap">
                  <input type="range" min={40} max={95} step={5}
                    value={confidence} onChange={e => setConfidence(+e.target.value)}
                    className="stt-slider" />
                  <span className="stt-slider-val">{confidence}%</span>
                </div>
              </SettingRow>
            </Section>

            {/* Alerts & Notifications */}
            <Section title="Alerts & Notifications">
              {[
                ['Push notifications',      'Real-time alerts to mobile companion app',                pushAlerts,   setPushAlerts  ],
                ['Sound alerts',            'Audio tone on high-confidence detections',                soundAlerts,  setSoundAlerts ],
                ['JDF auto-notify',         'Send mobile alert to JDF liaison on escalations',         jdfAutoNotify,setJdfAutoNotify],
                ['Daily email digest',      'Summary of all detections sent each morning',             emailDigest,  setEmailDigest ],
              ].map(([label, sub, val, set]) => (
                <SettingRow key={label} label={label} sub={sub}>
                  <Toggle on={val} onChange={set} />
                </SettingRow>
              ))}
            </Section>

            {/* Interface */}
            <Section title="Interface">
              {[
                ['Compact view',    'Reduce spacing in alert feed and tables', compactView, setCompactView],
                ['Auto-refresh feed','Live update alert feed every 10 seconds', autoRefresh, setAutoRefresh],
              ].map(([label, sub, val, set]) => (
                <SettingRow key={label} label={label} sub={sub}>
                  <Toggle on={val} onChange={set} />
                </SettingRow>
              ))}
            </Section>

            {/* Danger zone */}
            <Section title="Danger zone">
              <SettingRow label="Reset all feature flags" sub="Restore all security flags to their config defaults">
                <button className="btn stt-danger-btn" onClick={async () => {
                  for (const flag of Object.keys(FLAG_META)) {
                    await resetSecurityFeature(flag).catch(() => {})
                  }
                  const updated = await getSecurityFeatures()
                  setFlags(updated || {})
                  showToast('All flags reset to defaults')
                }}>Reset all flags</button>
              </SettingRow>
              <SettingRow label="Disable all intelligence" sub="Immediately disable all CV security features">
                <button className="btn stt-danger-btn" onClick={async () => {
                  for (const flag of Object.keys(FLAG_META)) {
                    await toggleSecurityFeature(flag, false).catch(() => {})
                  }
                  setFlags(prev => {
                    const next = { ...prev }
                    Object.keys(FLAG_META).forEach(f => { next[f] = { ...next[f], enabled: false } })
                    return next
                  })
                  showToast('All intelligence features disabled')
                }}>Disable all</button>
              </SettingRow>
            </Section>

          </div>
        </div>
      </div>
    </div>
  )
}
