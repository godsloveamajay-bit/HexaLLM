import { useEffect, useState } from 'react'
import { X, Send } from 'lucide-react'
import { isTauri, pet } from '../lib/tauri'
import { listen } from '@tauri-apps/api/event'

export default function PetPage() {
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('Ready when you are.')
  const [reply, setReply] = useState('')

  useEffect(() => {
    if (!isTauri()) return
    let unlistenStatus: (() => void) | undefined
    let unlistenReply: (() => void) | undefined
    ;(async () => {
      unlistenStatus = await listen('pet:status', (e: any) => {
        setStatus(e?.payload?.status || 'idle')
        setMessage(e?.payload?.message || 'Ready when you are.')
      })
    })()
    return () => {
      if (unlistenStatus) unlistenStatus()
      if (unlistenReply) unlistenReply()
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
      <div className="relative w-52 rounded-2xl border border-gray-700 bg-gray-900/95 p-3 shadow-2xl">
        <button onClick={close} className="absolute right-2 top-2 text-gray-500 hover:text-gray-200">
          <X className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => isTauri() && pet.focusMain()} className="block w-full text-center">
          <div className={`text-5xl mb-2 ${status === 'working' ? 'animate-bounce' : ''}`}>{emoji}</div>
          <p className="text-xs font-medium text-gray-200">{mood}</p>
          <p className="mt-1 text-[11px] text-gray-500 line-clamp-3">{message}</p>
        </button>
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
