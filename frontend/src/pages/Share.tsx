import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Bot, User, Sparkle, Loader2, AlertCircle } from 'lucide-react'
import Markdown from '../components/ui/Markdown'
import { baseURL } from '../lib/api'

interface Message { role: 'user' | 'assistant'; content: string }

export default function SharePage() {
  const { token } = useParams<{ token: string }>()
  const [title, setTitle] = useState('')
  const [model, setModel] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) return
    fetch(`${baseURL}/chat/share/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found')
        return r.json()
      })
      .then((d) => {
        setTitle(d.title)
        setModel(d.model_name)
        setMessages(d.messages)
      })
      .catch(() => setError('This shared conversation could not be found.'))
      .finally(() => setLoading(false))
  }, [token])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <Sparkle className="w-5 h-5 text-primary-400 fill-primary-400" />
        <span className="font-semibold text-gray-100">HexaLLM</span>
        <span className="text-gray-600 text-sm ml-2">Shared conversation</span>
        <Link to="/login" className="ml-auto text-sm text-primary-400 hover:text-primary-300">
          Sign in →
        </Link>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {loading && (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-20 text-gray-500">
            <AlertCircle className="w-10 h-10" />
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="mb-6">
              <h1 className="text-xl font-bold text-gray-100">{title}</h1>
              <p className="text-sm text-gray-500 mt-1">Model: {model}</p>
            </div>

            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  {msg.role === 'user' ? (
                    <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-white" />
                    </div>
                  ) : (
                    <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                      <Sparkle className="w-6 h-6 text-primary-500 fill-primary-500" />
                    </div>
                  )}

                  {msg.role === 'user' ? (
                    <div className="max-w-2xl rounded-2xl rounded-tr-none px-4 py-3 text-sm bg-primary-600 text-white">
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  ) : (
                    <div className="max-w-2xl text-sm text-gray-200 pt-1 prose prose-sm">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
