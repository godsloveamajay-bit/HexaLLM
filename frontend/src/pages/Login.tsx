import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Eye, EyeOff } from 'lucide-react'
import { useAuth } from '../store/auth'
import { baseURL } from '../lib/api'
import toast from 'react-hot-toast'
import { LogoMark } from '../components/Logo'

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

const PROVIDERS = [
  { id: 'google', label: 'Google', icon: GoogleIcon },
]

function oauthRedirect(provider: string) {
  const state = crypto.randomUUID()
  sessionStorage.setItem('oauth_state', state)
  window.location.href = `${baseURL}/auth/oauth/${provider}?state=${encodeURIComponent(state)}`
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const err = searchParams.get('oauth_error')
    if (err) toast.error(`Sign-in failed: ${err.replace(/_/g, ' ')}`)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await login(email, password)
      const { user } = useAuth.getState()
      navigate(user?.is_admin ? '/dashboard' : '/chat', { replace: true })
    } catch (err: any) {
      toast.error(parseApiError(err, 'Login failed — check your email and password.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <LogoMark size={56} className="mb-4" />
          <h1 className="text-2xl font-bold text-gray-100">HexaLLM AI</h1>
          <p className="text-gray-500 text-sm mt-1">Open-source AI Platform</p>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-100 mb-6">Sign in to your account</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label className="label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
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
              Sign In
            </button>
          </form>
          <div className="mt-5 flex items-center justify-between text-sm">
            <p className="text-gray-500">
              Don't have an account?{' '}
              <Link to="/register" className="text-primary-400 hover:text-primary-300 font-medium">
                Sign up
              </Link>
            </p>
            <Link to="/forgot-password" className="text-gray-500 hover:text-gray-300 transition-colors">
              Forgot password?
            </Link>
          </div>

          <div className="mt-6">
            <div className="relative flex items-center">
              <div className="flex-1 border-t border-gray-800" />
              <span className="px-3 text-xs text-gray-600">or continue with</span>
              <div className="flex-1 border-t border-gray-800" />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2">
              {PROVIDERS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => oauthRedirect(id)}
                  className="flex items-center justify-center gap-3 w-full px-4 py-2.5 rounded-lg border border-gray-700 bg-gray-900 hover:bg-gray-800 hover:border-gray-600 text-gray-300 text-sm font-medium transition-colors"
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  Sign in with {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-center text-xs text-gray-600 mt-6">
          <Link to="/privacy" className="hover:text-gray-400 transition-colors">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}
