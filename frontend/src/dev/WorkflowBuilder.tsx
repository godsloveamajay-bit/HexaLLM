import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Zap, Plus, Trash2, Save, Play, Loader2, Link2, X, ChevronLeft,
  CheckCircle2, XCircle, SkipForward, Circle, Terminal,
} from 'lucide-react'
import { api } from '../lib/api'
import { DEV_ACCENT } from './isDev'

type NodeType = 'llm' | 'tool' | 'condition' | 'transform'

type FlowNode = {
  node_id: string
  node_type: NodeType
  config: Record<string, any>
  position_x: number
  position_y: number
}

type FlowEdge = {
  from_node_id: string
  to_node_id: string
  from_output?: string
  from_port?: string
}

type Definition = { nodes: FlowNode[]; edges: FlowEdge[] }

type NodeRun = {
  node_id: number
  node_key: string | null
  status: string
  output_data: Record<string, any> | null
  error_message: string | null
  latency_ms: number
  started_at: string | null
}

type Execution = {
  id: number
  status: string
  output_data: any
  error_message: string | null
  total_latency_ms: number
  started_at: string | null
  completed_at: string | null
  node_executions?: NodeRun[]
}

type WorkflowRow = {
  id: number
  name: string
  description: string | null
  definition: Definition | null
  task: string | null
  updated_at: string
}

const NODE_W = 208
const NODE_H = 74

const PALETTE: { type: NodeType; label: string; blurb: string; tint: string }[] = [
  { type: 'llm', label: 'LLM', blurb: 'Call a model', tint: '#4FF3FF' },
  { type: 'tool', label: 'Tool', blurb: 'Run a built-in tool', tint: '#4ade80' },
  { type: 'condition', label: 'Condition', blurb: 'Branch on a value', tint: '#fbbf24' },
  { type: 'transform', label: 'Transform', blurb: 'Reshape data', tint: '#c084fc' },
]

const TOOLS = [
  'web_search', 'code_exec', 'bash_exec', 'read_file', 'write_file', 'list_files', 'delegate',
]

const RUN_STATUS: Record<string, { icon: any; color: string }> = {
  completed: { icon: CheckCircle2, color: '#4ade80' },
  failed: { icon: XCircle, color: '#f87171' },
  skipped: { icon: SkipForward, color: '#6e7681' },
  running: { icon: Loader2, color: '#4FF3FF' },
  pending: { icon: Circle, color: '#6e7681' },
}

const emptyDef = (): Definition => ({ nodes: [], edges: [] })

const inputClass =
  'w-full bg-[#0d1117] border border-[#30363d] rounded px-2 py-1.5 font-mono text-xs ' +
  'text-[#e6edf3] outline-none focus:border-[#4FF3FF]'

const labelClass = 'block font-mono text-[10px] uppercase tracking-wide text-[#6e7681] mb-1'

