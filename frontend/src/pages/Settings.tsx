import { useState } from 'react'
import { User, Save, Loader2, Shield, RefreshCw, CheckCircle2, Smartphone, ExternalLink, Lock } from 'lucide-react'
import { useAuth } from '../store/auth'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { isTauri, isCapacitor } from '../lib/platform'

type UpdateStatus = 'idle' | 'checking' | 'found' | 'none'

export default function SettingsPage() {
  const { user, fetchMe } = useAuth()
  const [form, setForm] = useState({
    full_name: user?.full_name || '',
    bio: user?.bio || '',
    avatar_url: user?.avatar_url || '',
  })
  const [saving, setSaving] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)

  const checkForUpdate = async () => {
    // ── Mobile (Capacitor) ────────────────────────────────────────────────
    if (isCapacitor()) {
      window.open('https://github.com/godsloveamajay-bit/nebulaxai/releases/latest', '_system')
      return
    }

    // ── Web browser ───────────────────────────────────────────────────────
    if (!isTauri()) {
      toast('Refresh the page to get the latest web version.', { icon: 'ℹ️' })
      return
    }

    // ── Desktop (Tauri) ───────────────────────────────────────────────────
    setUpdateStatus('checking')
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const { relaunch } = await import('@tauri-apps/plugin-process')
      const update = await check()
      if (!update) {
        setUpdateStatus('none')
        return
      }
      setUpdateStatus('found')
      setUpdateVersion(update.version)
      toast.loading(`Downloading ${update.version}…`, { id: 'manual-update', duration: Infinity })
      await update.downloadAndInstall()
      toast.success('Update ready — restarting in 3 s', { id: 'manual-update', duration: 3000 })
      setTimeout(() => relaunch(), 3000)
    } catch {
      // Any error (unreachable server, missing platform in manifest, bad sig)
      // just means we can't determine update status — show "up to date"
      setUpdateStatus('none')
    }
  }

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwForm.next !== pwForm.confirm) { toast.error('New passwords do not match'); return }
    if (pwForm.next.length < 8) { toast.error('Password must be at least 8 characters'); return }
    setPwSaving(true)
    try {
      await api.post('/auth/me/password', { current_password: pwForm.current, new_password: pwForm.next })
      toast.success('Password changed!')
      setPwForm({ current: '', next: '', confirm: '' })
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to change password')
    } finally { setPwSaving(false) }
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
      <div className="card mb-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-primary-600/20 flex items-center justify-center">
            <User className="w-4 h-4 text-primary-400" />
          </div>
          <h2 className="font-semibold text-gray-100">Profile</h2>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700
                          flex items-center justify-center text-xl font-bold text-white shadow-lg shadow-primary-900/30">
            {user?.username?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-gray-100">{user?.username}</p>
            <p className="text-sm text-gray-500">{user?.email}</p>
            {user?.is_admin && (
              <span className="badge bg-primary-900/40 text-primary-300 mt-1.5 gap-1">
                <Shield className="w-3 h-3" />Admin
              </span>
            )}
          </div>
        </div>

        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="label">Full Name</label>
            <input className="input" value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              placeholder="Your full name" />
          </div>
          <div>
            <label className="label">Bio</label>
            <textarea className="input resize-none" rows={3} value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              placeholder="A short bio..." />
          </div>
          <div>
            <label className="label">Avatar URL</label>
            <input className="input" value={form.avatar_url}
              onChange={(e) => setForm((f) => ({ ...f, avatar_url: e.target.value }))}
              placeholder="https://..." />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </form>
      </div>

      {/* Password */}
      <div className="card mb-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-primary-600/20 flex items-center justify-center">
            <Lock className="w-4 h-4 text-primary-400" />
          </div>
          <h2 className="font-semibold text-gray-100">Change Password</h2>
        </div>
        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <label className="label">Current Password</label>
            <input type="password" className="input" placeholder="••••••••"
              value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} required />
          </div>
          <div>
            <label className="label">New Password</label>
            <input type="password" className="input" placeholder="Min. 8 characters"
              value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} required minLength={8} />
          </div>
          <div>
            <label className="label">Confirm New Password</label>
            <input type="password" className="input" placeholder="••••••••"
              value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} required />
          </div>
          <button type="submit" disabled={pwSaving} className="btn-primary">
            {pwSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            Update Password
          </button>
        </form>
      </div>

      {/* Updates */}
      <div className="card mb-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-primary-600/20 flex items-center justify-center">
            <RefreshCw className="w-4 h-4 text-primary-400" />
          </div>
          <h2 className="font-semibold text-gray-100">Updates</h2>
        </div>

        {isCapacitor() ? (
          /* Mobile: direct to GitHub releases */
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Smartphone className="w-4 h-4 text-gray-500" />
              Download the latest APK from GitHub Releases
            </div>
            <button onClick={checkForUpdate} className="btn-secondary flex-shrink-0 gap-1.5">
              <ExternalLink className="w-4 h-4" />
              Releases
            </button>
          </div>
        ) : isTauri() ? (
          /* Desktop: in-app updater */
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">
              {updateStatus === 'none' && (
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  You're on the latest version
                </div>
              )}
              {updateStatus === 'found' && updateVersion && (
                <div className="flex items-center gap-2 text-primary-400">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Installing {updateVersion}…
                </div>
              )}
{updateStatus === 'idle' && (
                <p className="text-gray-500">Check if a newer version is available</p>
              )}
              {updateStatus === 'checking' && (
                <div className="flex items-center gap-2 text-gray-400">
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
        ) : (
          /* Web */
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-gray-500">Reload the page to get the latest web version.</p>
            <button onClick={() => window.location.reload()} className="btn-secondary flex-shrink-0">
              <RefreshCw className="w-4 h-4" />
              Reload
            </button>
          </div>
        )}
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
            <div key={label} className="flex items-center justify-between py-1 border-b border-gray-800 last:border-0">
              <dt className="text-sm text-gray-500">{label}</dt>
              <dd className="text-sm text-gray-200 font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
