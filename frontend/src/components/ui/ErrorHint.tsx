import { AlertCircle } from 'lucide-react'

// Quiet, inline error — same visual language as the auto-routing hint:
// tiny, muted, non-intrusive. No banners, no popups.
export default function ErrorHint({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return (
    <div role="alert" className="mt-1.5 flex items-start gap-1.5 text-[11px] text-red-400/80 fade-in">
      <AlertCircle className="w-3 h-3 mt-[1px] text-red-400/60 flex-shrink-0" />
      <span className="leading-snug">{children}</span>
    </div>
  )
}