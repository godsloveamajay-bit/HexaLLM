import { useState } from 'react'
import { User, Save, Loader2, Shield, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'
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
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'found' | 'none' | 'error'>('idle')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)

  const checkForUpdate = async () => {
    if (!('__TAURI_INTERNALS__' in window)) {
      toast('Updates are managed by your browser for the web version.', { icon: 'ℹ️' })
      return
    }
    setUpdateStatus('checking')
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const { relaunch } = await import('@tauri-apps/plugin-process')
      const update = await check()
      if (!update) { setUpdateStatus('none'); return }
      setUpdateStatus('found')
      setUpdateVersion(update.version)
      toast.loading(`Downloading ${update.version}…`, { id: 'manual-update', duration: Infinity })
      await update.downloadAndInstall()
      toast.success('Update ready — restarting in 3 s', { id: 'manual-update', duration: 3000 })
      setTimeout(() => relaunch(), 3000)
    } catch {
      setUpdateStatus('error')
      toast.error('Could not check for updates')
    }
  }

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

      {/* Updates */}
      <div className="card mb-6">
        <div className="flex items-center gap-3 mb-4">
          <RefreshCw className="w-5 h-5 text-primary-400" />
          <h2 className="font-semibold text-gray-100">Updates</h2>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            {updateStatus === 'none' && (
              <div className="flex items-center gap-2 text-sm text-green-400">
                <CheckCircle2 className="w-4 h-4" />
                You're on the latest version
              </div>
            )}
            {updateStatus === 'found' && updateVersion && (
              <div className="flex items-center gap-2 text-sm text-primary-400">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Installing {updateVersion}…
              </div>
            )}
            {updateStatus === 'error' && (
              <div className="flex items-center gap-2 text-sm text-red-400">
                <AlertCircle className="w-4 h-4" />
                Update check failed
              </div>
            )}
            {updateStatus === 'idle' && (
              <p className="text-sm text-gray-500">Check if a newer version is available</p>
            )}
            {updateStatus === 'checking' && (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Checking…
              </div>
            )}
          </div>
          <button
            onClick={checkForUpdate}
            disabled={updateStatus === 'checking' || updateStatus === 'found'}
            className="btn-secondary flex-shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${updateStatus === 'checking' ? 'animate-spin' : ''}`} />
            Check for Updates
          </button>
        </div>
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
