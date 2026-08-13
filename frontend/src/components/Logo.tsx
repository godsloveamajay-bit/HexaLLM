import { Hexagon } from 'lucide-react'

export function LogoMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-0 rounded-full bg-primary-400/25 blur-md" />
      <Hexagon
        className="relative text-primary-400"
        style={{ width: size, height: size }}
        strokeWidth={1.5}
      />
    </div>
  )
}

export function Logo({
  size = 36,
  textClassName = '',
  className = '',
  text = 'HexaLLM',
  accent = 'LLM',
}: {
  size?: number
  textClassName?: string
  className?: string
  text?: string
  accent?: string
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <LogoMark size={size} />
      <span className={`font-display font-semibold tracking-tight ${textClassName}`}>
        {text}
        {accent && <span className="text-primary-400">{accent}</span>}
      </span>
    </div>
  )
}