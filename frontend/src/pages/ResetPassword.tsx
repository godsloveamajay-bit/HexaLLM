import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Sparkle, Loader2, Lock, CheckCircle2, AlertCircle } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) toast.error('Missing reset token')
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { toast.error('Passwords do not match'); return }
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return }

    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, new_password: password })
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Reset failed. The link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center shadow-2xl shadow-primary-900/60 mb-4">
            <Sparkle className="w-8 h-8 text-white fill-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-100">HexaLLM</h1>
          <p className="text-gray-500 text-sm mt-1">Open-source AI Platform</p>
        </div>

        <div className="card">
          {!token ? (
            <div className="text-center space-y-4 py-2">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
              <h2 className="text-lg font-semibold text-gray-100">Invalid link</h2>
              <p className="text-sm text-gray-400">This reset link is missing or malformed.</p>
              <Link to="/forgot-password" className="btn-primary w-full justify-center inline-flex">
                Request a new link
              </Link>
            </div>
          ) : done ? (
            <div className="text-center space-y-4 py-2">
              <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
              <h2 className="text-lg font-semibold text-gray-100">Password updated!</h2>
              <p className="text-sm text-gray-400">Redirecting you to Sign In…</p>
              <Link to="/login" className="btn-primary w-full justify-center inline-flex">
                Sign In now
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-100 mb-1">Set a new password</h2>
              <p className="text-sm text-gray-500 mb-6">Must be at least 8 characters.</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="password"
                      className="input pl-9"
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      minLength={8}
                      autoFocus
                    />
                  </div>
                </div>
                <div>
                  <label className="label">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      type="password"
                      className="input pl-9"
                      placeholder="••••••••"
                      value={confirm}
                      onChange={e => setConfirm(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  Reset Password
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
