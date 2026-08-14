import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Sparkle, Loader2, AlertCircle, User, Globe, MessageSquare, Cpu, Shield } from 'lucide-react'
import { baseURL } from '../lib/api'
import { useAuth } from '../store/auth'
import { prettyModel } from '../lib/models'

interface SharedModel {
  name: string; slug: string; description?: string; base_model: string;
  tags: string[]; parameter_count?: string; license: string;
  system_prompt?: string; downloads: number; likes: number; owner_username?: string;
}

export default function SharedModelPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [model, setModel] = useState<SharedModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!slug) return
    fetch(`${baseURL}/models/slug/${slug}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found')
        return r.json()
      })
      .then(setModel)
      .catch(() => setError('This model could not be found. It may have been removed or made private.'))
      .finally(() => setLoading(false))
  }, [slug])

  const useInChat = () => {
    const target = `/chat?model=custom:${slug}`
    if (user) navigate(target)
    else navigate(`/login?next=${encodeURIComponent(target)}`)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <Sparkle className="w-5 h-5 text-primary-400 fill-primary-400" />
        <span className="font-semibold text-gray-100">HexaLLM</span>
        <span className="text-gray-600 text-sm ml-2">Model Hub</span>
        <Link to="/login" className="ml-auto text-sm text-primary-400 hover:text-primary-300">
          {user ? 'Dashboard →' : 'Sign in →'}
        </Link>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-10">
        {loading && (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-20 text-gray-500">
            <AlertCircle className="w-10 h-10" />
            <p className="text-center">{error}</p>
            <Link to="/" className="text-sm text-primary-400 hover:text-primary-300 mt-2">Back to HexaLLM →</Link>
          </div>
        )}

        {model && (
          <>
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="badge bg-green-900/40 text-green-300"><Globe className="w-3 h-3 mr-1" />public</span>
                {model.parameter_count && <span className="badge bg-gray-800 text-gray-400">{model.parameter_count}</span>}
                <span className="badge bg-gray-800 text-gray-400">{model.license}</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-100">{model.name}</h1>
              <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                <User className="w-3.5 h-3.5" /> by {model.owner_username}
              </p>
            </div>

            {model.description && (
              <p className="text-gray-300 mb-6">{model.description}</p>
            )}

            <div className="flex flex-wrap gap-1.5 mb-6">
              <span className="badge bg-primary-400/10 text-primary-300 ring-primary-400/30">
                <Cpu className="w-3 h-3 mr-1" />{prettyModel(model.base_model)}
              </span>
              {model.tags.map((t) => (
                <span key={t} className="badge bg-secondary-400/10 text-secondary-300 ring-secondary-400/30">{t}</span>
              ))}
            </div>

            {model.system_prompt && (
              <div className="card mb-6">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                  <Shield className="w-3.5 h-3.5" /> Personality &amp; instructions baked into this model
                </div>
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{model.system_prompt}</p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={useInChat} className="btn-primary flex-1 justify-center">
                <MessageSquare className="w-4 h-4" /> Use in Chat
              </button>
              <Link to="/models" className="btn-secondary flex-1 justify-center">Open Model Hub</Link>
            </div>

            <p className="text-xs text-gray-600 mt-4 text-center">
              {model.downloads} uses · {model.likes} likes · Sign in to chat with this model
            </p>
          </>
        )}
      </div>
    </div>
  )
}