import { useState } from 'react'
import { User, Save, Loader2, Shield } from 'lucide-react'
import { useAuth } from '../store/auth'
import api from '../lib/api'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const { user, fetchMe } = useAuth()
  const [form, setForm] = useState({
    full_name: user?.full_name || '',
    bio: user?.bio || '',
    avatar_url: user?.avatar_url || '',
  })
  const [saving, setSaving] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.patch('/auth/me', form)
      await fetchMe()
      toast.success('Profile updated!')
    } catch {
      toast.error('Failed to save')
    } finally { setSaving(false) }
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Settings</h1>
        <p className="text-gray-400 mt-1">Manage your account and preferences</p>
      </div>

      {/* Profile */}
      <div className="card mb-6">
        <div className="flex items-center gap-3 mb-5">
          <User className="w-5 h-5 text-primary-400" />
          <h2 className="font-semibold text-gray-100">Profile</h2>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-500 to-purple-600 flex items-center justify-center text-xl font-bold text-white">
            {user?.username?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-gray-100">{user?.username}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
            {user?.is_admin && (
              <span className="badge bg-primary-900/40 text-primary-300 mt-1">
                <Shield className="w-3 h-3 mr-1" />Admin
              </span>
            )}
          </div>
        </div>

        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label">Full Name</label>
            <input className="input" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} placeholder="Your full name" />
          </div>
          <div>
            <label className="label">Bio</label>
            <textarea className="input resize-none" rows={3} value={form.bio} onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))} placeholder="A short bio..." />
          </div>
          <div>
            <label className="label">Avatar URL</label>
            <input className="input" value={form.avatar_url} onChange={(e) => setForm((f) => ({ ...f, avatar_url: e.target.value }))} placeholder="https://..." />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </form>
      </div>

      {/* Account info */}
      <div className="card">
        <h2 className="font-semibold text-gray-100 mb-4">Account Information</h2>
        <dl className="space-y-3">
          {[
            { label: 'Username', value: user?.username },
            { label: 'Email', value: user?.email },
            { label: 'Member since', value: user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—' },
            { label: 'Role', value: user?.is_admin ? 'Administrator' : 'Member' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between">
              <dt className="text-sm text-gray-500">{label}</dt>
              <dd className="text-sm text-gray-200">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
