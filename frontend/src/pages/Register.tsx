import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Brain, Loader2 } from 'lucide-react'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'

export default function RegisterPage() {
  const navigate = useNavigate()
  const { register } = useAuth()
  const [form, setForm] = useState({ email: '', username: '', password: '', full_name: '' })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await register(form)
      navigate('/dashboard')
      toast.success('Welcome to NebulaX AI!')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const update = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-primary-900/60 mb-4">
            <Brain className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-100">NebulaX AI</h1>
          <p className="text-gray-500 text-sm mt-1">Open-source AI Platform</p>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-100 mb-6">Create your account</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Full Name</label>
              <input className="input" placeholder="John Doe" value={form.full_name} onChange={(e) => update('full_name', e.target.value)} />
            </div>
            <div>
              <label className="label">Username</label>
              <input className="input" placeholder="johndoe" value={form.username} onChange={(e) => update('username', e.target.value)} required />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" placeholder="you@example.com" value={form.email} onChange={(e) => update('email', e.target.value)} required />
            </div>
            <div>
              <label className="label">Password</label>
              <input type="password" className="input" placeholder="••••••••" value={form.password} onChange={(e) => update('password', e.target.value)} required minLength={8} />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Create Account
            </button>
          </form>
          <p className="text-center text-sm text-gray-500 mt-5">
            Already have an account?{' '}
            <Link to="/login" className="text-primary-400 hover:text-primary-300 font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
