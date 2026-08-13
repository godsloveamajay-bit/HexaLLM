import { useState, useEffect } from 'react'
import { User, Save, Loader2, Shield, RefreshCw, CheckCircle2, Smartphone, ExternalLink, Lock, Palette, Sun, Moon, MonitorSmartphone, Sparkles, CreditCard, Zap } from 'lucide-react'
import { useAuth } from '../store/auth'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import { isTauri, isCapacitor } from '../lib/platform'
import { useTheme, type Theme } from '../lib/theme'
import UserAvatar from '../components/ui/UserAvatar'

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun; hint: string }[] = [
  { value: 'light', label: 'Light', icon: Sun, hint: 'Warm cream' },
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Warm charcoal' },
  { value: 'auto', label: 'System', icon: MonitorSmartphone, hint: 'Follow OS' },
]

type UpdateStatus = 'idle' | 'checking' | 'found' | 'none'

export default function SettingsPage() {
  const { user, fetchMe } = useAuth()
  const navigate = useNavigate()
  const [theme, setTheme, resolvedTheme] = useTheme()
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

  // AI preferences
  const [variants, setVariants] = useState<{ id: string; label: string; ready: boolean }[]>([])
  const [aiForm, setAiForm] = useState({
    ai_instructions: user?.ai_instructions || '',
    ai_default_model: user?.ai_default_model || '',
    ai_temperature: typeof user?.ai_temperature === 'number' ? user!.ai_temperature! : 0.7,
    ai_max_tokens: typeof user?.ai_max_tokens === 'number' ? user!.ai_max_tokens! : 0, // 0 = model default
    ai_reasoning: user?.ai_reasoning !== false,                                         // default on
  })
  const [aiSaving, setAiSaving] = useState(false)

  useEffect(() => {
    api.get('/models/hexallm/variants').then(({ data }) => setVariants(data.variants || [])).catch(() => {})
  }, [])

  const saveAI = async (e: React.FormEvent) => {
    e.preventDefault()
    setAiSaving(true)
    try {
      await api.patch('/auth/me', {
        ai_instructions: aiForm.ai_instructions,
        ai_default_model: aiForm.ai_default_model,
        ai_temperature: aiForm.ai_temperature,
        ai_max_tokens: aiForm.ai_max_tokens || null,        // 0 → model default
        ai_reasoning: aiForm.ai_reasoning,
      })
      await fetchMe()
      toast.success('AI settings saved!')
    } catch {
      toast.error('Failed to save AI settings')
    } finally { setAiSaving(false) }
  }

  const LENGTH_PRESETS: { value: number; label: string }[] = [
    { value: 0, label: 'Model default' },
    { value: 256, label: 'Short (~200 words)' },
    { value: 512, label: 'Medium (~400 words)' },
    { value: 1024, label: 'Long (~800 words)' },
    { value: 2048, label: 'Very long (~1500 words)' },
    { value: 4096, label: 'Maximum' },
  ]

  const checkForUpdate = async () => {
    // ── Mobile (Capacitor) ────────────────────────────────────────────────
    if (isCapacitor()) {
      window.open('https://github.com/godsloveamajay-bit/hexallm/releases/latest', '_system')
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
            <div className="flex items-center gap-3">
              <UserAvatar user={{ username: user?.username, avatar_url: form.avatar_url }} size={40} />
              <input className="input flex-1" value={form.avatar_url}
                onChange={(e) => setForm((f) => ({ ...f, avatar_url: e.target.value }))}
                placeholder="https://..." />
            </div>
          </div>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </form>
      </div>

      {/* Appearance */}
      <div className="card mb-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-primary-600/20 flex items-center justify-center">
            <Palette className="w-4 h-4 text-primary-400" />
          </div>
          <h2 className="font-semibold text-gray-100">Appearance</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map(({ value, label, icon: Icon, hint }) => {
            const active = theme === value
            return (
              <button
                key={value}
                onClick={() => setTheme(value)}
                aria-pressed={active}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-4 transition-colors ${
                  active
                    ? 'border-primary-500 bg-primary-600/10 text-primary-300'
                    : 'border-gray-700/60 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-sm font-medium">{label}</span>
                <span className="text-[11px] text-gray-500">{hint}</span>
              </button>
            )
          })}
        </div>
        {theme === 'auto' && (
          <p className="mt-3 text-xs text-gray-500">
            Following your system setting — currently <span className="text-gray-300">{resolvedTheme}</span>.
          </p>
        )}
      </div>

      {/* AI Assistant */}
      <div className="card mb-5">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-primary-600/20 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary-400" />
          </div>
          <h2 className="font-semibold text-gray-100">AI Assistant</h2>
        </div>

        <form onSubmit={saveAI} className="space-y-5">
          <div>
            <label className="label">Custom instructions</label>
            <textarea
              className="input resize-none"
              rows={5}
              value={aiForm.ai_instructions}
              onChange={(e) => setAiForm((f) => ({ ...f, ai_instructions: e.target.value }))}
              placeholder="e.g. Be concise and direct. I'm a TypeScript developer — prefer TS examples. Always explain your reasoning briefly."
              maxLength={4000}
            />
            <p className="text-xs text-gray-500 mt-1">
              Applied to <span className="text-gray-400">every</span> chat — tell the AI how to respond, your
              preferences, who you are. Leave blank for none.
            </p>
          </div>

          <div>
            <label className="label">Default model for new chats</label>
            <select
              className="input"
              value={aiForm.ai_default_model}
              onChange={(e) => setAiForm((f) => ({ ...f, ai_default_model: e.target.value }))}
            >
              <option value="">Smart default (first available)</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id} disabled={!v.ready}>
                  {v.label}{v.ready ? '' : ' (unavailable)'}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">New conversations start with this model. You can still switch per-chat.</p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="label mb-0">Response creativity</label>
              <span className="text-xs font-mono text-primary-300">{aiForm.ai_temperature.toFixed(1)}</span>
            </div>
            <input
              type="range" min={0} max={1} step={0.1}
              value={aiForm.ai_temperature}
              onChange={(e) => setAiForm((f) => ({ ...f, ai_temperature: parseFloat(e.target.value) }))}
              className="w-full mt-2 accent-primary-500"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Precise</span><span>Balanced</span><span>Creative</span>
            </div>
          </div>

          <div>
            <label className="label">Max response length</label>
            <select
              className="input"
              value={aiForm.ai_max_tokens}
              onChange={(e) => setAiForm((f) => ({ ...f, ai_max_tokens: parseInt(e.target.value) }))}
            >
              {LENGTH_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <p className="text-xs text-gray-500 mt-1">Caps how long replies can get. Leave on “Model default” for reasoning models — a low cap can cut off their thinking.</p>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <label className="label mb-0">Extended thinking</label>
              <p className="text-xs text-gray-500 mt-0.5">Let the AI show its step-by-step thinking on reasoning tasks. Off = faster, direct answers.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={aiForm.ai_reasoning}
              onClick={() => setAiForm((f) => ({ ...f, ai_reasoning: !f.ai_reasoning }))}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${aiForm.ai_reasoning ? 'bg-primary-600' : 'bg-gray-600'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiForm.ai_reasoning ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <button type="submit" disabled={aiSaving} className="btn-primary">
            {aiSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save AI Settings
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

      {/* Plan / Billing */}
      <div className="card">
        <h2 className="font-semibold text-gray-100 mb-4">Plan & Billing</h2>
        <p className="text-sm text-gray-500 mb-4">
          {user?.subscription
            ? "You're on the " + (user.subscription.plan?.name || 'Hyper') + ' plan (' + user.subscription.status + ').'
            : 'You are on the Free plan.'}
        </p>
        <button onClick={() => navigate('/billing')} className="btn-secondary">
          <CreditCard className="w-4 h-4" />
          Manage Billing
        </button>
        <button onClick={() => navigate('/pricing')} className="btn-secondary ml-2">
          <Zap className="w-4 h-4" />
          View Plans
        </button>
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
