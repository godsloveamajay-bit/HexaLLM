import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ElementType, ReactNode } from 'react'

/** Scroll-triggered entrance: fades + rises the first time the element enters
 *  the viewport, then stays. Delay (ms) staggers siblings. Reduced-motion
 *  users get instant, static content. */
export default function Reveal({
  children,
  as: Tag = 'div',
  className,
  delay = 0,
  y = 22,
  style,
}: {
  children: ReactNode
  as?: ElementType
  className?: string
  delay?: number
  y?: number
  style?: CSSProperties
}) {
  const ref = useRef<HTMLElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setShown(true); return }
    // Anything already inside the viewport at mount shows immediately —
    // never wait for an IO callback that may lag a frame.
    const rect = el.getBoundingClientRect()
    if (rect.top < (window.innerHeight || document.documentElement.clientHeight) * 1.05) {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const reduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const revealStyle: CSSProperties = reduced
    ? {}
    : {
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : `translateY(${y}px)`,
        transition: `opacity 0.65s ease-out ${delay}ms, transform 0.65s cubic-bezier(0.22,0.61,0.36,1) ${delay}ms`,
        willChange: 'opacity, transform',
      }

  return (
    <Tag ref={ref as any} className={className} style={{ ...revealStyle, ...style }}>
      {children}
    </Tag>
  )
}