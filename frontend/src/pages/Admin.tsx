import { useEffect, useState } from 'react'
import {
  Users, Activity, FileText, Shield, Plus, Trash2, Search,
  ShieldCheck, ShieldOff, UserCheck, UserX, RefreshCw,
  BarChart3, Globe, Server, Clock, Zap, ChevronLeft, ChevronRight,
} from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../store/auth'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

// ── Types ──────────────────────────────────────────────────────────────────

interface AdminStats {
  total_users: number; total_admins: number; active_today: number
  total_requests: number; total_whitelisted_ips: number
  requests_last_30d: number; unique_users_30d: number
}

interface UserEntry {
  id: number; email: string; username: string; full_name?: string
  is_active: boolean; is_admin: boolean; created_at?: string; last_login?: string
}

interface LogEntry {
  id: number; user_id?: number; email?: string; endpoint: string
  method: string; status_code: number; model_name?: string
  prompt_tokens: number; completion_tokens: number
  latency_ms?: number; ip_address?: string; created_at?: string
}

interface WhitelistEntry {
  id: number; ip_address: string; label?: string; note?: string; created_at?: string
}

// ── Tabs ────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'users' | 'logs' | 'whitelist'

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'overview',  label: 'Overview',  icon: BarChart3 },
  { key: 'users',     label: 'Users',     icon: Users },
  { key: 'logs',      label: 'Logs',     icon: FileText },
  { key: 'whitelist', label: 'IP Whitelist', icon: Shield },
]

// ── Component ───────────────────────────────────────────────────────────────

