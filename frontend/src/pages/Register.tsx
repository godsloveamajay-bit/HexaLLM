import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../store/auth'
import { baseURL } from '../lib/api'
import toast from 'react-hot-toast'
import { LogoMark } from '../components/Logo'

const PROVIDERS = [
  { id: 'google', label: 'Google' },
]

function oauthRedirect(provider: string) {
  const state = crypto.randomUUID()
  sessionStorage.setItem('oauth_state', state)
  window.location.href = `${baseURL}/auth/oauth/${provider}?state=${encodeURIComponent(state)}`
}

function parseApiError(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail[0]?.msg ?? fallback
  const error = err?.response?.data?.error
  if (typeof error === 'string') {
    if (error.toLowerCase().includes('rate limit')) return 'Too many attempts — wait a minute and try again.'
    return error
  }
  if (err?.message === 'Network Error') return 'Cannot reach server — check your connection.'
  return fallback
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const { register } = useAuth()
  const [form, setForm] = useState({ email: '', username: '', password: '', full_name: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await register(form)
      toast.success('Welcome to HexaLLM AI!')
      const { user } = useAuth.getState()
      navigate(user?.is_admin ? '/dashboard' : '/chat', { replace: true })
    } catch (err: any) {
      toast.error(parseApiError(err, 'Registration failed — please try again.'))
    } finally {
      setLoading(false)
    }
  }

  const update = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <LogoMark size={56} className="mb-4" />
          <h1 className="text-2xl font-bold text-gray-100">HexaLLM AI</h1>
          <p className="text-gray-500 text-sm mt-1">Open-source AI Platform</p>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-100 mb-6">Create your account</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Full Name</label>
              <input className="input" placeholder="John Doe" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} autoComplete="name" />
            </div>
            <div>
              <label className="label">Username</label>
              <input className="input" placeholder="johndoe" value={form.username} onChange={(e) => update('username', e.target.value)} autoComplete="username" required />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" placeholder="you@example.com" value={form.email} onChange={(e) => update('email', e.target.value)} autoComplete="email" required />
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="Min. 8 characters"
                  value={form.password}
                  onChange={(e) => update('password', e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Create Account
            </button>
          </form>
          <p className="text-center text-sm text-gray-500 mt-5">
            Already have an account?{' '}
            <Link to="/login" className="text-primary-400 hover:text-primary-300 font-medium">Sign in</Link>
          </p>

          <div className="mt-6">
            <div className="relative flex items-center">
              <div className="flex-1 border-t border-gray-800" />
              <span className="px-3 text-xs text-gray-600">or sign up with</span>
              <div className="flex-1 border-t border-gray-800" />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2">
              {PROVIDERS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => oauthRedirect(id)}
                  className="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-900 hover:bg-gray-800 hover:border-gray-600 text-gray-300 text-sm font-medium transition-colors"
                >
                  Continue with {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
