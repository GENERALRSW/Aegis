/**
 * Gauge
 * Circular arc progress indicator used in detection cards
 * @param {number} value    - Current value
 * @param {number} max      - Maximum value (default: 24)
 * @param {string} color    - Stroke color
 * @param {number} size     - SVG size in px (default: 110)
 */
export default function Gauge({ value, max = 24, color, size = 110 }) {
  const r = size * 0.4
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r
  const arcFraction = 0.73
  const arcLen = circ * arcFraction
  const filled = Math.min((value / max) * arcLen, arcLen)
  const startAngle = 135

  const trackStyle = {
    transform: `rotate(${startAngle}deg)`,
    transformOrigin: `${cx}px ${cy}px`,
  }

  const fillStyle = {
    ...trackStyle,
    transition: 'stroke-dasharray 0.8s ease',
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0 }}
    >
      {/* Track */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="var(--dim)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${arcLen} ${circ}`}
        style={trackStyle}
      />
      {/* Fill */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${circ - filled}`}
        style={fillStyle}
      />
      {/* Value */}
      <text
        x={cx} y={cy + size * 0.075}
        textAnchor="middle"
        fill="white"
        fontSize={size * 0.2}
        fontWeight="700"
        fontFamily="var(--font-mono)"
      >
        {String(value).padStart(2, '0')}
      </text>
    </svg>
  )
}