export default function AdminPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<UserEntry[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [whitelist, setWhitelist] = useState<WhitelistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [logPage, setLogPage] = useState(0)
  const [newIp, setNewIp] = useState('')
  const [newIpLabel, setNewIpLabel] = useState('')
  const [createModal, setCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({ username: '', email: '', password: '', full_name: '', is_admin: false })

  const loadStats = () => api.get('/admin/stats').then(r => setStats(r.data))
  const loadUsers = () => api.get('/admin/users', { params: { search: search || undefined } }).then(r => setUsers(r.data))
  const loadLogs = () => api.get('/admin/logs', { params: { limit: 25, offset: logPage * 25 } }).then(r => setLogs(r.data))
  const loadWhitelist = () => api.get('/admin/ip-whitelist').then(r => setWhitelist(r.data))

  useEffect(() => {
    setLoading(true)
    Promise.all([loadStats(), loadUsers(), loadLogs(), loadWhitelist()]).finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (tab === 'users') loadUsers() }, [search])
  useEffect(() => { if (tab === 'logs') loadLogs() }, [logPage])

  async function toggleAdmin(u: UserEntry) {
    await api.patch(`/admin/users/${u.id}`, { is_admin: !u.is_admin })
    toast.success(u.is_admin ? 'Removed admin' : 'Made admin')
    loadUsers()
  }

  async function toggleActive(u: UserEntry) {
    await api.patch(`/admin/users/${u.id}`, { is_active: !u.is_active })
    toast.success(u.is_active ? 'Disabled user' : 'Activated user')
    loadUsers()
  }

  async function createUser() {
    try {
      await api.post('/admin/users', createForm)
      toast.success('User created')
      setCreateModal(false)
      setCreateForm({ username: '', email: '', password: '', full_name: '', is_admin: false })
      loadUsers()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to create user')
    }
  }

  async function addIp() {
    if (!newIp.trim()) return
    try {
      await api.post('/admin/ip-whitelist', { ip_address: newIp.trim(), label: newIpLabel.trim() || null })
      toast.success('IP whitelisted')
      setNewIp(''); setNewIpLabel('')
      loadWhitelist()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to add IP')
    }
  }

  async function removeIp(id: number) {
    await api.delete(`/admin/ip-whitelist/${id}`)
    toast.success('IP removed')
    loadWhitelist()
  }

  const statusColor = (code: number) => {
    if (code < 300) return 'text-green-400'
    if (code < 400) return 'text-yellow-400'
    return 'text-red-400'
  }

  const methodColor = (m: string) => {
    if (m === 'GET') return 'bg-secondary-900/40 text-secondary-300'
    if (m === 'POST') return 'bg-green-900/40 text-green-300'
    if (m === 'DELETE') return 'bg-red-900/40 text-red-300'
    return 'bg-gray-800 text-gray-400'
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
        <p className="text-secondary mt-1">System-wide management and monitoring</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-neutral-700 pb-1 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors whitespace-nowrap',
              tab === key ? 'text-primary-500 border-b-2 border-primary-500' : 'text-secondary hover:text-foreground',
            )}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ──────────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="card flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-primary-600/20 flex items-center justify-center"><Users className="w-5 h-5 text-primary-500" /></div>
              <div><p className="text-secondary text-sm">Total Users</p><p className="text-2xl font-bold text-foreground mt-0.5">{stats?.total_users ?? '—'}</p></div>
            </div>
            <div className="card flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-green-600/20 flex items-center justify-center"><ShieldCheck className="w-5 h-5 text-green-500" /></div>
              <div><p className="text-secondary text-sm">Admins</p><p className="text-2xl font-bold text-foreground mt-0.5">{stats?.total_admins ?? '—'}</p></div>
            </div>
            <div className="card flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-energy-600/20 flex items-center justify-center"><Activity className="w-5 h-5 text-energy-500" /></div>
              <div><p className="text-secondary text-sm">Total Requests</p><p className="text-2xl font-bold text-foreground mt-0.5">{stats?.total_requests?.toLocaleString() ?? '—'}</p></div>
            </div>
            <div className="card flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-rose-600/20 flex items-center justify-center"><Server className="w-5 h-5 text-rose-500" /></div>
              <div><p className="text-secondary text-sm">Whitelisted IPs</p><p className="text-2xl font-bold text-foreground mt-0.5">{stats?.total_whitelisted_ips ?? '—'}</p></div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
            <div className="card flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center"><Zap className="w-5 h-5 text-blue-500" /></div>
              <div><p className="text-secondary text-sm">Requests (30d)</p><p className="text-2xl font-bold text-foreground mt-0.5">{stats?.requests_last_30d?.toLocaleString() ?? '—'}</p></div>
            </div>
            <div className="card flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-purple-600/20 flex items-center justify-center"><Globe className="w-5 h-5 text-purple-500" /></div>
              <div><p className="text-secondary text-sm">Unique Users (30d)</p><p className="text-2xl font-bold text-foreground mt-0.5">{stats?.unique_users_30d ?? '—'}</p></div>
            </div>
            <div className="card flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-cyan-600/20 flex items-center justify-center"><Clock className="w-5 h-5 text-cyan-500" /></div>
              <div><p className="text-secondary text-sm">Active Today</p><p className="text-2xl font-bold text-foreground mt-0.5">{stats?.active_today ?? '—'}</p></div>
            </div>
          </div>
        </div>
      )}

      {/* ── Users Tab ──────────────────────────────────────────────────────── */}
      {tab === 'users' && (
        <div>
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users..." className="input pl-9 w-full" />
            </div>
            <button onClick={() => setCreateModal(true)} className="btn-primary flex items-center gap-2 text-sm">
              <Plus className="w-4 h-4" /> Create User
            </button>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-700 bg-neutral-800/50">
                    {['ID', 'Email', 'Username', 'Name', 'Role', 'Status', 'Created', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs text-secondary font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-secondary">No users found</td></tr>
                  ) : users.map(u => (
                    <tr key={u.id} className="border-b border-neutral-700/50 hover:bg-neutral-800/30">
                      <td className="px-4 py-3 text-secondary font-mono text-xs">{u.id}</td>
                      <td className="px-4 py-3 text-foreground">{u.email}</td>
                      <td className="px-4 py-3 text-secondary">{u.username}</td>
                      <td className="px-4 py-3 text-secondary">{u.full_name || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={clsx('badge text-xs', u.is_admin ? 'bg-primary-600/20 text-primary-500' : 'bg-neutral-700 text-secondary')}>
                          {u.is_admin ? 'Admin' : 'User'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={clsx('badge text-xs', u.is_active ? 'bg-green-600/20 text-green-500' : 'bg-red-600/20 text-red-500')}>
                          {u.is_active ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs">
                        {u.created_at ? format(new Date(u.created_at), 'MMM dd, yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => toggleAdmin(u)} className="btn-ghost p-1.5" title={u.is_admin ? 'Remove admin' : 'Make admin'}>
                            {u.is_admin ? <ShieldOff className="w-4 h-4 text-rose-500" /> : <ShieldCheck className="w-4 h-4 text-secondary" />}
                          </button>
                          <button onClick={() => toggleActive(u)} className="btn-ghost p-1.5" title={u.is_active ? 'Disable user' : 'Activate user'}>
                            {u.is_active ? <UserX className="w-4 h-4 text-rose-500" /> : <UserCheck className="w-4 h-4 text-green-500" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Create User Modal */}
          {createModal && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
              <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-md">
                <h2 className="text-lg font-semibold text-foreground mb-4">Create User</h2>
                <div className="space-y-3">
                  <input value={createForm.username} onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))} placeholder="Username *" className="input w-full" />
                  <input value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} placeholder="Email *" className="input w-full" type="email" />
                  <input value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} placeholder="Password *" className="input w-full" type="password" />
                  <input value={createForm.full_name} onChange={e => setCreateForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Full name" className="input w-full" />
                  <label className="flex items-center gap-2 text-sm text-secondary">
                    <input type="checkbox" checked={createForm.is_admin} onChange={e => setCreateForm(f => ({ ...f, is_admin: e.target.checked }))} className="rounded" />
                    Grant admin privileges
                  </label>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                  <button onClick={() => setCreateModal(false)} className="btn-ghost text-sm">Cancel</button>
                  <button onClick={createUser} className="btn-primary text-sm">Create</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Logs Tab ───────────────────────────────────────────────────────── */}
      {tab === 'logs' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-secondary">{logs.length} entries shown</p>
            <button onClick={loadLogs} className="btn-ghost p-2"><RefreshCw className="w-4 h-4" /></button>
          </div>
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-700 bg-neutral-800/50">
                    {['Time', 'User', 'Method', 'Endpoint', 'Status', 'Model', 'Tokens', 'IP', 'Latency'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs text-secondary font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-secondary">No logs</td></tr>
                  ) : logs.map(l => (
                    <tr key={l.id} className="border-b border-neutral-700/50 hover:bg-neutral-800/30">
                      <td className="px-4 py-3 text-secondary text-xs font-mono whitespace-nowrap">
                        {l.created_at ? format(new Date(l.created_at), 'MM-dd HH:mm:ss') : '—'}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs">{l.email || `#${l.user_id}` || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={clsx('badge text-xs', methodColor(l.method))}>{l.method}</span>
                      </td>
                      <td className="px-4 py-3 text-foreground font-mono text-xs max-w-[200px] truncate">{l.endpoint}</td>
                      <td className="px-4 py-3">
                        <span className={clsx('font-mono font-medium text-xs', statusColor(l.status_code))}>{l.status_code}</span>
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs">{l.model_name || '—'}</td>
                      <td className="px-4 py-3 text-secondary text-xs font-mono">
                        {l.prompt_tokens + l.completion_tokens > 0 ? `${l.prompt_tokens + l.completion_tokens}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs font-mono">{l.ip_address || '—'}</td>
                      <td className="px-4 py-3 text-secondary text-xs font-mono">{l.latency_ms ? `${l.latency_ms}ms` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-700">
              <button onClick={() => setLogPage(p => Math.max(0, p - 1))} disabled={logPage === 0} className="btn-ghost p-1.5">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-secondary">Page {logPage + 1}</span>
              <button onClick={() => setLogPage(p => p + 1)} disabled={logs.length < 25} className="btn-ghost p-1.5">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── IP Whitelist Tab ──────────────────────────────────────────────── */}
      {tab === 'whitelist' && (
        <div>
          <div className="card mb-6">
            <h3 className="text-sm font-semibold text-foreground mb-3">Add IP Address</h3>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <input value={newIp} onChange={e => setNewIp(e.target.value)} placeholder="IP address (e.g. 84.8.148.245)" className="input w-full" />
              </div>
              <div className="flex-1">
                <input value={newIpLabel} onChange={e => setNewIpLabel(e.target.value)} placeholder="Label (optional)" className="input w-full" />
              </div>
              <button onClick={addIp} className="btn-primary flex items-center gap-2 text-sm whitespace-nowrap">
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <p className="text-xs text-secondary mt-2">
              Whitelisted IPs bypass all plan limits — useful for your own office or servers.
            </p>
          </div>

          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-700 bg-neutral-800/50">
                    {['IP Address', 'Label', 'Added', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs text-secondary font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {whitelist.length === 0 ? (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-secondary">
                      <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      No whitelisted IPs yet
                    </td></tr>
                  ) : whitelist.map(w => (
                    <tr key={w.id} className="border-b border-neutral-700/50 hover:bg-neutral-800/30">
                      <td className="px-4 py-3 text-foreground font-mono text-sm">{w.ip_address}</td>
                      <td className="px-4 py-3 text-secondary">{w.label || '—'}</td>
                      <td className="px-4 py-3 text-secondary text-xs">
                        {w.created_at ? format(new Date(w.created_at), 'MMM dd, yyyy') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => removeIp(w.id)} className="btn-ghost p-1.5" title="Remove">
                          <Trash2 className="w-4 h-4 text-rose-500" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
