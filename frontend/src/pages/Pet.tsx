import { useEffect, useState } from 'react'
import { X, Send } from 'lucide-react'
import { isTauri, pet } from '../lib/tauri'
import { listen } from '@tauri-apps/api/event'
import { cursorPosition, getCurrentWindow } from '@tauri-apps/api/window'

export default function PetPage() {
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('Ready when you are.')
  const [reply, setReply] = useState('')
  const [hover, setHover] = useState(false)
  const [eye, setEye] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (!isTauri()) return
    let unlistenStatus: (() => void) | undefined
    ;(async () => {
      unlistenStatus = await listen('pet:status', (e: any) => {
        setStatus(e?.payload?.status || 'idle')
        setMessage(e?.payload?.message || 'Ready when you are.')
      })
    })()

    let timer: number | undefined
    const track = async () => {
      try {
        const win = getCurrentWindow()
        const pos = await win.outerPosition()
        const scale = await win.scaleFactor()
        const cursor = await cursorPosition()
        const cx = pos.x / scale + window.innerWidth / 2
        const cy = pos.y / scale + window.innerHeight / 2
        const dx = cursor.x / scale - cx
        const dy = cursor.y / scale - cy
        const dist = Math.hypot(dx, dy) || 1
        const max = 5
        const amount = Math.min(1, dist / 120)
        setEye({ x: (dx / dist) * max * amount, y: (dy / dist) * max * amount })
      } catch {
        // ignore transient windowing errors
      }
    }
    timer = window.setInterval(track, 60)
    track()

    return () => {
      if (unlistenStatus) unlistenStatus()
      if (timer) window.clearInterval(timer)
    }
  }, [])

  const close = async () => {
    if (isTauri()) await pet.close()
    else window.close()
  }

  const sendReply = async () => {
    if (!reply.trim()) return
    if (isTauri()) await pet.reply(reply.trim())
    setReply('')
  }

  const emoji = status === 'working' ? '🐾' : status === 'done' ? '✅' : status === 'needs_input' ? '❓' : '🐾'
  const mood = status === 'working' ? 'Working…' : status === 'done' ? 'Done' : status === 'needs_input' ? 'Needs you' : 'Idle'

  return (
    <div className="h-screen w-screen flex items-end justify-center p-3 select-none" style={{ background: 'transparent' }}>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => isTauri() && pet.focusMain()}
        className={`relative w-52 rounded-2xl border border-gray-700 bg-gray-900/95 p-3 text-center shadow-2xl transition-transform duration-200 ${hover ? 'scale-105' : 'scale-100'}`}
        style={{ cursor: 'pointer' }}
      >
        <button onClick={(e) => { e.stopPropagation(); close() }} className="absolute right-2 top-2 text-gray-500 hover:text-gray-200">
          <X className="w-3.5 h-3.5" />
        </button>
        <div className={`text-5xl mb-2 ${status === 'working' ? 'animate-bounce' : hover ? 'animate-pulse' : ''}`}>{emoji}</div>
        <div className="mx-auto mb-2 flex justify-center gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="relative h-4 w-4 rounded-full bg-white/90 overflow-hidden">
              <div
                className="absolute h-2 w-2 rounded-full bg-gray-900"
                style={{ left: `calc(50% - 4px + ${eye.x * 0.45}px)`, top: `calc(50% - 4px + ${eye.y * 0.45}px)` }}
              />
            </div>
          ))}
        </div>
        <p className="text-xs font-medium text-gray-200">{mood}</p>
        <p className="mt-1 text-[11px] text-gray-500 line-clamp-3">{message}</p>
        <div className="mt-3 flex gap-1">
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendReply()}
            placeholder="Reply…"
            className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-2 py-1 text-xs text-gray-200"
          />
          <button onClick={sendReply} className="rounded-lg bg-primary-500 px-2 text-white">
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  )
}
