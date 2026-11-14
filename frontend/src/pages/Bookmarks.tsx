import { useEffect, useState } from 'react'
import { Star, MessageSquare, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { useSessions } from '../store/sessions'
import toast from 'react-hot-toast'

interface Bookmark {
  id: number
  session_id: number
  session_title: string
  role: string
  content: string
  created_at: string
}

export default function BookmarksPage() {
  const navigate = useNavigate()
  const { fetch: fetchSessions, setActive } = useSessions()
  const [items, setItems] = useState<Bookmark[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/chat/bookmarks')
      setItems(data || [])
    } catch {
      toast.error('Failed to load bookmarks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const open = async (sessionId: number) => {
    await fetchSessions()
    setActive(sessionId)
    navigate('/chat')
  }

  const unbookmark = async (id: number) => {
    try {
      await api.post(`/chat/messages/${id}/bookmark`)
      setItems((xs) => xs.filter((x) => x.id !== id))
      toast.success('Bookmark removed')
    } catch {
      toast.error('Failed to update bookmark')
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Bookmarked Messages</h1>
        <p className="text-gray-400 mt-1">Saved messages across your chats.</p>
      </div>

      {loading ? (
        <div className="py-10 flex justify-center text-gray-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="card py-10 text-center text-gray-500">
          <Star className="w-10 h-10 mx-auto mb-2" />
          <p>No bookmarked messages yet. Use “Save” on any chat message.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="card">
              <div className="flex items-center justify-between gap-3 mb-2">
                <button onClick={() => open(item.session_id)} className="text-sm font-medium text-primary-400 hover:underline">
                  {item.session_title}
                </button>
                <button onClick={() => unbookmark(item.id)} className="text-gray-600 hover:text-red-400 p-1" title="Remove bookmark">
                  <Star className="w-4 h-4 fill-current text-primary-400" />
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-1">{item.role} · {new Date(item.created_at).toLocaleString()}</p>
              <p className="text-sm text-gray-300 whitespace-pre-wrap line-clamp-6">{item.content}</p>
              <button onClick={() => open(item.session_id)} className="mt-2 inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200">
                <MessageSquare className="w-3.5 h-3.5" /> Open chat
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
