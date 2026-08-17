import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, Eye, EyeOff, LogIn, Lock, ShieldCheck, ArrowUpRight } from 'lucide-react'
import { useAuth } from '../store/auth'
import { api, baseURL } from '../lib/api'
import { isDevSite } from './isDev'

function oauthRedirect(provider: string) {
  const state = "dev_" + Math.random().toString(36).slice(2)
  sessionStorage.setItem('oauth_state', state)
  window.location.href = `${baseURL}/auth/oauth/${provider}?state=${encodeURIComponent(state)}`
}

function parseApiError(err: any, fallback: string): string {
  return err?.response?.data?.detail || err?.message || fallback
}

export default function DevLogin() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const err = searchParams.get('oauth_error')
    if (err) setError(`Sign-in failed: ${err.replace(/_/g, ' ')}`)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { data } = await api.post('/auth/dev-login', { email, password })
      const { loginWithToken } = useAuth.getState()
      await loginWithToken(data.access_token)
      const { user } = useAuth.getState()
      // dev-login already rejects non-admins server-side; this is a safety net
      if (!user?.is_admin) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        useAuth.setState({ user: null, token: null })
        setError('The dev site is restricted to admin accounts.')
        return
      }
      navigate('/system', { replace: true })
    } catch (err: any) {
      setError(parseApiError(err, 'Sign-in failed — check your email and password.'))
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    background: '#0d1117',
    border: '1px solid #30363d',
    color: '#e6edf3',
    outline: 'none',
    fontSize: 13,
    fontFamily: 'monospace',
    padding: '9px 10px',
    borderRadius: 6,
    width: '100%',
    boxSizing: 'border-box' as const,
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#010409' }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center mb-3 font-mono font-bold text-lg"
            style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.4)', color: '#4ade80' }}
          >
            H
          </div>
          <h1 className="font-mono font-bold text-xl" style={{ color: '#e6edf3' }}>HEXADEV</h1>
          <div className="flex items-center gap-1.5 mt-1.5 font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ color: '#fbbf24', borderColor: 'rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.4)' }}>
            DEV ENV
          </div>
          <p className="font-mono text-xs mt-3 text-center" style={{ color: '#8b949e' }}>
            developer environment · admins only
          </p>
        </div>

        <div className="rounded-xl border p-5" style={{ borderColor: '#30363d', background: '#161b22' }}>
          <h2 className="font-mono font-semibold text-sm mb-4 flex items-center gap-2" style={{ color: '#e6edf3' }}>
            <ShieldCheck size={14} style={{ color: '#4ade80' }} /> sign in to the dev environment
          </h2>

          {error && (
            <div className="font-mono text-[11px] mb-3 p-2 rounded border" style={{ color: 'rgba(248,113,113,0.85)', borderColor: 'rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.05)' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest mb-1 block" style={{ color: '#8b949e' }}>email</label>
              <input
                type="email"
                style={inputStyle}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest mb-1 block" style={{ color: '#8b949e' }}>password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  style={{ ...inputStyle, paddingRight: 34 }}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: '#6e7681' }}
                  tabIndex={-1}
                >
                  {showPassword ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 font-mono text-xs font-semibold py-2.5 rounded transition-colors disabled:opacity-50"
              style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.45)', color: '#4ade80' }}
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
              {loading ? 'verifying…' : 'sign in'}
            </button>
          </form>

          <div className="relative flex items-center my-4">
            <div className="flex-1 border-t" style={{ borderColor: '#30363d' }} />
            <span className="px-3 font-mono text-[10px]" style={{ color: '#6e7681' }}>or continue with</span>
            <div className="flex-1 border-t" style={{ borderColor: '#30363d' }} />
          </div>

          <button
            onClick={() => oauthRedirect('google')}
            className="w-full flex items-center justify-center gap-2 font-mono text-xs py-2.5 rounded border transition-colors hover:bg-[#0d1117]"
            style={{ borderColor: '#30363d', color: '#e6edf3', background: '#0d1117' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l2.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            continue with google
          </button>
        </div>

        <div className="mt-5 font-mono text-[11px] text-center leading-relaxed" style={{ color: '#6e7681' }}>
          <div className="flex items-center justify-center gap-1.5 mb-1.5">
            <Lock size={11} style={{ color: '#4ade80' }} />
            one account for both sites — same credentials as the main site
          </div>
          <div className="flex items-center justify-center gap-3">
            {!isDevSite() ? null : (
              <a href="https://ai.hexallm.co.uk/login" className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: '#4ade80' }}>
                main site <ArrowUpRight size={11} />
              </a>
            )}
            <a href="https://ai.hexallm.co.uk/register" className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: '#4ade80' }}>
              create account <ArrowUpRight size={11} />
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}