import { useCallback, useEffect, useState } from 'react'
import {
  Puzzle, RefreshCw, Power, PowerOff, Trash2, Play, Terminal,
  ShieldAlert, ChevronDown, ChevronRight, AlertTriangle, Package,
  Download, ScrollText,
} from 'lucide-react'
import { api } from '../lib/api'
import { DEV_ACCENT } from './isDev'

type Tool = { name: string; description: string; input_schema: Record<string, any> }

type Permissions = {
  filesystem: string[]
  network: string[]
  secrets: string[]
  subprocess: boolean
}

type Plugin = {
  name: string
  version: string | null
  author: string | null
  description: string | null
  source: string | null
  isolation: string
  is_enabled: boolean
  installed_at: string | null
  last_error: string | null
  tools: Tool[]
  permissions: Permissions
  rate_limit?: { per_user: number; per_plugin: number; period_seconds: number }
  valid: boolean
  validation_error: string | null
}

type AuditEntry = {
  id: number
  plugin_name: string
  tool_name: string
  user_id: number | null
  isolation: string | null
  status: 'ok' | 'error' | 'blocked' | 'rate_limited'
  latency_ms: number
  args_preview: string | null
  output_preview: string | null
  error: string | null
  args_redacted: boolean
  created_at: string
}

type AuditData = {
  entries: AuditEntry[]
  total: number
  page: number
  page_size: number
  summary: {
    window_hours: number
    calls: number
    by_status: Record<string, number>
    by_plugin: Record<string, number>
    top_tools: Record<string, number>
    avg_latency_ms: number
    error_rate: number
    retention_days: number
    prune_interval_minutes: number
  }
}

type PluginList = {
  plugins: Plugin[]
  total: number
  enabled: number
  available_tools: number
  plugins_enabled_globally: boolean
  plugins_dir: string
}

const inputClass =
  'w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 font-mono text-xs ' +
  'text-[#e6edf3] outline-none focus:border-[#4FF3FF]'

// Same look, but sized by content — for selects in a filter row. `inputClass`
// carries w-full, which would win over a w-auto added alongside it.
const filterClass =
  'bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 font-mono text-xs ' +
  'text-[#e6edf3] outline-none focus:border-[#4FF3FF]'

const labelClass = 'block font-mono text-[10px] uppercase tracking-wide text-[#6e7681] mb-1'

/** Render a tool's input_schema as a small key/required table. */
function SchemaView({ schema }: { schema: Record<string, any> }) {
  const props = (schema?.properties || {}) as Record<string, any>
  const required: string[] = schema?.required || []
  const keys = Object.keys(props)
  if (!keys.length) return <span className="font-mono text-[10px] text-[#6e7681]">no schema</span>
  return (
    <div className="flex flex-col gap-0.5">
      {keys.map(k => (
        <div key={k} className="font-mono text-[10px] flex items-start gap-1.5">
          <span style={{ color: required.includes(k) ? '#4ade80' : '#6e7681' }}>
            {required.includes(k) ? '*' : '·'}
          </span>
          <span className="text-[#8b949e]">{k}</span>
          <span className="text-[#484f58]">{props[k]?.type || '?'}</span>
        </div>
      ))}
    </div>
  )
}

function PermissionBadges({ p }: { p: Permissions }) {
  const any = p && (p.filesystem?.length || p.network?.length || p.secrets?.length || p.subprocess)
  if (!any) {
    return (
      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#12161d', color: '#6e7681' }}>
        no permissions requested
      </span>
    )
  }
  return (
    <div className="flex flex-wrap gap-1">
      {p.network?.length > 0 && (
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
          style={{ background: 'rgba(79,243,255,.1)', color: '#4FF3FF' }}>
          network: {p.network.join(', ')}
        </span>
      )}
      {p.filesystem?.length > 0 && (
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(192,132,252,.12)', color: '#c084fc' }}>
          fs: {p.filesystem.join(', ')}
        </span>
      )}
      {p.secrets?.length > 0 && (
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(251,191,36,.12)', color: '#fbbf24' }}>
          secrets: {p.secrets.length}
        </span>
      )}
      {p.subprocess && (
        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1"
          style={{ background: 'rgba(248,113,113,.12)', color: '#f87171' }}>
          <ShieldAlert size={9} /> subprocess
        </span>
      )}
    </div>
  )
}

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  ok: { color: '#4ade80', label: 'ok' },
  error: { color: '#f87171', label: 'error' },
  blocked: { color: '#fbbf24', label: 'blocked' },
  rate_limited: { color: '#c084fc', label: 'throttled' },
}