export default function WorkflowBuilder() {
  const [rows, setRows] = useState<WorkflowRow[]>([])
  const [current, setCurrent] = useState<WorkflowRow | null>(null)
  const [def, setDef] = useState<Definition>(emptyDef)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  const [runInput, setRunInput] = useState('{\n  "topic": "hexallm"\n}')
  const [execution, setExecution] = useState<Execution | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const loadList = useCallback(async () => {
    try {
      const r = await api.get('/workflows')
      setRows(r.data)
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || 'failed to load workflows')
    }
  }, [])

  useEffect(() => { loadList() }, [loadList])

  const adopt = (row: WorkflowRow | null) => {
    setCurrent(row)
    setDef(row?.definition && row.definition.nodes ? row.definition : emptyDef())
    setName(row?.name || 'Untitled workflow')
    setSelected(null)
    setExecution(null)
    setError(null)
  }

  // ── graph mutation ────────────────────────────────────────────────────────
  const addNode = (type: NodeType) => {
    const seed: Record<NodeType, Record<string, any>> = {
      llm: { model: 'qwen2.5:7b', prompt: '', temperature: 0.7 },
      tool: { tool: 'web_search', input: '' },
      condition: { condition: 'topic == "hexallm"' },
      transform: { transform: 'passthrough', value: '' },
    }
    setDef(d => {
      // Derive the ordinal and slot from the *current* list inside the
      // updater. Reading def.nodes here would use a stale closure whenever two
      // nodes are added before React re-renders, and they'd share a position.
      const n = d.nodes.length + 1
      const id = `${type}_${n}`
      return {
        ...d,
        nodes: [...d.nodes, {
          node_id: id,
          node_type: type,
          config: seed[type],
          position_x: 30 + (n % 5) * 240,
          position_y: 30 + Math.floor(n / 5) * 120,
        }],
      }
    })
    setSelected(`${type}_${(def.nodes.length + 1)}`)
    setLinking(null)
  }

  const patchNode = (id: string, patch: Partial<FlowNode>) =>
    setDef(d => ({ ...d, nodes: d.nodes.map(n => (n.node_id === id ? { ...n, ...patch } : n)) }))

  const patchConfig = (id: string, key: string, value: any) =>
    setDef(d => ({
      ...d,
      nodes: d.nodes.map(n => (n.node_id === id ? { ...n, config: { ...n.config, [key]: value } } : n)),
    }))

  const removeNode = (id: string) => {
    setDef(d => ({
      nodes: d.nodes.filter(n => n.node_id !== id),
      edges: d.edges.filter(e => e.from_node_id !== id && e.to_node_id !== id),
    }))
    if (selected === id) setSelected(null)
    if (linking === id) setLinking(null)
  }

  // A condition exposes true/false ports; everything else has one output.
  const portsOf = (n: FlowNode) => (n.node_type === 'condition' ? ['true', 'false'] : ['output'])

  const link = (fromId: string, fromPort: string, toId: string) => {
    if (fromId === toId) return
    setDef(d => {
      const dup = d.edges.some(
        e => e.from_node_id === fromId && e.to_node_id === toId && (e.from_output ?? 'output') === fromPort,
      )
      if (dup) return d
      return { ...d, edges: [...d.edges, { from_node_id: fromId, to_node_id: toId, from_output: fromPort }] }
    })
    setLinking(null)
  }

  const unlink = (index: number) => setDef(d => ({ ...d, edges: d.edges.filter((_, i) => i !== index) }))

  // ── drag ──────────────────────────────────────────────────────────────────
  const onNodeMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    const rect = canvasRef.current!.getBoundingClientRect()
    const node = def.nodes.find(n => n.node_id === id)!
    dragRef.current = { id, dx: e.clientX - rect.left - node.position_x, dy: e.clientY - rect.top - node.position_y }
    setDragging(true)
    setSelected(id)
  }

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const rect = canvasRef.current!.getBoundingClientRect()
      patchNode(d.id, {
        position_x: Math.max(0, Math.round(e.clientX - rect.left - d.dx)),
        position_y: Math.max(0, Math.round(e.clientY - rect.top - d.dy)),
      })
    }
    const up = () => { dragRef.current = null; setDragging(false) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [def.nodes])

  // ── persistence ───────────────────────────────────────────────────────────
  const save = async () => {
    setBusy(true); setError(null)
    try {
      const payload = { name: name || 'Untitled workflow', definition: def }
      if (current) {
        const r = await api.patch(`/workflows/${current.id}`, payload)
        setCurrent(r.data)
      } else {
        const r = await api.post('/workflows', payload)
        setCurrent(r.data)
      }
      setStatus('saved')
      setTimeout(() => setStatus(null), 2000)
      await loadList()
    } catch (e: any) {
      setError(JSON.stringify(e?.response?.data?.detail || e?.message || 'save failed'))
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    setBusy(true); setError(null)
    try {
      let id = current?.id
      if (!id) {
        const created = await api.post('/workflows', { name: name || 'Untitled workflow', definition: def })
        setCurrent(created.data)
        id = created.data.id
        await loadList()
      }
      const input = runInput.trim() ? JSON.parse(runInput) : {}
      const r = await api.post(`/workflows/${id}/execute`, { input_data: input })
      setExecution({ ...r.data, node_executions: [] })

      // Poll until the run settles; node rows appear as nodes complete.
      for (let i = 0; i < 40; i++) {
        await new Promise(res => setTimeout(res, 1500))
        const d = await api.get(`/workflows/${id}/executions/${r.data.id}`)
        // The detail endpoint nests the run; flatten it so the header and
        // error banner read from the same shape as the create response.
        setExecution({ ...d.data.execution, node_executions: d.data.node_executions })
        if (['completed', 'failed', 'cancelled'].includes(d.data.execution.status)) break
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      setError(
        typeof detail === 'object'
          ? (detail.errors || []).join('; ') || JSON.stringify(detail)
          : detail || e?.message || 'run failed',
      )
    } finally {
      setBusy(false)
    }
  }

  const del = async (id: number) => {
    await api.delete(`/workflows/${id}`)
    if (current?.id === id) adopt(null)
    await loadList()
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const nodeById = useMemo(() => {
    const m: Record<string, FlowNode> = {}
    def.nodes.forEach(n => { m[n.node_id] = n })
    return m
  }, [def.nodes])

  const runByNodeKey = useMemo(() => {
    const m: Record<string, NodeRun> = {}
    if (!execution?.node_executions) return m
    execution.node_executions.forEach(r => {
      if (r.node_key) m[r.node_key] = r
    })
    return m
  }, [execution])

  const sel = selected ? def.nodes.find(n => n.node_id === selected) || null : null
  const cycle = def.edges.length > def.nodes.length

  return (
    <div className="p-4 md:p-6 max-w-[1500px] mx-auto">
      {/* header */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Zap size={18} style={{ color: '#4FF3FF' }} />
        <div className="flex-1 min-w-[200px]">
          <h1 className="font-mono font-bold text-lg" style={{ color: DEV_ACCENT.text }}>workflow builder</h1>
          <p className="font-mono text-[11px]" style={{ color: DEV_ACCENT.muted }}>
            drag nodes onto the canvas, wire the outputs, then run it
          </p>
        </div>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className={inputClass + ' w-56'}
          placeholder="workflow name"
        />
        <button
          onClick={save}
          disabled={busy}
          className="flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 rounded border disabled:opacity-50"
          style={{ borderColor: '#30363d', color: '#8b949e' }}
        >
          <Save size={13} /> {status === 'saved' ? 'saved' : 'save'}
        </button>
        <button
          onClick={run}
          disabled={busy || def.nodes.length === 0}
          className="flex items-center gap-1.5 font-mono text-xs px-3 py-1.5 rounded disabled:opacity-50 font-bold"
          style={{ background: '#4FF3FF', color: '#04252c' }}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} run
        </button>
      </div>

      {error && (
        <div className="mb-3 font-mono text-xs px-3 py-2 rounded flex items-start gap-2"
          style={{ background: 'rgba(248,113,113,.1)', border: '1px solid #f87171', color: '#f87171' }}>
          <X size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {cycle && (
        <div className="mb-3 font-mono text-xs px-3 py-2 rounded"
          style={{ background: 'rgba(251,191,36,.1)', border: '1px solid #fbbf24', color: '#fbbf24' }}>
          this graph has a cycle — a node can never be reached
        </div>
      )}

      <div className="flex gap-4 items-start" style={{ minHeight: 560 }}>
        {/* library */}
        <div className="w-44 shrink-0">
          <div className="font-mono text-[10px] uppercase tracking-wide mb-2" style={{ color: DEV_ACCENT.muted }}>
            node library
          </div>
          <div className="flex flex-col gap-1.5">
            {PALETTE.map(p => (
              <button
                key={p.type}
                onClick={() => addNode(p.type)}
                className="text-left rounded px-2.5 py-2 border transition-colors hover:bg-[#161b22]"
                style={{ borderColor: '#30363d', background: '#161b22' }}
              >
                <div className="flex items-center gap-1.5">
                  <Plus size={12} style={{ color: p.tint }} />
                  <span className="font-mono text-xs font-bold" style={{ color: p.tint }}>{p.label}</span>
                </div>
                <div className="font-mono text-[10px] mt-0.5" style={{ color: '#6e7681' }}>{p.blurb}</div>
              </button>
            ))}
          </div>

          <div className="font-mono text-[10px] uppercase tracking-wide mt-5 mb-2" style={{ color: DEV_ACCENT.muted }}>
            saved ({rows.filter(r => r.definition && r.definition.nodes?.length).length})
          </div>
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
            {rows.filter(r => r.definition && r.definition.nodes?.length).map(r => (
              <div
                key={r.id}
                className="flex items-center gap-1 rounded px-2 py-1.5 cursor-pointer group"
                style={{
                  border: '1px solid #30363d',
                  background: current?.id === r.id ? '#161b22' : 'transparent',
                }}
                onClick={() => adopt(r)}
              >
                <span className="font-mono text-[11px] flex-1 truncate" style={{ color: '#e6edf3' }}>{r.name}</span>
                <button
                  onClick={e => { e.stopPropagation(); del(r.id) }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: '#f87171' }}
                  aria-label={`delete ${r.name}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {rows.filter(r => r.definition && r.definition.nodes?.length).length === 0 && (
              <div className="font-mono text-[10px]" style={{ color: '#6e7681' }}>none yet</div>
            )}
          </div>
        </div>

        {/* canvas */}
        <div className="flex-1 min-w-0">
          <div
            className="rounded border overflow-auto"
            style={{ borderColor: '#30363d', height: 560 }}
          >
            {/* The inner surface has a fixed logical size and scrolls, so a node
                placed near the right edge is never clipped by the viewport. */}
            <div
              ref={canvasRef}
              onClick={() => { setLinking(null); setSelected(null) }}
              className="relative"
              style={{
                width: 1400,
                height: 560,
                background: '#010409',
                backgroundImage: 'radial-gradient(circle, #1c2128 1px, transparent 1px)',
                backgroundSize: '22px 22px',
                cursor: dragging ? 'grabbing' : 'default',
              }}
            >
            {/* edges */}
            <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
              {def.edges.map((e, i) => {
                const a = nodeById[e.from_node_id]
                const b = nodeById[e.to_node_id]
                if (!a || !b) return null
                const yOff = e.from_output === 'false' ? NODE_H * 0.72 : e.from_output === 'true' ? NODE_H * 0.28 : NODE_H / 2
                const x1 = a.position_x + NODE_W
                const y1 = a.position_y + yOff
                const x2 = b.position_x
                const y2 = b.position_y + NODE_H / 2
                const mx = (x1 + x2) / 2
                const stroke = e.from_output === 'false' ? '#6e7681' : '#30363d'
                return (
                  <g key={i} className="pointer-events-auto" style={{ pointerEvents: 'stroke' }}>
                    <path
                      d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={1.5}
                    />
                    <circle
                      cx={mx} cy={(y1 + y2) / 2} r={7}
                      fill="#010409" stroke={stroke}
                      className="cursor-pointer"
                      onClick={ev => { ev.stopPropagation(); unlink(i) }}
                    >
                      <title>remove this edge</title>
                    </circle>
                  </g>
                )
              })}
            </svg>

            {/* nodes */}
            {def.nodes.map(n => {
              const meta = PALETTE.find(p => p.type === n.node_type)!
              const run = runByNodeKey[n.node_id]
              const runStyle = run ? (RUN_STATUS[run.status] || { color: '#6e7681' }).color : null
              return (
                <div
                  key={n.node_id}
                  onMouseDown={e => onNodeMouseDown(e, n.node_id)}
                  onClick={e => {
                    e.stopPropagation()
                    // A pending connection completes by clicking the target.
                    if (linking) {
                      const [fromId, port] = linking.split('::')
                      link(fromId, port ?? 'output', n.node_id)
                      return
                    }
                    setSelected(n.node_id)
                  }}
                  className="absolute rounded select-none"
                  style={{
                    left: n.position_x,
                    top: n.position_y,
                    width: NODE_W,
                    minHeight: NODE_H,
                    border: `1px solid ${runStyle || (selected === n.node_id ? meta.tint : '#30363d')}`,
                    background: '#0d1117',
                    cursor: 'grab',
                    boxShadow: selected === n.node_id ? `0 0 0 1px ${meta.tint}` : 'none',
                  }}
                >
                  <div className="flex items-center gap-1.5 px-2 py-1.5" style={{ borderBottom: '1px solid #21262d' }}>
                    <span className="font-mono text-[9px] uppercase px-1 rounded" style={{ background: meta.tint, color: '#04252c' }}>
                      {n.node_type}
                    </span>
                    <span className="font-mono text-[10px] truncate flex-1" style={{ color: '#8b949e' }}>{n.node_id}</span>
                    <button onClick={e => { e.stopPropagation(); removeNode(n.node_id) }} style={{ color: '#f87171' }} aria-label="delete node">
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <div className="px-2 py-1.5 font-mono text-[10px] truncate" style={{ color: '#6e7681' }}>
                    {String(n.config.prompt || n.config.condition || n.config.tool || n.config.transform || '—').slice(0, 30)}
                  </div>

                  {/* output ports */}
                  <div className="absolute -right-1.5 flex flex-col gap-1" style={{ top: 8 }}>
                    {portsOf(n).map(port => (
                      <button
                        key={port}
                        onClick={e => { e.stopPropagation(); setLinking(port === 'output' ? n.node_id : `${n.node_id}::${port}`) }}
                        title={`connect from ${port}`}
                        className="rounded-full border-2"
                        style={{
                          width: 11, height: 11, padding: 0,
                          borderColor: linking === n.node_id || linking === `${n.node_id}::${port}` ? meta.tint : '#30363d',
                          background: linking === n.node_id || linking === `${n.node_id}::${port}` ? meta.tint : '#010409',
                          marginBottom: 4,
                        }}
                      />
                    ))}
                  </div>
                </div>
              )
            })}

            {def.nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="font-mono text-xs text-center" style={{ color: '#6e7681' }}>
                  <div>add a node from the library to start</div>
                  <div className="text-[10px] mt-1">click a node's dot, then click another node, to connect them</div>
                </div>
              </div>
            )}

            {linking && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 font-mono text-[10px] px-2.5 py-1 rounded flex items-center gap-1.5"
                style={{ background: '#161b22', border: '1px solid #4FF3FF', color: '#4FF3FF' }}>
                <Link2 size={11} />
                connecting from {linking.split('::').pop()} — click the target node
                <button onClick={e => { e.stopPropagation(); setLinking(null) }}><X size={11} /></button>
              </div>
            )}
            </div>
          </div>
        </div>

        {/* inspector */}
        <div className="w-72 shrink-0">
          {sel ? (
            <div className="rounded border p-3" style={{ borderColor: '#30363d', background: '#0d1117' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs font-bold" style={{ color: '#4FF3FF' }}>{sel.node_id}</span>
                <span className="font-mono text-[10px] uppercase" style={{ color: '#6e7681' }}>{sel.node_type}</span>
              </div>

              {sel.node_type === 'llm' && (
                <>
                  <div className="mb-2">
                    <label className={labelClass}>model</label>
                    <input className={inputClass} value={sel.config.model ?? ''}
                      onChange={e => patchConfig(sel.node_id, 'model', e.target.value)} />
                  </div>
                  <div className="mb-2">
                    <label className={labelClass}>prompt</label>
                    <textarea className={inputClass + ' h-24 resize-none'} value={sel.config.prompt ?? ''}
                      onChange={e => patchConfig(sel.node_id, 'prompt', e.target.value)} />
                    <div className="font-mono text-[9px] mt-1" style={{ color: '#6e7681' }}>
                      {'{{node.output}} and {{input}} are substituted at run time'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className={labelClass}>temp</label>
                      <input type="number" step="0.1" min="0" max="2" className={inputClass} value={sel.config.temperature ?? 0.7}
                        onChange={e => patchConfig(sel.node_id, 'temperature', Number(e.target.value))} />
                    </div>
                    <div className="flex-1">
                      <label className={labelClass}>max tokens</label>
                      <input type="number" className={inputClass} value={sel.config.max_tokens ?? ''}
                        onChange={e => patchConfig(sel.node_id, 'max_tokens', e.target.value ? Number(e.target.value) : undefined)} />
                    </div>
                  </div>
                </>
              )}

              {sel.node_type === 'tool' && (
                <>
                  <div className="mb-2">
                    <label className={labelClass}>tool</label>
                    <select className={inputClass} value={sel.config.tool ?? ''}
                      onChange={e => patchConfig(sel.node_id, 'tool', e.target.value)}>
                      {TOOLS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>input</label>
                    <textarea className={inputClass + ' h-24 resize-none'} value={sel.config.input ?? ''}
                      onChange={e => patchConfig(sel.node_id, 'input', e.target.value)} />
                  </div>
                </>
              )}

              {sel.node_type === 'condition' && (
                <div>
                  <label className={labelClass}>expression</label>
                  <input className={inputClass} value={sel.config.condition ?? ''}
                    onChange={e => patchConfig(sel.node_id, 'condition', e.target.value)} />
                  <div className="font-mono text-[9px] mt-2" style={{ color: '#6e7681' }}>
                    compares only — no function calls. wire the true / false dots
                    to route downstream nodes.
                  </div>
                </div>
              )}

              {sel.node_type === 'transform' && (
                <>
                  <div className="mb-2">
                    <label className={labelClass}>operation</label>
                    <select className={inputClass} value={sel.config.transform ?? 'passthrough'}
                      onChange={e => patchConfig(sel.node_id, 'transform', e.target.value)}>
                      {['passthrough', 'json_parse', 'json_stringify', 'template'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>value</label>
                    <textarea className={inputClass + ' h-20 resize-none'} value={sel.config.value ?? ''}
                      onChange={e => patchConfig(sel.node_id, 'value', e.target.value)} />
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="rounded border p-3 font-mono text-[10px]" style={{ borderColor: '#30363d', color: '#6e7681' }}>
              select a node to edit it
            </div>
          )}

          {/* run panel */}
          <div className="rounded border p-3 mt-3" style={{ borderColor: '#30363d', background: '#0d1117' }}>
            <div className="font-mono text-[10px] uppercase tracking-wide mb-2" style={{ color: DEV_ACCENT.muted }}>
              run input
            </div>
            <textarea
              className={inputClass + ' h-20 resize-none'}
              value={runInput}
              onChange={e => setRunInput(e.target.value)}
            />
            {execution && (
              <div className="mt-3">
                <div className="flex items-center gap-1.5 mb-1.5">
                  {(() => {
                    const s = RUN_STATUS[execution.status] || { icon: Circle, color: '#6e7681' }
                    const Icon = s.icon
                    return (
                      <>
                        <Icon size={12} style={{ color: s.color }} className={execution.status === 'running' ? 'animate-spin' : ''} />
                        <span className="font-mono text-[11px] font-bold" style={{ color: s.color }}>{execution.status}</span>
                      </>
                    )
                  })()}
                  <span className="font-mono text-[10px] ml-auto" style={{ color: '#6e7681' }}>
                    {execution.total_latency_ms} ms
                  </span>
                </div>
                {execution.error_message && (
                  <div className="font-mono text-[10px] mb-1.5" style={{ color: '#f87171' }}>{execution.error_message}</div>
                )}
                {execution.node_executions && execution.node_executions.length > 0 && (
                  <div className="flex flex-col gap-1 mb-2">
                    {execution.node_executions.map(r => {
                      const s = RUN_STATUS[r.status] || { icon: Circle, color: '#6e7681' }
                      const Icon = s.icon
                      return (
                        <div key={`${r.node_id}-${r.node_key ?? r.node_id}`} className="font-mono text-[10px] flex items-start gap-1.5">
                          <Icon size={11} style={{ color: s.color }} className="mt-0.5 shrink-0" />
                          <span className="font-bold shrink-0" style={{ color: s.color }}>{r.status}</span>
                          <span className="truncate" style={{ color: '#8b949e' }}>{r.node_key ?? `#${r.node_id}`}</span>
                          <span className="ml-auto shrink-0" style={{ color: '#6e7681' }}>{r.latency_ms} ms</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="font-mono text-[10px] mb-1" style={{ color: '#6e7681' }}>
                  <Terminal size={10} className="inline mr-1" />output
                </div>
                <pre className="font-mono text-[10px] p-2 rounded overflow-auto max-h-40"
                  style={{ background: '#010409', color: '#e6edf3', border: '1px solid #21262d' }}>
                  {JSON.stringify(execution.output_data, null, 2) ?? '—'}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
