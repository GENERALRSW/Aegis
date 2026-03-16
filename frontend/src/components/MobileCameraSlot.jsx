import { useState, useEffect, useRef } from 'react'

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
}

function makeRoomId() {
  return Math.random().toString(36).slice(2, 9).toUpperCase()
}

export default function MobileCameraSlot({ slotId, onRemove }) {
  const [roomId]        = useState(makeRoomId)
  const [status, setStatus] = useState('waiting')    // waiting | connected
  const [copied, setCopied] = useState(false)
  const [hostOverride, setHostOverride] = useState('')

  const videoRef = useRef(null)
  const pcRef    = useRef(null)
  const wsRef    = useRef(null)

  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const effectiveHost = hostOverride || window.location.host
  const proto   = window.location.protocol
  const wsProto = proto === 'https:' ? 'wss' : 'ws'

  const mobileUrl = `${proto}//${effectiveHost}/mobile?room=${roomId}`
  const wsUrl     = `${wsProto}://${window.location.host}/ws/signal`

  useEffect(() => {
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', room: roomId, role: 'dashboard' }))
    }

    ws.onmessage = async (e) => {
      try {
        const msg = JSON.parse(e.data)

        if (msg.type === 'offer') {
          const pc = new RTCPeerConnection(ICE_CONFIG)
          pcRef.current = pc

          pc.ontrack = (ev) => {
            if (videoRef.current && ev.streams[0]) {
              videoRef.current.srcObject = ev.streams[0]
              setStatus('connected')
            }
          }

          pc.onicecandidate = (ev) => {
            if (ev.candidate) {
              ws.send(JSON.stringify({ type: 'ice-candidate', room: roomId, data: ev.candidate }))
            }
          }

          pc.onconnectionstatechange = () => {
            if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
              if (videoRef.current) videoRef.current.srcObject = null
              setStatus('waiting')
            }
          }

          await pc.setRemoteDescription(new RTCSessionDescription(msg.data))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          ws.send(JSON.stringify({ type: 'answer', room: roomId, data: answer }))
        }

        if (msg.type === 'ice-candidate' && pcRef.current) {
          try { await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.data)) } catch {}
        }
      } catch {}
    }

    return () => {
      ws.close()
      pcRef.current?.close()
    }
  }, [roomId, wsUrl])

  const copyUrl = () => {
    navigator.clipboard.writeText(mobileUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="cs-slot">
      {/* Header */}
      <div className="cs-header">
        <div className="cs-header-left">
          <span className="cs-slot-label">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" style={{ marginRight: 4, verticalAlign: 'middle' }}>
              <rect x="7" y="2" width="10" height="20" rx="2" stroke="currentColor" strokeWidth="1.8"/>
              <circle cx="12" cy="18" r="1.2" fill="currentColor"/>
            </svg>
            MOBILE {slotId}
          </span>
          {status === 'connected' ? (
            <span className="cs-live-badge">
              <span className="cs-live-dot" />
              LIVE
            </span>
          ) : (
            <span className="cs-mobile-waiting-badge">Waiting for phone</span>
          )}
        </div>
        <button className="cs-remove-btn" onClick={onRemove} title="Remove slot">×</button>
      </div>

      {/* Video */}
      <div className="cs-video-wrap">
        <video ref={videoRef} className="cs-video" autoPlay playsInline muted />
        {status !== 'connected' && (
          <div className="cs-placeholder">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <rect x="7" y="2" width="10" height="20" rx="2" stroke="#2a2a2a" strokeWidth="1.5"/>
              <circle cx="12" cy="18" r="1" fill="#2a2a2a"/>
            </svg>
            <span>Open URL on your iPhone</span>
          </div>
        )}
      </div>

      {/* URL panel */}
      <div className="cs-mobile-panel">
        {isLocalhost && (
          <div className="cs-mobile-ip-row">
            <span className="cs-mobile-ip-label">Mac IP</span>
            <input
              className="cs-mobile-ip-input"
              placeholder="e.g. 192.168.1.42:5173"
              value={hostOverride}
              onChange={e => setHostOverride(e.target.value)}
            />
          </div>
        )}
        <div className="cs-mobile-url-row">
          <span className="cs-mobile-url-text" title={mobileUrl}>{mobileUrl}</span>
          <button className="cs-mobile-copy-btn" onClick={copyUrl}>
            {copied ? '✓' : 'Copy'}
          </button>
        </div>
        {isLocalhost && (
          <p className="cs-mobile-hint">
            Find your Mac's IP: System Settings → Wi-Fi → Details → IP Address
          </p>
        )}
        {!isLocalhost && (
          <p className="cs-mobile-hint">
            Open the URL above in Safari on your iPhone (accept the cert warning once).
          </p>
        )}
      </div>
    </div>
  )
}
