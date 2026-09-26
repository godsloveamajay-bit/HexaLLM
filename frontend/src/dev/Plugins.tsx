import { useCallback, useEffect, useState } from 'react'
import {
  Puzzle, RefreshCw, Power, PowerOff, Trash2, Play, Terminal,
  ShieldAlert, ChevronDown, ChevronRight, AlertTriangle, Package,
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
  valid: boolean
  validation_error: string | null
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

export default function Plugins() {
  const [data, setData] = useState<PluginList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [testing, setTesting] = useState<Record<string, { tool: string; args: string; out?: string; err?: string }>>({})
  const [installPath, setInstallPath] = useState('')

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
      <p className="font-mono text-[11px] mb-4" style={{ color: '#6e7681' }}>
        a plugin runs its own code. sandboxed plugins execute in a locked-down subprocess; the permissions
        below are enforced, not advisory.
      </p>

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
    </div>
  )
}