function StatTile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded p-2.5" style={{ background: '#010409', border: '1px solid #21262d' }}>
      <div className="font-mono text-[9px] uppercase tracking-wide" style={{ color: '#6e7681' }}>{label}</div>
      <div className="font-mono text-lg font-bold" style={{ color: color || '#e6edf3' }}>{value}</div>
      {sub && <div className="font-mono text-[9px]" style={{ color: '#484f58' }}>{sub}</div>}
    </div>
  )
}

/** Audit trail: every plugin call, with the filters that matter for triage. */
function AuditPanel({ plugins }: { plugins: Plugin[] }) {
  const [data, setData] = useState<AuditData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hours, setHours] = useState(24)
  const [plugin, setPlugin] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [openRow, setOpenRow] = useState<number | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const params: Record<string, any> = { hours, page, page_size: 50 }
      if (plugin) params.plugin_name = plugin
      if (status) params.status = status
      const r = await api.get('/plugins/audit', { params, timeout: 20000 })
      setData(r.data)
      setError(null)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'failed to load audit log')
    } finally {
      setBusy(false)
    }
  }, [hours, plugin, status, page])

  useEffect(() => { load() }, [load])

  const exportCsv = () => {
    const url = `${api.defaults.baseURL}/plugins/audit/export?hours=${hours}`
    const token = localStorage.getItem('token')
    // Fetch rather than a bare link so the bearer token is sent.
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `plugin-audit-${hours}h.csv`
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(() => setError('export failed'))
  }

  const s = data?.summary

  return (
    <div>
      {error && (
        <div className="mb-3 font-mono text-xs px-3 py-2 rounded flex items-start gap-2"
          style={{ background: 'rgba(248,113,113,.1)', border: '1px solid #f87171', color: '#f87171' }}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="break-all">{String(error)}</span>
        </div>
      )}

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <StatTile label="calls" value={String(s.calls)} sub={`last ${s.window_hours}h`} />
          <StatTile
            label="errors + blocks"
            value={String((s.by_status.error || 0) + (s.by_status.blocked || 0))}
            sub={`${(s.error_rate * 100).toFixed(1)}% of calls`}
            color={(s.by_status.error || 0) + (s.by_status.blocked || 0) > 0 ? '#f87171' : undefined}
          />
          <StatTile
            label="throttled"
            value={String(s.by_status.rate_limited || 0)}
            sub="over quota"
            color={(s.by_status.rate_limited || 0) > 0 ? '#c084fc' : undefined}
          />
          <StatTile label="avg latency" value={`${s.avg_latency_ms} ms`} />
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select className={filterClass} value={hours} onChange={e => { setHours(Number(e.target.value)); setPage(1) }}>
          {[1, 6, 24, 168, 720].map(h => <option key={h} value={h}>last {h}h</option>)}
        </select>
        <select className={filterClass} value={plugin} onChange={e => { setPlugin(e.target.value); setPage(1) }}>
          <option value="">all plugins</option>
          {plugins.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
        <select className={filterClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>
          <option value="">all statuses</option>
          <option value="ok">ok</option>
          <option value="error">error</option>
          <option value="blocked">blocked</option>
          <option value="rate_limited">throttled</option>
        </select>
        <button onClick={load} disabled={busy} className="flex items-center gap-1 font-mono text-[11px] px-2.5 py-1.5 rounded border disabled:opacity-50"
          style={{ borderColor: '#30363d', color: '#8b949e' }}>
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> refresh
        </button>
        <button onClick={exportCsv} className="flex items-center gap-1 font-mono text-[11px] px-2.5 py-1.5 rounded border"
          style={{ borderColor: '#30363d', color: '#8b949e' }}>
          <Download size={11} /> csv
        </button>
        {data && (
          <span className="font-mono text-[10px] ml-auto" style={{ color: '#6e7681' }}>
            {data.total} entries · page {data.page}
          </span>
        )}
      </div>

      {s && (
        <div className="font-mono text-[10px] mb-2 flex items-center gap-1.5" style={{ color: '#484f58' }}>
          {s.retention_days > 0 ? (
            <>
              rows older than {s.retention_days} days are pruned automatically, every{' '}
              {s.prune_interval_minutes >= 60
                ? `${Math.round(s.prune_interval_minutes / 60)}h`
                : `${s.prune_interval_minutes}m`}
            </>
          ) : (
            <>retention is disabled — the trail is kept indefinitely</>
          )}
        </div>
      )}

      <div className="rounded border overflow-hidden" style={{ borderColor: '#21262d' }}>
        <div className="font-mono text-[9px] uppercase px-2.5 py-1.5 flex gap-3"
          style={{ background: '#0d1117', color: '#6e7681', borderBottom: '1px solid #21262d' }}>
          <span className="w-16">when</span>
          <span className="w-28">plugin.tool</span>
          <span className="w-12">user</span>
          <span className="w-20">status</span>
          <span className="w-16">latency</span>
          <span className="flex-1">detail</span>
        </div>

        {data && data.entries.length === 0 && (
          <div className="p-6 text-center font-mono text-xs" style={{ color: '#6e7681' }}>
            no plugin calls in this window
          </div>
        )}

        {(data?.entries || []).map(e => {
          const st = STATUS_STYLE[e.status] || { color: '#6e7681', label: e.status }
          const detail = e.error || e.output_preview || e.args_preview || ''
          const open = openRow === e.id
          return (
            <div key={e.id} className="border-b" style={{ borderColor: '#161b22' }}>
              <button
                onClick={() => setOpenRow(open ? null : e.id)}
                className="w-full text-left font-mono text-[10px] px-2.5 py-1.5 flex gap-3 items-center hover:bg-[#0d1117]"
              >
                <span className="w-16 shrink-0" style={{ color: '#484f58' }}>
                  {new Date(e.created_at).toLocaleTimeString()}
                </span>
                <span className="w-44 shrink-0 truncate" style={{ color: '#e6edf3' }}>
                  {e.plugin_name}.{e.tool_name}
                </span>
                <span className="w-12 shrink-0" style={{ color: '#6e7681' }}>
                  {e.user_id ?? '—'}
                </span>
                <span className="w-20 shrink-0 font-bold" style={{ color: st.color }}>{st.label}</span>
                <span className="w-16 shrink-0" style={{ color: '#6e7681' }}>{e.latency_ms} ms</span>
                <span className="flex-1 truncate" style={{ color: '#6e7681' }}>
                  {e.args_redacted && <span style={{ color: '#fbbf24' }}>[redacted] </span>}
                  {detail}
                </span>
              </button>
              {open && (
                <div className="px-2.5 pb-2.5 font-mono text-[10px] flex flex-col gap-1.5" style={{ color: '#8b949e' }}>
                  <div>
                    <span style={{ color: '#4FF3FF' }}>args</span>{' '}
                    <span className="break-all">{e.args_preview || '—'}</span>
                  </div>
                  {e.output_preview && (
                    <div>
                      <span style={{ color: '#4ade80' }}>output</span>{' '}
                      <span className="break-all whitespace-pre-wrap">{e.output_preview}</span>
                    </div>
                  )}
                  {e.error && (
                    <div>
                      <span style={{ color: '#f87171' }}>error</span>{' '}
                      <span className="break-all whitespace-pre-wrap">{e.error}</span>
                    </div>
                  )}
                  <div style={{ color: '#484f58' }}>
                    id {e.id} · isolation {e.isolation || '—'} · {new Date(e.created_at).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {data && data.total > data.page_size && (
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="font-mono text-[11px] px-2.5 py-1 rounded border disabled:opacity-40"
            style={{ borderColor: '#30363d', color: '#8b949e' }}
          >
            prev
          </button>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page * data.page_size >= data.total}
            className="font-mono text-[11px] px-2.5 py-1 rounded border disabled:opacity-40"
            style={{ borderColor: '#30363d', color: '#8b949e' }}
          >
            next
          </button>
        </div>
      )}
    </div>
  )
}

export default function Plugins() {
  const [data, setData] = useState<PluginList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [testing, setTesting] = useState<Record<string, { tool: string; args: string; out?: string; err?: string }>>({})
  const [installPath, setInstallPath] = useState('')
  const [tab, setTab] = useState<'installed' | 'audit'>('installed')

  const load = useCallback(async () => {
    try {
      const r = await api.get('/plugins', { timeout: 20000 })
      setData(r.data)
      setError(null)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'failed to load plugins')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const act = async (name: string, fn: () => Promise<any>) => {
    setBusy(name)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e: any) {
      const d = e?.response?.data?.detail
      setError(typeof d === 'object' ? JSON.stringify(d) : d || e?.message || 'request failed')
    } finally {
      setBusy(null)
    }
  }

  const runTest = async (p: Plugin, tool: Tool) => {
    const state = testing[tool.name] || { tool: tool.name, args: '{}' }
    let parsed: any
    try {
      parsed = JSON.parse(state.args || '{}')
    } catch {
      setTesting(s => ({ ...s, [tool.name]: { ...state, err: 'args is not valid JSON' } }))
      return
    }
    setTesting(s => ({ ...s, [tool.name]: { ...state, err: undefined, out: undefined } }))
    try {
      const r = await api.post(`/plugins/${p.name}/call`, { tool: tool.name, args: parsed }, { timeout: 90000 })
      setTesting(s => ({ ...s, [tool.name]: { ...state, out: r.data.output, err: undefined } }))
    } catch (e: any) {
      const d = e?.response?.data?.detail
      setTesting(s => ({ ...s, [tool.name]: { ...state, err: typeof d === 'object' ? JSON.stringify(d) : d || e?.message } }))
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Puzzle size={18} style={{ color: '#c084fc' }} />
        <h1 className="font-mono font-bold text-lg" style={{ color: DEV_ACCENT.text }}>plugins</h1>
        {data && (
          <div className="ml-auto flex items-center gap-3 font-mono text-[11px]" style={{ color: '#6e7681' }}>
            <span>{data.enabled}/{data.total} enabled</span>
            <span>{data.available_tools} tools live</span>
            <button onClick={load} className="flex items-center gap-1 hover:text-[#4FF3FF]" style={{ color: '#8b949e' }}>
              <RefreshCw size={12} /> refresh
            </button>
          </div>
        )}
      </div>
      <p className="font-mono text-[11px] mb-3" style={{ color: '#6e7681' }}>
        a plugin runs its own code. sandboxed plugins execute in a locked-down subprocess; the permissions
        below are enforced, not advisory.
      </p>

      <div className="flex gap-1 mb-4 border-b" style={{ borderColor: '#21262d' }}>
        {([['installed', 'installed', Package], ['audit', 'audit log', ScrollText]] as const).map(
          ([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 -mb-px border-b-2"
              style={{
                borderColor: tab === key ? '#c084fc' : 'transparent',
                color: tab === key ? '#e6edf3' : '#6e7681',
              }}
            >
              <Icon size={12} /> {label}
            </button>
          ),
        )}
      </div>

      {tab === 'audit' && <AuditPanel plugins={data?.plugins || []} />}

      {tab === 'installed' && (
        <>

      {error && (
        <div className="mb-3 font-mono text-xs px-3 py-2 rounded flex items-start gap-2"
          style={{ background: 'rgba(248,113,113,.1)', border: '1px solid #f87171', color: '#f87171' }}>
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="break-all">{String(error)}</span>
        </div>
      )}

      {data && !data.plugins_enabled_globally && (
        <div className="mb-3 font-mono text-xs px-3 py-2 rounded"
          style={{ background: 'rgba(251,191,36,.1)', border: '1px solid #fbbf24', color: '#fbbf24' }}>
          plugin discovery is switched off — set PLUGINS_ENABLED=true to turn it on
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(data?.plugins || []).map(p => {
          const open = expanded === p.name
          return (
            <div key={p.name} className="rounded border" style={{ borderColor: '#30363d', background: '#0d1117' }}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <button onClick={() => setExpanded(open ? null : p.name)} style={{ color: '#6e7681' }}>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <Package size={14} style={{ color: p.is_enabled ? '#4ade80' : '#6e7681' }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold" style={{ color: '#e6edf3' }}>{p.name}</span>
                    <span className="font-mono text-[10px]" style={{ color: '#6e7681' }}>v{p.version}</span>
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                      style={{
                        background: p.isolation === 'inprocess' ? 'rgba(248,113,113,.15)' : 'rgba(74,222,128,.1)',
                        color: p.isolation === 'inprocess' ? '#f87171' : '#4ade80',
                      }}>
                      {p.isolation}
                    </span>
                    {!p.valid && (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(248,113,113,.12)', color: '#f87171' }}>
                        invalid
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[11px] truncate" style={{ color: '#6e7681' }}>{p.description}</div>
                </div>

                <button
                  onClick={() => act(p.name, () =>
                    p.is_enabled
                      ? api.post(`/plugins/${p.name}/disable`)
                      : api.post(`/plugins/${p.name}/enable`))}
                  disabled={busy === p.name || !p.valid}
                  className="flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded border disabled:opacity-40"
                  style={{
                    borderColor: p.is_enabled ? '#f87171' : '#4ade80',
                    color: p.is_enabled ? '#f87171' : '#4ade80',
                  }}
                >
                  {p.is_enabled ? <><PowerOff size={12} /> disable</> : <><Power size={12} /> enable</>}
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Uninstall ${p.name}? Its files are deleted from the plugins directory.`)) {
                      act(p.name, () => api.delete(`/plugins/${p.name}`))
                    }
                  }}
                  disabled={busy === p.name}
                  className="p-1.5 rounded border disabled:opacity-40"
                  style={{ borderColor: '#30363d', color: '#6e7681' }}
                  aria-label={`uninstall ${p.name}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>

              {p.validation_error && (
                <div className="px-3 pb-2.5 font-mono text-[11px]" style={{ color: '#f87171' }}>
                  {p.validation_error}
                </div>
              )}

              {open && (
                <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: '#21262d' }}>
                  <div className="flex items-center gap-2 py-2">
                    <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: '#6e7681' }}>
                      permissions
                    </span>
                    <PermissionBadges p={p.permissions} />
                  </div>

                  {p.rate_limit && (p.rate_limit.per_user > 0 || p.rate_limit.per_plugin > 0) ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: '#6e7681' }}>
                        rate limit
                      </span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(74,222,128,.1)', color: '#4ade80' }}>
                        {p.rate_limit.per_user > 0 && `${p.rate_limit.per_user}/user`}
                        {p.rate_limit.per_user > 0 && p.rate_limit.per_plugin > 0 && ' · '}
                        {p.rate_limit.per_plugin > 0 && `${p.rate_limit.per_plugin} total`}
                        {' per '}{p.rate_limit.period_seconds}s
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: '#6e7681' }}>
                        rate limit
                      </span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(251,191,36,.1)', color: '#fbbf24' }}>
                        unlimited — this plugin declares no quota
                      </span>
                    </div>
                  )}

                  <div className="font-mono text-[10px] uppercase tracking-wide mt-3 mb-1.5" style={{ color: '#6e7681' }}>
                    tools ({p.tools.length})
                  </div>
                  <div className="flex flex-col gap-2">
                    {p.tools.map(t => {
                      const st = testing[t.name]
                      return (
                        <div key={t.name} className="rounded p-2.5" style={{ background: '#010409', border: '1px solid #21262d' }}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold" style={{ color: '#4FF3FF' }}>{t.name}</span>
                            <button
                              onClick={() => runTest(p, t)}
                              disabled={!p.is_enabled}
                              className="ml-auto flex items-center gap-1 font-mono text-[10px] px-2 py-1 rounded border disabled:opacity-40"
                              style={{ borderColor: '#30363d', color: p.is_enabled ? '#8b949e' : '#484f58' }}
                            >
                              <Play size={10} /> test
                            </button>
                          </div>
                          <div className="font-mono text-[10px] mt-1" style={{ color: '#6e7681' }}>{t.description}</div>
                          <div className="mt-1.5"><SchemaView schema={t.input_schema} /></div>

                          {/* Args are always editable so a tool can be prepared
                              before it is first run. */}
                          <div className="mt-2">
                            <label className={labelClass}>args (json)</label>
                            <input
                              className={inputClass}
                              disabled={!p.is_enabled}
                              value={st?.args ?? '{}'}
                              onChange={e => setTesting(s => ({
                                ...s,
                                [t.name]: { tool: t.name, args: e.target.value, out: s[t.name]?.out, err: s[t.name]?.err },
                              }))}
                            />
                          </div>
                          {st?.err && (
                            <div className="font-mono text-[10px] mt-1.5" style={{ color: '#f87171' }}>{st.err}</div>
                          )}
                          {st?.out !== undefined && (
                            <pre className="font-mono text-[10px] p-2 rounded mt-1.5 overflow-auto max-h-40 flex items-start gap-1.5"
                              style={{ background: '#0d1117', color: '#8b949e', border: '1px solid #21262d' }}>
                              <Terminal size={10} className="mt-0.5 shrink-0" style={{ color: '#4ade80' }} />
                              <span>{st.out || '(no output)'}</span>
                            </pre>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  <div className="mt-3 font-mono text-[10px]" style={{ color: '#484f58' }}>
                    installed {p.installed_at ? new Date(p.installed_at).toLocaleString() : '—'}
                    {p.last_error && <span style={{ color: '#f87171' }}> · last error: {p.last_error}</span>}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {data && data.plugins.length === 0 && (
          <div className="rounded border p-6 text-center" style={{ borderColor: '#30363d' }}>
            <div className="font-mono text-xs" style={{ color: '#6e7681' }}>
              no plugins found in {data.plugins_dir}
            </div>
          </div>
        )}
      </div>

      <div className="rounded border mt-4 p-3" style={{ borderColor: '#30363d', background: '#0d1117' }}>
        <div className="font-mono text-[10px] uppercase tracking-wide mb-2" style={{ color: '#6e7681' }}>
          install from archive
        </div>
        <div className="flex gap-2">
          <input
            className={inputClass + ' flex-1'}
            placeholder="/path/to/plugin-1.0.0.tar.gz"
            value={installPath}
            onChange={e => setInstallPath(e.target.value)}
          />
          <button
            onClick={() => {
              if (!installPath.trim()) return
              act('__install', async () => {
                await api.post('/plugins/install_archive', { path: installPath.trim() })
                setInstallPath('')
              })
            }}
            disabled={busy === '__install' || !installPath.trim()}
            className="font-mono text-[11px] px-3 py-1.5 rounded border disabled:opacity-40"
            style={{ borderColor: '#3fb950', color: '#4ade80' }}
          >
            install
          </button>
        </div>
        <div className="font-mono text-[10px] mt-1.5" style={{ color: '#484f58' }}>
          server-side path to a .tar.gz or .zip. archive paths that escape the target directory, or contain
          symlinks, are rejected. new plugins always start disabled.
        </div>
      </div>
        </>
      )}
    </div>
  )
}
