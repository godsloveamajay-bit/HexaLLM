import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { isTauri, pet } from '../lib/tauri'
import { listen } from '@tauri-apps/api/event'

export default function PetPage() {
  const [status, setStatus] = useState('idle')
  const [message, setMessage] = useState('Ready when you are.')

  useEffect(() => {
    if (!isTauri()) return
    let unlisten: (() => void) | undefined
    ;(async () => {
      unlisten = await listen('pet:status', (e: any) => {
        setStatus(e?.payload?.status || 'idle')
        setMessage(e?.payload?.message || 'Ready when you are.')
      })
    })()
    return () => { if (unlisten) unlisten() }
  }, [])

  const close = async () => {
    if (isTauri()) await pet.close()
    else window.close()
  }

  const emoji = status === 'working' ? '🐾' : status === 'done' ? '✅' : status === 'needs_input' ? '❓' : '🐾'
  const mood = status === 'working' ? 'Working…' : status === 'done' ? 'Done' : status === 'needs_input' ? 'Needs you' : 'Idle'

  return (
    <div className="h-screen w-screen flex items-end justify-center p-3 select-none" style={{ background: 'transparent' }}>
      <div className="relative w-44 rounded-2xl border border-gray-700 bg-gray-900/95 p-3 text-center shadow-2xl">
        <button onClick={close} className="absolute right-2 top-2 text-gray-500 hover:text-gray-200">
          <X className="w-3.5 h-3.5" />
        </button>
        <div className={`text-5xl mb-2 ${status === 'working' ? 'animate-bounce' : ''}`}>{emoji}</div>
        <p className="text-xs font-medium text-gray-200">{mood}</p>
        <p className="mt-1 text-[11px] text-gray-500 line-clamp-3">{message}</p>
      </div>
    </div>
  )
}
