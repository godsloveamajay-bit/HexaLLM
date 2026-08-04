import { useState, useEffect } from 'react'
import { Brain, Plus, Trash2, Loader2, Zap, RefreshCw } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface Memory {
  id: number
  content: string
  source: 'manual' | 'auto'
  session_id: number | null
  created_at: string
}

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [newFact, setNewFact] = useState('')
  const [adding, setAdding] = useState(false)
  const [extracting, setExtracting] = useState(false)

  const load = async () => {
    try {
      const { data } = await api.get('/memory')
      setMemories(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const add = async () => {
    if (!newFact.trim()) return
    setAdding(true)
    try {
      const { data } = await api.post('/memory', { content: newFact.trim() })
      setMemories((m) => [data, ...m])
      setNewFact('')
      toast.success('Memory saved')
    } catch {
      toast.error('Failed to save')
    } finally {
      setAdding(false) }
  }

  const remove = async (id: number) => {
    try {
      await api.delete(`/memory/${id}`)
      setMemories((m) => m.filter((x) => x.id !== id))
    } catch {
      toast.error('Failed to delete')
    }
  }

  const clearAll = async () => {
    if (!confirm('Clear all memories? This cannot be undone.')) return
    try {
      await api.delete('/memory')
      setMemories([])
      toast.success('All memories cleared')
    } catch {
      toast.error('Failed to clear')
    }
  }

  const autoExtract = async () => {
    try {
      const { data: sessions } = await api.get('/chat/sessions?limit=5')
      if (!sessions?.length) { toast('No sessions to extract from', { icon: 'ℹ️' }); return }
      setExtracting(true)
      let total = 0
      for (const session of sessions.slice(0, 3)) {
        const { data: msgs } = await api.get(`/chat/sessions/${session.id}/messages`)
        const limited = msgs.slice(-20).map((m: any) => ({ role: m.role, content: m.content }))
        const { data } = await api.post('/memory/extract', { messages: limited, model: 'hex-5.1-prime' })
        total += data.extracted?.length || 0
      }
      await load()
      toast.success(`Extracted ${total} new memories from recent chats`)
    } catch {
      toast.error('Extraction failed')
    } finally {
      setExtracting(false) }
  }

  const manual = memories.filter((m) => m.source === 'manual')
  const auto = memories.filter((m) => m.source === 'auto')

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary-400" /> Memory
          </h1>
          <p className="text-gray-400 mt-1">
            Facts the AI remembers about you — injected into every conversation.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={autoExtract} disabled={extracting} className="btn-secondary gap-1.5 text-sm">
            {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Auto-extract
          </button>
          {memories.length > 0 && (
            <button onClick={clearAll} className="btn-secondary gap-1.5 text-sm text-red-400 hover:text-red-300 border-red-900/40">
              <Trash2 className="w-4 h-4" /> Clear all
            </button>
          )}
        </div>
      </div>

      {/* Add new */}
      <div className="card mb-6">
        <label className="label">Add a memory</label>
        <div className="flex gap-2 mt-1">
          <input
            className="input flex-1"
            value={newFact}
            onChange={(e) => setNewFact(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="e.g. I prefer Python over JavaScript"
          />
          <button onClick={add} disabled={adding || !newFact.trim()} className="btn-primary flex-shrink-0">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
        </div>
      ) : memories.length === 0 ? (
        <div className="text-center py-12 text-gray-600">
          <Brain className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No memories yet. Add one above or use auto-extract.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {auto.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" /> Auto-extracted ({auto.length})
              </h2>
              <div className="space-y-2">
                {auto.map((m) => <MemoryCard key={m.id} memory={m} onDelete={remove} />)}
              </div>
            </section>
          )}
          {manual.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Manual ({manual.length})
              </h2>
              <div className="space-y-2">
                {manual.map((m) => <MemoryCard key={m.id} memory={m} onDelete={remove} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function MemoryCard({ memory, onDelete }: { memory: Memory; onDelete: (id: number) => void }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-gray-800/50 border border-gray-700/50 group hover:border-gray-600/50 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-200">{memory.content}</p>
        <p className="text-xs text-gray-600 mt-1">
          {formatDistanceToNow(new Date(memory.created_at), { addSuffix: true })}
        </p>
      </div>
      <button
        onClick={() => onDelete(memory.id)}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-900/30 text-gray-600 hover:text-red-400 transition-all"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
