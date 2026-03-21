import { useState, useEffect, useRef, useCallback } from 'react'
import { registerCamera, updateCamera } from '../services/cameraService'
import { detectJSON } from '../services/aiService'
import './WebcamFeed.css'

const FRAME_INTERVAL_MS = 2000

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

export default function WebcamFeed({ onEventDetected }) {
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const overlayRef  = useRef(null)
  const streamRef   = useRef(null)
  const intervalRef = useRef(null)
  const sendingRef  = useRef(false)      // FIX 1: ref guard instead of state — no stale closure

  const [status, setStatus]         = useState('idle')
  const [camera, setCamera]         = useState(null)
  const [detections, setDetections] = useState([])
  const [lastEvent, setLastEvent]   = useState(null)
  const [frameCount, setFrameCount] = useState(0)
  const [sending, setSending]       = useState(false)  // UI indicator only
  const [error, setError]           = useState('')
  const [location, setLocation]     = useState('Test Lab — Laptop')

  // ─── Start webcam ──────────────────────────────────────────────────────────
  const startWebcam = async () => {
    setError('')
    setStatus('registering')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      const camId = `laptop-${Date.now()}`
      const registered = await registerCamera({
        camera_id:   camId,
        name:        `Laptop Webcam — ${location}`,
        camera_type: 'laptop',
        location,
        metadata: { source: 'browser', userAgent: navigator.userAgent },
      })
      setCamera(registered)
      setStatus('active')
      startFrameLoop(camId)
    } catch (err) {
      setError(err.message.includes('Permission')
        ? 'Camera permission denied. Please allow camera access and try again.'
        : err.message)
      setStatus('error')
    }
  }

  // ─── Stop webcam ───────────────────────────────────────────────────────────
  const stopWebcam = async () => {
    clearInterval(intervalRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
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
    sendingRef.current = false
    setSending(false)
  }

  // ─── Overlay drawing ────────────────────────────────────────────────────────
  const drawOverlay = useCallback((result) => {
    const overlay = overlayRef.current
    const video   = videoRef.current
    if (!overlay || !video) return
    overlay.width  = video.videoWidth  || 640
    overlay.height = video.videoHeight || 480
    const ctx = overlay.getContext('2d')
    ctx.clearRect(0, 0, overlay.width, overlay.height)

    const dets = result.detections || []
    dets.forEach(detection => {
      if (detection.bounding_box) {
        const bbox  = detection.bounding_box
        const color = detection.label?.toLowerCase().includes('weapon') ? '#FF0000' : '#FF8C00'
        ctx.strokeStyle = color
        ctx.lineWidth   = 2
        ctx.strokeRect(bbox.x1, bbox.y1, bbox.width, bbox.height)

        const label = `${detection.label} ${Math.round((detection.confidence || 0) * 100)}%`
        ctx.font = '12px sans-serif'
        const textW = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.fillRect(bbox.x1, bbox.y1 - 18, textW + 6, 18)
        ctx.fillStyle = color
        ctx.fillText(label, bbox.x1 + 3, bbox.y1 - 4)
      }

      if (detection.keypoints) {
        const kps = detection.keypoints
        const w   = overlay.width
        const h   = overlay.height
        ctx.strokeStyle = '#FFFF00'
        ctx.lineWidth   = 2
        ctx.beginPath()
        SKELETON_CONNECTIONS.forEach(([a, b]) => {
          if (kps[a] && kps[b] && kps[a].visibility > 0.5 && kps[b].visibility > 0.5) {
            ctx.moveTo(kps[a].x * w, kps[a].y * h)
            ctx.lineTo(kps[b].x * w, kps[b].y * h)
          }
        })
        ctx.stroke()
        kps.forEach(kp => {
          if (kp.visibility > 0.5) {
            ctx.beginPath()
            ctx.arc(kp.x * w, kp.y * h, 3, 0, Math.PI * 2)
            ctx.fillStyle = '#FFFF00'
            ctx.fill()
          }
        })
      }
    })
  }, [])

  // ─── Frame capture ─────────────────────────────────────────────────────────
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

  // FIX 1: use sendingRef.current as guard — stable across re-renders
  // FIX 4: call onEventDetected for ALL detections, not just high/critical
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
      // FIX 4: notify Overview of every detection so counts stay live
      if (result.detections?.length > 0) {
        onEventDetected?.(result)
      }
    } catch (err) {
      console.warn('Frame send error:', err.message)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }, [captureFrame, drawOverlay, location, onEventDetected])
  // FIX 1: removed `sending` from deps — ref handles the guard now

  // FIX 1: startFrameLoop no longer recreated on every send
  const startFrameLoop = useCallback((cameraId) => {
    clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => sendFrame(cameraId), FRAME_INTERVAL_MS)
  }, [sendFrame])

  // FIX 2: removed frameCount from deps — no more re-render loop
  // FIX 3: removed unused fps state entirely
  useEffect(() => () => {
    clearInterval(intervalRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  const riskColor = lastEvent ? (SEVERITY_COLORS[lastEvent.severity] || '#22C55E') : '#22C55E'

  return (
    <div className="wcf-root">
      <div className="wcf-header">
        <div className="wcf-title-row">
          <span className="wcf-title">Live Webcam Feed</span>
          {status === 'active' && (
            <span className="wcf-live-badge">
              <span className="wcf-live-dot" />
              LIVE
            </span>
          )}
        </div>
        {camera && <div className="wcf-cam-id">{camera.camera_id}</div>}
      </div>

      <div className="wcf-video-wrap">
        <video ref={videoRef} className="wcf-video" muted playsInline autoPlay />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <canvas ref={overlayRef} style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
        }} />

        {status === 'active' && detections.length > 0 && (
          <div className="wcf-detections-overlay">
            {detections.slice(0, 3).map((d, i) => (
              <div key={i} className="wcf-det-pill"
                style={{ background: `${riskColor}22`, borderColor: riskColor }}>
                <span style={{ color: riskColor }}>{d.label}</span>
                <span className="wcf-det-conf">{Math.round((d.confidence || 0) * 100)}%</span>
              </div>
            ))}
          </div>
        )}

        {status === 'idle' && (
          <div className="wcf-placeholder">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="6" width="20" height="14" rx="2" stroke="#333" strokeWidth="1.5"/>
              <circle cx="12" cy="13" r="4" stroke="#333" strokeWidth="1.5"/>
              <path d="M8 6l2-3h4l2 3" stroke="#333" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
            <span>Camera inactive</span>
          </div>
        )}

        {status === 'registering' && (
          <div className="wcf-placeholder">
            <div className="wcf-spinner" />
            <span>Registering camera...</span>
          </div>
        )}

        {status === 'error' && (
          <div className="wcf-placeholder error">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#E24B4A" strokeWidth="1.5"/>
              <path d="M12 8v4M12 16h.01" stroke="#E24B4A" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span style={{ color: '#E24B4A' }}>{error}</span>
          </div>
        )}

        {sending && <div className="wcf-sending-dot" title="Sending frame to CV engine" />}
      </div>

      <div className="wcf-controls">
        <input className="wcf-location-input"
          placeholder="Location label e.g. Main Gate"
          value={location}
          onChange={e => setLocation(e.target.value)}
          disabled={status === 'active'}
        />
        {status === 'active' ? (
          <button className="btn wcf-btn-stop" onClick={stopWebcam}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/>
            </svg>
            Stop
          </button>
        ) : (
          <button className="btn btn-primary wcf-btn-start"
            onClick={startWebcam}
            disabled={status === 'registering'}>
            {status === 'registering' ? 'Starting...' : (
              <>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10 8l6 4-6 4V8z" fill="currentColor"/>
                </svg>
                Start Feed
              </>
            )}
          </button>
        )}
      </div>

      {status === 'active' && (
        <div className="wcf-stats">
          <div className="wcf-stat">
            <span className="wcf-stat-key">Frames sent</span>
            <span className="wcf-stat-val">{frameCount}</span>
          </div>
          <div className="wcf-stat">
            <span className="wcf-stat-key">Detections</span>
            <span className="wcf-stat-val">{detections.length}</span>
          </div>
          <div className="wcf-stat">
            <span className="wcf-stat-key">Risk score</span>
            <span className="wcf-stat-val" style={{ color: riskColor }}>
              {lastEvent?.risk_score ?? '—'}
            </span>
          </div>
          <div className="wcf-stat">
            <span className="wcf-stat-key">Severity</span>
            <span className="wcf-stat-val" style={{ color: riskColor, textTransform: 'capitalize' }}>
              {lastEvent?.severity ?? '—'}
            </span>
          </div>
        </div>
      )}

      {lastEvent?.summary && (
        <div className="wcf-summary" style={{ borderLeftColor: riskColor }}>
          <span className="wcf-summary-label">CV Summary</span>
          <p className="wcf-summary-text">{lastEvent.summary}</p>
        </div>
      )}
    </div>
  )
}