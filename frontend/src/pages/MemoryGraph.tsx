import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Network, RefreshCw, Database, FileText, Boxes, Brain, Info } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../store/auth'
import { clsx } from 'clsx'

type NodeType = 'kb' | 'document' | 'chunk' | 'memory'
interface GNode { id: string; type: NodeType; label: string; detail?: string; source_kind?: string }
interface GEdge { source: string; target: string; type: 'contains' | 'semantic'; weight?: number }
interface GraphResp {
  nodes: GNode[]
  edges: GEdge[]
  stats: { kbs: number; documents: number; chunks: number; memories: number; semantic_edges: number; embed_model: string; threshold: number }
}

interface SimNode extends GNode { x: number; y: number; vx: number; vy: number; fx?: number; fy?: number }

const TYPE_META: Record<NodeType, { color: string; r: number; label: string; icon: any }> = {
  kb:       { color: '#f59e0b', r: 13, label: 'Knowledge Base', icon: Database },
  document: { color: '#60a5fa', r: 9,  label: 'Document',       icon: FileText },
  chunk:    { color: '#34d399', r: 5,  label: 'Chunk',          icon: Boxes },
  memory:   { color: '#a78bfa', r: 7,  label: 'Memory',         icon: Brain },
}

const W = 1000
const H = 680

