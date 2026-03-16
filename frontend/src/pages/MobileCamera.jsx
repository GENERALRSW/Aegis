import { useState, useEffect, useRef, useCallback } from 'react'
import { setToken, getToken } from '../services/api'
import { login } from '../services/authService'
import { registerCamera, updateCamera } from '../services/cameraService'
import { detectJSON } from '../services/aiService'
import './PhoneCamera.css'

const FRAME_INTERVAL_MS = 2000

const SEVERITY_COLORS = {
  low:      '#22C55E',
  medium:   '#F5C518',
  high:     '#E24B4A',
  critical: '#E24B4A',
}

export default function MobileCamera() {
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const streamRef   = useRef(null)
  const intervalRef = useRef(null)

  const [authed, setAuthed]             = useState(false)
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [loginError, setLoginError]     = useState('')
  const [loginLoading, setLoginLoading] = useState(false)

  const [status, setStatus]             = useState('idle')
  const [camera, setCamera]             = useState(null)
  const [roomId, setRoomId]             = useState('')
  const [location, setLocation]         = useState('Mobile Camera')
  const [facing, setFacing]             = useState('environment')
  const [detections, setDetections]     = useState([])
  const [lastEvent, setLastEvent]       = useState(null)
  const [frameCount, setFrameCount]     = useState(0)
  const [sending, setSending]           = useState(false)
  const [error, setError]               = useState('')

  // On mount: read ?t= token and ?room= from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tParam    = params.get('t')
    const roomParam = params.get('room')

    if (tParam) {
      setToken(tParam)
      const newSearch = roomParam ? `?room=${roomParam}` : ''
      window.history.replaceState({}, '', `/mobile${newSearch}`)
    }
    if (roomParam) {
      setRoomId(roomParam)
      setLocation(`Room ${roomParam}`)
    }
    setAuthed(!!getToken())
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    try {
      await login(email, password)
      setAuthed(true)
    } catch (err) {
      setLoginError(err.message)
    } finally {
      setLoginLoading(false)
    }
  }

  // ─── Camera controls ─────────────────────────────────────────────────────────
  const startCamera = async (facingMode = facing) => {
    setError('')
    setStatus('registering')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      const camId = roomId ? `mobile-${roomId}-${Date.now()}` : `mobile-${Date.now()}`
      const registered = await registerCamera({
        camera_id:   camId,
        name:        location,
        camera_type: 'phone',
        location,
        metadata: { source: 'mobile', room: roomId || null, userAgent: navigator.userAgent },
      })
      setCamera(registered)
      setStatus('active')
      startFrameLoop(camId)
    } catch (err) {
      setError(
        err.message.includes('ermission')
          ? 'Camera access denied. Please allow camera in your browser settings.'
          : err.message
      )
      setStatus('error')
    }
  }

  const stopCamera = async () => {
    clearInterval(intervalRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (camera) {
      try { await updateCamera(camera.camera_id, { status: 'inactive' }) } catch {}
    }
    setStatus('idle')
    setCamera(null)
    setDetections([])
    setLastEvent(null)
    setFrameCount(0)
  }

  const flipCamera = async () => {
    const next = facing === 'environment' ? 'user' : 'environment'
    setFacing(next)
    if (status === 'active') {
      await stopCamera()
      await startCamera(next)
    }
  }

  // ─── Frame capture ────────────────────────────────────────────────────────────
  const captureFrame = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return null
    canvas.width  = video.videoWidth  || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.75).split(',')[1]
  }, [])

  const sendFrame = useCallback(async (cameraId) => {
    if (sending) return
    const frame_b64 = captureFrame()
    if (!frame_b64) return
    setSending(true)
    try {
      const result = await detectJSON({ camera_id: cameraId, frame_b64, source_type: 'phone', location })
      setDetections(result.detections || [])
      setLastEvent(result)
      setFrameCount(c => c + 1)
    } catch (err) {
      console.warn('Frame send error:', err.message)
    } finally {
      setSending(false)
    }
  }, [captureFrame, location, sending])

  const startFrameLoop = useCallback((cameraId) => {
    clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => sendFrame(cameraId), FRAME_INTERVAL_MS)
  }, [sendFrame])

  useEffect(() => () => {
    clearInterval(intervalRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  const riskColor = lastEvent ? (SEVERITY_COLORS[lastEvent.severity] || '#22C55E') : '#22C55E'

  // ─── Login screen ─────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="pc-root">
        <div className="pc-login-wrap">
          <div className="pc-brand">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="#4A9FE2" strokeWidth="1.8" strokeLinejoin="round"/>
            </svg>
            <span>Aegis Camera</span>
          </div>
          {roomId && <p className="pc-sub">Room <strong style={{color:'#4A9FE2'}}>{roomId}</strong></p>}
          <p className="pc-sub">Sign in to start streaming</p>
          <form className="pc-form" onSubmit={handleLogin}>
            <input className="pc-input" type="email" placeholder="Email"
              value={email} onChange={e => setEmail(e.target.value)}
              required autoComplete="email" />
            <input className="pc-input" type="password" placeholder="Password"
              value={password} onChange={e => setPassword(e.target.value)}
              required autoComplete="current-password" />
            {loginError && <div className="pc-error-msg">{loginError}</div>}
            <button className="pc-btn-primary" type="submit" disabled={loginLoading}>
              {loginLoading ? 'Signing in…' : 'Sign in & open camera'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ─── Camera screen ────────────────────────────────────────────────────────────
  return (
    <div className="pc-root">
      <div className="pc-header">
        <div className="pc-brand">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="#4A9FE2" strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
          <span>Aegis</span>
        </div>
        {roomId && (
          <span style={{fontSize:11,color:'#4A9FE2',fontFamily:'monospace',letterSpacing:'0.06em',
            background:'rgba(74,159,226,0.08)',padding:'3px 8px',borderRadius:5,border:'1px solid rgba(74,159,226,0.2)'}}>
            {roomId}
          </span>
        )}
        {status === 'active' && (
          <div className="pc-live-badge">
            <span className="pc-live-dot" />
            LIVE
          </div>
        )}
      </div>

      {/* Video */}
      <div className="pc-video-wrap">
        <video ref={videoRef} className="pc-video" muted playsInline autoPlay />
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {status === 'idle' && (
          <div className="pc-placeholder">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none">
              <rect x="7" y="2" width="10" height="20" rx="2" stroke="#333" strokeWidth="1.5"/>
              <circle cx="12" cy="18" r="1" fill="#333"/>
            </svg>
            <span>Camera off</span>
          </div>
        )}
        {status === 'registering' && (
          <div className="pc-placeholder">
            <div className="pc-spinner" />
            <span>Connecting…</span>
          </div>
        )}
        {status === 'error' && (
          <div className="pc-placeholder">
            <span className="pc-error-msg" style={{ textAlign: 'center' }}>{error}</span>
          </div>
        )}

        {status === 'active' && detections.length > 0 && (
          <div className="pc-det-overlay">
            {detections.slice(0, 3).map((d, i) => (
              <div key={i} className="pc-det-pill"
                style={{ borderColor: riskColor, color: riskColor, background: `${riskColor}18` }}>
                {d.label} · {Math.round((d.confidence || 0) * 100)}%
              </div>
            ))}
          </div>
        )}

        {sending && <div className="pc-sending-dot" />}
      </div>

      {/* Location + controls */}
      <div className="pc-controls">
        <input className="pc-input pc-location"
          placeholder="Location label"
          value={location}
          onChange={e => setLocation(e.target.value)}
          disabled={status === 'active'}
        />
        {status === 'active' ? (
          <div style={{display:'flex',gap:8}}>
            <button className="pc-btn-stop" onClick={stopCamera} style={{flex:1}}>Stop</button>
            <button onClick={flipCamera}
              style={{padding:'14px 16px',background:'#111',border:'1px solid #222',borderRadius:10,color:'#888',fontSize:13,cursor:'pointer'}}>
              Flip
            </button>
          </div>
        ) : (
          <button className="pc-btn-primary" onClick={() => startCamera()}
            disabled={status === 'registering'}>
            {status === 'registering' ? 'Starting…' : 'Start Camera'}
          </button>
        )}
      </div>

      {/* Stats */}
      {status === 'active' && (
        <div className="pc-stats">
          {[
            ['Frames sent', frameCount, null],
            ['Detections', detections.length, null],
            ['Risk score', lastEvent?.risk_score ?? '—', riskColor],
            ['Severity', lastEvent?.severity ?? '—', riskColor],
          ].map(([label, value, color]) => (
            <div key={label} className="pc-stat">
              <span className="pc-stat-val" style={color ? { color } : {}}>
                {typeof value === 'string' ? value.charAt(0).toUpperCase() + value.slice(1) : value}
              </span>
              <span className="pc-stat-label">{label}</span>
            </div>
          ))}
        </div>
      )}

      {lastEvent?.summary && (
        <div className="pc-summary" style={{ borderLeftColor: riskColor }}>
          <span className="pc-summary-label">CV Detection</span>
          <p className="pc-summary-text">{lastEvent.summary}</p>
        </div>
      )}

      <p style={{padding:'8px 14px 20px',fontSize:11,color:'#333',lineHeight:1.6,margin:0}}>
        Keep this page open while streaming to the dashboard.
      </p>
    </div>
  )
}
