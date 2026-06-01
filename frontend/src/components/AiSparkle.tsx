import { useId } from 'react'

/**
 * Animated "AI" sparkle — a four-point twinkling star with a warm
 * orange→pink gradient that slowly rotates while its points breathe in and
 * out, flanked by two little companion sparkles that pop on a stagger.
 *
 * When `active` it runs the full twinkle (used while the assistant is
 * streaming a reply); otherwise it renders a calm, static sparkle with just a
 * soft glow, so a long thread isn't full of spinning stars.
 *
 * Motion is driven by CSS keyframes (see index.css) using
 * `transform-box: fill-box`, which makes every scale/rotate pivot on the
 * element's own centre — SMIL `scale` pivots on the SVG origin instead and
 * would make the star drift.
 */
export default function AiSparkle({
  size = 28,
  active = false,
  className = '',
}: {
  size?: number
  active?: boolean
  className?: string
}) {
  // useId keeps the gradient/filter ids unique per instance so multiple
  // sparkles on one page don't clash.
  const uid = useId().replace(/:/g, '')
  const grad = `sparkle-grad-${uid}`
  const glow = `sparkle-glow-${uid}`

  // Four-point sparkle path: a star with concave (curved-in) sides.
  const star = (cx: number, cy: number, r: number, k = 0.16) => {
    const c = r * k
    return (
      `M${cx} ${cy - r}` +
      `Q${cx + c} ${cy - c} ${cx + r} ${cy}` +
      `Q${cx + c} ${cy + c} ${cx} ${cy + r}` +
      `Q${cx - c} ${cy + c} ${cx - r} ${cy}` +
      `Q${cx - c} ${cy - c} ${cx} ${cy - r}Z`
    )
  }

  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      style={{ overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="0.45" y2="1">
          <stop offset="0%" stopColor="#ffd5a6" />
          <stop offset="35%" stopColor="#fb923c" />
          <stop offset="70%" stopColor="#f9518f" />
          <stop offset="100%" stopColor="#ef3b6b" />
        </linearGradient>
        <filter id={glow} x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation={active ? 1.1 : 0.6} result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Main star: outer <g> spins, inner <path> breathes. */}
      <g filter={`url(#${glow})`} className={active ? 'ai-sparkle-spin' : undefined}>
        <path
          d={star(14, 16, 10)}
          fill={`url(#${grad})`}
          className={active ? 'ai-sparkle-breathe' : undefined}
        />
      </g>

      {/* Companion sparkle — top right */}
      <path
        d={star(26, 7, 3.2)}
        fill={`url(#${grad})`}
        className={active ? 'ai-sparkle-pop' : undefined}
        opacity={active ? undefined : 0.7}
      />

      {/* Companion sparkle — bottom left */}
      <path
        d={star(5, 27, 2.1)}
        fill={`url(#${grad})`}
        className={active ? 'ai-sparkle-pop-2' : undefined}
        opacity={active ? undefined : 0.55}
      />
    </svg>
  )
}