export default function MemoryGraphPage() {
  const { user } = useAuth()
  const [data, setData] = useState<GraphResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [threshold, setThreshold] = useState(0.78)
  const [hovered, setHovered] = useState<SimNode | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })

  const sim = useRef<SimNode[]>([])
  const rafRef = useRef<number | null>(null)
  const alphaRef = useRef(1)
  const [, force] = useState(0)  // re-render trigger
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ id: string | null; panStart?: { x: number; y: number; vx: number; vy: number } }>({ id: null })

  const load = useCallback((th: number) => {
    setLoading(true)
    api.get(`/memory/graph?threshold=${th}`)
      .then(({ data }) => setData(data))
      .catch(() => setData({ nodes: [], edges: [], stats: { kbs: 0, documents: 0, chunks: 0, memories: 0, semantic_edges: 0, embed_model: '', threshold: th } }))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(threshold) }, [])

  // (re)build the simulation whenever data changes
  useEffect(() => {
    if (!data) return
    const n = data.nodes.length
    sim.current = data.nodes.map((nd, i) => {
      const angle = (i / Math.max(1, n)) * Math.PI * 2
      const radius = nd.type === 'kb' ? 40 : 120 + Math.random() * 200
      return { ...nd, x: W / 2 + Math.cos(angle) * radius, y: H / 2 + Math.sin(angle) * radius, vx: 0, vy: 0 }
    })
    alphaRef.current = 1
    setView({ x: 0, y: 0, k: 1 })
    startSim()
    return stopSim
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const edgeIndex = useMemo(() => {
    const idx = new Map<string, number>()
    sim.current.forEach((s, i) => idx.set(s.id, i))
    return idx
  }, [data])

  function stopSim() { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null }

  function startSim() {
    stopSim()
    const nodes = sim.current
    const idx = new Map<string, number>()
    nodes.forEach((s, i) => idx.set(s.id, i))
    const edges = (data?.edges || [])
      .map(e => ({ s: idx.get(e.source)!, t: idx.get(e.target)!, type: e.type }))
      .filter(e => e.s != null && e.t != null)

    const k = 90               // ideal spacing
    const tick = () => {
      const alpha = alphaRef.current
      const N = nodes.length
      // repulsion (O(n^2) — fine for a few hundred nodes)
      for (let i = 0; i < N; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < N; j++) {
          const b = nodes[j]
          let dx = a.x - b.x, dy = a.y - b.y
          let d2 = dx * dx + dy * dy
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.01 }
          const d = Math.sqrt(d2)
          const f = (k * k) / d
          const fx = (dx / d) * f, fy = (dy / d) * f
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
        }
      }
      // attraction along edges
      for (const e of edges) {
        const a = nodes[e.s], b = nodes[e.t]
        const dx = b.x - a.x, dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01
        const target = e.type === 'contains' ? 60 : 110
        const f = (d - target) / d * (e.type === 'contains' ? 0.12 : 0.06)
        const fx = dx * f, fy = dy * f
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy
      }
      // gravity to center + integrate
      for (const nd of nodes) {
        nd.vx += (W / 2 - nd.x) * 0.012
        nd.vy += (H / 2 - nd.y) * 0.012
        if (nd.fx != null) { nd.x = nd.fx; nd.y = nd.fy!; nd.vx = 0; nd.vy = 0; continue }
        nd.vx *= 0.82; nd.vy *= 0.82
        nd.x += nd.vx * alpha * 0.5
        nd.y += nd.vy * alpha * 0.5
      }
      alphaRef.current *= 0.985
      force(v => v + 1)
      if (alphaRef.current > 0.03 || drag.current.id) rafRef.current = requestAnimationFrame(tick)
      else rafRef.current = null
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  // ── interaction ────────────────────────────────────────────────────────────
  const toLocal = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const sx = (clientX - rect.left) / rect.width * W
    const sy = (clientY - rect.top) / rect.height * H
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k }
  }

  const onNodeDown = (e: React.PointerEvent, node: SimNode) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current.id = node.id
    setSelected(node.id)
    node.fx = node.x; node.fy = node.y
    alphaRef.current = Math.max(alphaRef.current, 0.5)
    if (!rafRef.current) startSim()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current.id) {
      const p = toLocal(e.clientX, e.clientY)
      const node = sim.current.find(s => s.id === drag.current.id)
      if (node) { node.fx = p.x; node.fy = p.y }
    } else if (drag.current.panStart) {
      const ps = drag.current.panStart
      setView(v => ({ ...v, x: ps.vx + (e.clientX - ps.x), y: ps.vy + (e.clientY - ps.y) }))
    }
  }
  const onPointerUp = () => {
    if (drag.current.id) {
      const node = sim.current.find(s => s.id === drag.current.id)
      if (node) { node.fx = undefined; node.fy = undefined }
    }
    drag.current.id = null
    drag.current.panStart = undefined
  }
  const onBgDown = (e: React.PointerEvent) => {
    drag.current.panStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
    setSelected(null)
  }
  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const mx = (e.clientX - rect.left) / rect.width * W
    const my = (e.clientY - rect.top) / rect.height * H
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setView(v => {
      const k = Math.min(4, Math.max(0.25, v.k * factor))
      return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) }
    })
  }

  // neighbours of the selected node (for highlight)
  const neighbours = useMemo(() => {
    if (!selected || !data) return null
    const set = new Set<string>([selected])
    for (const e of data.edges) {
      if (e.source === selected) set.add(e.target)
      if (e.target === selected) set.add(e.source)
    }
    return set
  }, [selected, data])

  const nodes = sim.current
  const idxById = new Map(nodes.map((s, i) => [s.id, i]))
  const stats = data?.stats
  const isEmpty = !loading && nodes.length === 0

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <Network className="w-6 h-6 text-primary-400" /> Knowledge Graph
          </h1>
          <p className="text-gray-400 mt-1">See how the AI stores and connects knowledge — bases, documents, chunks and memories, linked by meaning.</p>
        </div>
        <button onClick={() => load(threshold)} className="btn-secondary" disabled={loading}>
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} /> Refresh
        </button>
      </div>

      {/* Controls + stats */}
      <div className="card mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3 min-w-[260px]">
          <span className="text-sm text-gray-400 whitespace-nowrap">Similarity ≥ {threshold.toFixed(2)}</span>
          <input type="range" min={0.5} max={0.95} step={0.01} value={threshold}
            onChange={(e) => setThreshold(+e.target.value)}
            onMouseUp={() => load(threshold)} onTouchEnd={() => load(threshold)}
            className="flex-1 accent-primary-500" />
        </div>
        {stats && (
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
            <Stat icon={Database} color={TYPE_META.kb.color} n={stats.kbs} label="bases" />
            <Stat icon={FileText} color={TYPE_META.document.color} n={stats.documents} label="docs" />
            <Stat icon={Boxes} color={TYPE_META.chunk.color} n={stats.chunks} label="chunks" />
            <Stat icon={Brain} color={TYPE_META.memory.color} n={stats.memories} label="memories" />
            <span className="text-gray-500">·</span>
            <span><b className="text-gray-200">{stats.semantic_edges}</b> semantic links</span>
            {user?.is_admin && stats.embed_model && <span className="text-gray-600 text-xs">via {stats.embed_model}</span>}
          </div>
        )}
      </div>

      <div className="card p-0 overflow-hidden relative" style={{ height: 680 }}>
        {isEmpty ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 px-6 text-center">
            <Network className="w-12 h-12 mb-3" />
            <p className="font-medium text-gray-400">No knowledge to graph yet</p>
            <p className="text-sm mt-1 max-w-sm">Add documents in <b>Knowledge</b> or save <b>Memories</b>, then come back to see how the AI connects them.</p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-full touch-none cursor-grab active:cursor-grabbing"
            onPointerDown={onBgDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
          >
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              {/* edges */}
              {(data?.edges || []).map((e, i) => {
                const a = nodes[idxById.get(e.source) ?? -1]
                const b = nodes[idxById.get(e.target) ?? -1]
                if (!a || !b) return null
                const dim = neighbours && !(neighbours.has(e.source) && neighbours.has(e.target))
                const semantic = e.type === 'semantic'
                return (
                  <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={semantic ? '#34d399' : '#4b5563'}
                    strokeWidth={semantic ? Math.max(0.6, (e.weight || 0.7) * 2.2) : 1}
                    strokeDasharray={semantic ? '4 3' : undefined}
                    strokeOpacity={dim ? 0.05 : semantic ? 0.35 + (e.weight || 0) * 0.4 : 0.45} />
                )
              })}
              {/* nodes */}
              {nodes.map((nd) => {
                const meta = TYPE_META[nd.type]
                const dim = neighbours && !neighbours.has(nd.id)
                const sel = selected === nd.id
                return (
                  <g key={nd.id} transform={`translate(${nd.x},${nd.y})`}
                     onPointerDown={(e) => onNodeDown(e, nd)}
                     onPointerEnter={() => setHovered(nd)}
                     onPointerLeave={() => setHovered(h => (h?.id === nd.id ? null : h))}
                     style={{ cursor: 'pointer' }}>
                    <circle r={meta.r + (sel ? 3 : 0)} fill={meta.color}
                      fillOpacity={dim ? 0.15 : 0.9}
                      stroke={sel ? '#fff' : '#0b0b0c'} strokeWidth={sel ? 2 : 1} />
                    {(nd.type === 'kb' || nd.type === 'document' || sel) && !dim && (
                      <text x={meta.r + 4} y={4} fontSize={nd.type === 'kb' ? 13 : 10}
                        fill="#d1d5db" className="select-none pointer-events-none">
                        {nd.label.length > 26 ? nd.label.slice(0, 26) + '…' : nd.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        )}

        {/* legend */}
        {!isEmpty && (
          <div className="absolute top-3 left-3 bg-gray-950/80 backdrop-blur rounded-lg px-3 py-2 text-xs space-y-1 border border-gray-800">
            {(Object.keys(TYPE_META) as NodeType[]).map((t) => (
              <div key={t} className="flex items-center gap-2 text-gray-400">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_META[t].color }} />
                {TYPE_META[t].label}
              </div>
            ))}
            <div className="flex items-center gap-2 text-gray-500 pt-1 border-t border-gray-800 mt-1">
              <span className="inline-block w-4 border-t border-dashed border-emerald-400" /> semantic link
            </div>
          </div>
        )}

        {/* hover tooltip */}
        {hovered && (
          <div className="absolute bottom-3 right-3 max-w-sm bg-gray-950/90 backdrop-blur rounded-lg p-3 text-xs border border-gray-800 pointer-events-none">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: TYPE_META[hovered.type].color }} />
              <span className="text-gray-300 font-medium">{TYPE_META[hovered.type].label}</span>
              {hovered.source_kind && <span className="badge bg-gray-800 text-gray-500">{hovered.source_kind}</span>}
            </div>
            <p className="text-gray-400 whitespace-pre-wrap break-words">{hovered.detail || hovered.label}</p>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/40">
            <RefreshCw className="w-6 h-6 text-primary-400 animate-spin" />
          </div>
        )}
      </div>

      <p className="text-xs text-gray-600 mt-2 flex items-center gap-1.5">
        <Info className="w-3.5 h-3.5" /> Drag nodes to explore · scroll to zoom · drag background to pan · click a node to highlight what it connects to.
      </p>
    </div>
  )
}

function Stat({ icon: Icon, color, n, label }: { icon: any; color: string; n: number; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5" style={{ color }} />
      <b className="text-gray-200">{n}</b> {label}
    </span>
  )
}
