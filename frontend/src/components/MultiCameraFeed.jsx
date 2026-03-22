import { useState, useEffect, useRef, useCallback } from 'react'
import { registerCamera, updateCamera } from '../services/cameraService'
import { detectJSON } from '../services/aiService'
import MobileCameraSlot from './MobileCameraSlot'
import './MultiCameraFeed.css'

const FRAME_INTERVAL_MS = 2000
const MAX_CAMERAS = 4

const SEVERITY_COLORS = {
  low:      '#22C55E',
  medium:   '#F5C518',
  high:     '#E24B4A',
  critical: '#E24B4A',
}

const SKELETON_CONNECTIONS = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],
  [23,25],[25,27],[24,26],[26,28],
  [0,11],[0,12],
]

// ─── Single camera slot ──────────────────────────────────────────────────────
function CameraSlot({ slotId, onEventDetected, onRemove }) {
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const overlayRef  = useRef(null)
  const streamRef   = useRef(null)
  const intervalRef = useRef(null)
  const sendingRef  = useRef(false)   // guard against overlapping requests

  const [status, setStatus]         = useState('idle')   // idle | registering | active | error
  const [camera, setCamera]         = useState(null)
  const [detections, setDetections] = useState([])
  const [lastEvent, setLastEvent]   = useState(null)
  const [frameCount, setFrameCount] = useState(0)
  const [sending, setSending]       = useState(false)
  const [error, setError]           = useState('')
  const [location, setLocation]     = useState(`Camera ${slotId}`)

  const captureFrame = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return null
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1]
  }, [])

  const drawOverlay = useCallback((result) => {
    const overlay = overlayRef.current
    const video   = videoRef.current
    if (!overlay || !video) return
    const w = video.videoWidth  || 640
    const h = video.videoHeight || 480
    overlay.width  = w
    overlay.height = h
    const ctx = overlay.getContext('2d')
    ctx.clearRect(0, 0, w, h)

    const COLORS = {
      intruder:   '#E24B4A',
      weapon:     '#FF6B00',
      conflict:   '#F5C518',
      authorized: '#22C55E',
    }

    // Draw YOLO bounding boxes
    for (const det of (result.detections || [])) {
      const bb = det.bounding_box
      if (!bb) continue
      const color = COLORS[det.label] || '#4A9FE2'
      ctx.strokeStyle = color
      ctx.lineWidth   = 2
      ctx.strokeRect(bb.x1, bb.y1, bb.width, bb.height)
      const label = `${det.label} ${Math.round(det.confidence * 100)}%`
      ctx.font = 'bold 12px monospace'
      const tw = ctx.measureText(label).width
      ctx.fillStyle = color + 'cc'
      ctx.fillRect(bb.x1, bb.y1 - 18, tw + 8, 18)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, bb.x1 + 4, bb.y1 - 4)
    }

    // Draw MediaPipe skeleton for conflict detections
    for (const det of (result.detections || [])) {
      if (det.label !== 'conflict' || !det.keypoints || !det.keypoints.length) continue
      const kps = det.keypoints
      ctx.strokeStyle = '#F5C518'
      ctx.lineWidth = 2
      for (const [a, b] of SKELETON_CONNECTIONS) {
        const kpA = kps[a], kpB = kps[b]
        if (!kpA || !kpB) continue
        if ((kpA.visibility || 1) < 0.3 || (kpB.visibility || 1) < 0.3) continue
        ctx.beginPath()
        ctx.moveTo(kpA.x * w, kpA.y * h)
        ctx.lineTo(kpB.x * w, kpB.y * h)
        ctx.stroke()
      }
      ctx.fillStyle = '#F5C518'
      for (const kp of kps) {
        if ((kp.visibility || 1) < 0.3) continue
        ctx.beginPath()
        ctx.arc(kp.x * w, kp.y * h, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Draw green "AUTHORIZED" banners for recognized persons
    for (const auth of (result.authorized_identities || [])) {
      ctx.font = 'bold 11px monospace'
      const label = `✓ ${auth.person_name} — ${auth.category || 'authorized'}`
      const tw = ctx.measureText(label).width
      const yOffset = (result.authorized_identities.indexOf(auth)) * 22
      ctx.fillStyle = '#22C55Ecc'
      ctx.fillRect(4, 4 + yOffset, tw + 10, 20)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, 9, 18 + yOffset)
    }
  }, [])

  const sendFrame = useCallback(async (cameraId) => {
    if (sendingRef.current) return
    const frame_b64 = captureFrame()
    if (!frame_b64) return
    sendingRef.current = true
    setSending(true)
    try {
      const result = await detectJSON({
        camera_id:   cameraId,
        frame_b64,
        source_type: 'laptop',
        location,
      })
      setDetections(result.detections || [])
      drawOverlay(result)
      setLastEvent(result)
      setFrameCount(c => c + 1)
      if (result.severity === 'high' || result.severity === 'critical') {
        onEventDetected?.(result)
      }
    } catch (err) {
      console.warn(`[Slot ${slotId}] Frame send error:`, err.message)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [captureFrame, drawOverlay, location, onEventDetected, slotId])

  const startWebcam = async () => {
    setError('')
    setStatus('registering')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      const camId = `laptop-${Date.now()}-slot${slotId}`
      const registered = await registerCamera({
        camera_id:   camId,
        name:        `Webcam ${slotId} — ${location}`,
        camera_type: 'laptop',
        location,
        metadata:    { source: 'browser', slot: slotId, userAgent: navigator.userAgent },
      })
      setCamera(registered)
      setStatus('active')

      clearInterval(intervalRef.current)
      intervalRef.current = setInterval(() => sendFrame(camId), FRAME_INTERVAL_MS)
    } catch (err) {
      setError(err.message.includes('Permission')
        ? 'Camera permission denied. Please allow access and try again.'
        : err.message)
      setStatus('error')
    }
  }

  const stopWebcam = async () => {
    clearInterval(intervalRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (camera) {
      try { await updateCamera(camera.camera_id, { status: 'inactive' }) } catch {}
    }
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')
      ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height)
    }
    setStatus('idle')
    setCamera(null)
    setDetections([])
    setLastEvent(null)
    setFrameCount(0)
  }

  // Cleanup on unmount
  useEffect(() => () => {
    clearInterval(intervalRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  const riskColor = lastEvent ? (SEVERITY_COLORS[lastEvent.severity] || '#22C55E') : '#22C55E'

  return (
    <div className="cs-slot">
      {/* Slot header */}
      <div className="cs-header">
        <div className="cs-header-left">
          <span className="cs-slot-label">CAM {slotId}</span>
          {status === 'active' && (
            <span className="cs-live-badge">
              <span className="cs-live-dot" />
              LIVE
            </span>
          )}
          {camera && <span className="cs-cam-id">{camera.camera_id}</span>}
        </div>
        <button className="cs-remove-btn" onClick={onRemove} title="Remove camera slot">×</button>
      </div>

      {/* Video */}
      <div className="cs-video-wrap">
        <video ref={videoRef} className="cs-video" muted playsInline autoPlay />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <canvas ref={overlayRef} style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none', zIndex: 2,
        }} />

        {status === 'active' && (
          <div className="cs-detections-overlay">
            {lastEvent?.fr_operational === false && (
              <div className="cs-det-pill"
                style={{ background: 'rgba(245,197,24,0.15)', borderColor: '#F5C518' }}>
                <span style={{ color: '#F5C518' }}>FR offline</span>
              </div>
            )}
            {(lastEvent?.authorized_identities?.length || 0) > 0 && (
              <div className="cs-det-pill"
                style={{ background: '#22C55E22', borderColor: '#22C55E' }}>
                <span style={{ color: '#22C55E' }}>✓ {lastEvent.authorized_identities.length} authorized</span>
              </div>
            )}
            {(lastEvent?.security_alerts || []).slice(0,1).map((alert, i) => (
              <div key={`alert-${i}`} className="cs-det-pill"
                style={{ background: '#E24B4A22', borderColor: '#E24B4A' }}>
                <span style={{ color: '#E24B4A' }}>⚠ {alert.person_name}</span>
                <span className="cs-det-conf">{alert.alert_type.replace(/_/g,' ')}</span>
              </div>
            ))}
            {(lastEvent?.visitor_count || 0) > 0 && (
              <div className="cs-det-pill"
                style={{ background: 'rgba(102,102,102,0.15)', borderColor: 'var(--muted)' }}>
                <span style={{ color: 'var(--muted)' }}>{lastEvent.visitor_count} visitors</span>
              </div>
            )}
            {(lastEvent?.unidentified_count || 0) > 0 && (
              <div className="cs-det-pill"
                style={{ background: '#E24B4A22', borderColor: '#E24B4A' }}>
                <span style={{ color: '#E24B4A' }}>{lastEvent.unidentified_count} intruders</span>
              </div>
            )}
            {(lastEvent?.weapon_count || 0) > 0 && (
              <div className="cs-det-pill"
                style={{ background: '#FF6B0022', borderColor: '#FF6B00' }}>
                <span style={{ color: '#FF6B00' }}>⚠ {lastEvent.weapon_count} weapon</span>
              </div>
            )}
          </div>
        )}

        {status === 'idle' && (
          <div className="cs-placeholder">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="6" width="20" height="14" rx="2" stroke="#333" strokeWidth="1.5"/>
              <circle cx="12" cy="13" r="4" stroke="#333" strokeWidth="1.5"/>
              <path d="M8 6l2-3h4l2 3" stroke="#333" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
            <span>Inactive</span>
          </div>
        )}

        {status === 'registering' && (
          <div className="cs-placeholder">
            <div className="cs-spinner" />
            <span>Starting...</span>
          </div>
        )}

        {status === 'error' && (
          <div className="cs-placeholder error">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#E24B4A" strokeWidth="1.5"/>
              <path d="M12 8v4M12 16h.01" stroke="#E24B4A" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span style={{ color: '#E24B4A', fontSize: 11, textAlign: 'center', padding: '0 8px' }}>{error}</span>
          </div>
        )}

        {sending && <div className="cs-sending-dot" title="Sending frame to CV engine" />}
      </div>

      {/* Controls */}
      <div className="cs-controls">
        <input
          className="cs-location-input"
          placeholder="Location label"
          value={location}
          onChange={e => setLocation(e.target.value)}
          disabled={status === 'active'}
        />
        {status === 'active' ? (
          <button className="btn cs-btn-stop" onClick={stopWebcam}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/>
            </svg>
            Stop
          </button>
        ) : (
          <button className="btn btn-primary cs-btn-start"
            onClick={startWebcam}
            disabled={status === 'registering'}>
            {status === 'registering' ? 'Starting...' : (
              <>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                  <path d="M10 8l6 4-6 4V8z" fill="currentColor"/>
                </svg>
                Start
              </>
            )}
          </button>
        )}
      </div>

      {/* Stats */}
      {status === 'active' && (
        <div className="cs-stats">
          <div className="cs-stat">
            <span className="cs-stat-key">Frames</span>
            <span className="cs-stat-val">{frameCount}</span>
          </div>
          <div className="cs-stat">
            <span className="cs-stat-key">Detections</span>
            <span className="cs-stat-val">{detections.length}</span>
          </div>
          <div className="cs-stat">
            <span className="cs-stat-key">Risk</span>
            <span className="cs-stat-val" style={{ color: riskColor }}>{lastEvent?.risk_score ?? '—'}</span>
          </div>
          <div className="cs-stat">
            <span className="cs-stat-key">Severity</span>
            <span className="cs-stat-val" style={{ color: riskColor }}>{lastEvent?.severity ?? '—'}</span>
          </div>
        </div>
      )}

      {lastEvent?.summary && (
        <div className="cs-summary" style={{ borderLeftColor: riskColor }}>
          <span className="cs-summary-label">CV Summary</span>
          <p className="cs-summary-text">{lastEvent.summary}</p>
        </div>
      )}
    </div>
  )
}

// ─── Multi-camera container ──────────────────────────────────────────────────
export default function MultiCameraFeed({ onEventDetected }) {
  // Each slot is { id, type: 'webcam' | 'mobile' }
  const [slots, setSlots] = useState([{ id: 1, type: 'webcam' }])
  const nextId = useRef(2)

  const addWebcam = () => {
    if (slots.length >= MAX_CAMERAS) return
    setSlots(prev => [...prev, { id: nextId.current++, type: 'webcam' }])
  }

  const addMobile = () => {
    if (slots.length >= MAX_CAMERAS) return
    setSlots(prev => [...prev, { id: nextId.current++, type: 'mobile' }])
  }

  const removeSlot = (id) => {
    if (slots.length <= 1) return
    setSlots(prev => prev.filter(s => s.id !== id))
  }

  const full = slots.length >= MAX_CAMERAS

  return (
    <div className="mcf-root">
      <div className="mcf-header">
        <div className="mcf-title-row">
          <span className="mcf-title">Live Feeds</span>
          <span className="mcf-count">{slots.length} / {MAX_CAMERAS}</span>
        </div>

        <div className="mcf-add-group">
          <button
            className="btn btn-primary mcf-add-btn"
            onClick={addWebcam}
            disabled={full}
            title={full ? `Maximum ${MAX_CAMERAS} cameras` : 'Add webcam'}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            Webcam
          </button>
          <button
            className="btn mcf-add-btn mcf-mobile-btn"
            onClick={addMobile}
            disabled={full}
            title={full ? `Maximum ${MAX_CAMERAS} cameras` : 'Add mobile camera'}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
              <rect x="7" y="2" width="10" height="20" rx="2" stroke="currentColor" strokeWidth="1.8"/>
              <circle cx="12" cy="18" r="1.2" fill="currentColor"/>
            </svg>
            iPhone
          </button>
        </div>
      </div>

      <div className={`mcf-grid mcf-cols-${Math.min(slots.length, 2)}`}>
        {slots.map(slot => slot.type === 'mobile' ? (
          <MobileCameraSlot
            key={slot.id}
            slotId={slot.id}
            onRemove={() => removeSlot(slot.id)}
          />
        ) : (
          <CameraSlot
            key={slot.id}
            slotId={slot.id}
            onEventDetected={onEventDetected}
            onRemove={() => removeSlot(slot.id)}
          />
        ))}
      </div>
    </div>
  )
}
