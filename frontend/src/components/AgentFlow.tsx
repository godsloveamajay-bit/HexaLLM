import { useState } from 'react'
import {
  Brain, Wrench, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight,
  Globe, Code2, Terminal, FileText, Coins, Clock, Flag, AlertTriangle,
} from 'lucide-react'
import { clsx } from 'clsx'

// One agent "step" = the model deciding + (optionally) running a tool. The
// debugger expands each step into the discrete nodes an LLMOps view wants:
// a reasoning node (what the model thought + the tokens it cost) and a tool
// node (what ran + whether it succeeded), so you can see exactly where a chain
// broke and what each hop cost.

export interface FlowStep {
  step: number
  thought?: string
  tool?: string | null
  input?: string | null
  output?: string | null
  status?: 'success' | 'error' | 'completed' | 'running'
  tokens?: { prompt: number; completion: number; total: number }
  duration_ms?: number
}

type NodeKind = 'reason' | 'tool' | 'final' | 'fail'
interface FlowNode {
  kind: NodeKind
  stepNum: number
  component: string
  action: string
  status: 'success' | 'error' | 'completed' | 'running'
  tokens?: number
  durationMs?: number
  input?: string | null
  output?: string | null
}

const TOOL_ICONS: Record<string, any> = {
  web_search: Globe,
  code_exec: Code2,
  bash_exec: Terminal,
  read_file: FileText,
  write_file: FileText,
}

function fmtTokens(n?: number) {
  if (n == null) return '—'
  return `${n.toLocaleString()} tok`
}
function fmtDuration(ms?: number) {
  if (ms == null) return ''
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function buildNodes(steps: FlowStep[], model: string): FlowNode[] {
  const nodes: FlowNode[] = []
  for (const s of steps) {
    const tokens = s.tokens?.total
    if (s.tool === 'done') {
      nodes.push({
        kind: 'final', stepNum: s.step, component: 'Final answer',
        action: s.input || s.output || '(no answer)', status: 'completed',
        tokens, durationMs: s.duration_ms, output: s.output,
      })
      continue
    }
    if (!s.tool) {
      // Model produced no usable action (bad JSON / empty) — the break point.
      nodes.push({
        kind: 'fail', stepNum: s.step, component: model,
        action: s.thought || 'Model did not return a usable action',
        status: 'error', tokens, durationMs: s.duration_ms, output: s.output,
      })
      continue
    }
    // Reasoning hop — the model decided which tool to call.
    nodes.push({
      kind: 'reason', stepNum: s.step, component: model,
      action: s.thought || `Decided to call ${s.tool}`,
      status: 'success', tokens, durationMs: s.duration_ms,
    })
    // Tool hop — what actually executed.
    nodes.push({
      kind: 'tool', stepNum: s.step, component: s.tool,
      action: s.input || '(no input)', status: s.status || 'success',
      input: s.input, output: s.output,
    })
  }
  return nodes
}

function NodeIcon({ node }: { node: FlowNode }) {
  if (node.kind === 'final') return <Flag className="w-3.5 h-3.5" />
  if (node.kind === 'tool') {
    const Icon = TOOL_ICONS[node.component] || Wrench
    return <Icon className="w-3.5 h-3.5" />
  }
  return <Brain className="w-3.5 h-3.5" />
}

function StatusBadge({ status }: { status: FlowNode['status'] }) {
  if (status === 'running')
    return <span className="inline-flex items-center gap-1 text-amber-400 text-[11px]"><Loader2 className="w-3 h-3 animate-spin" />Running</span>
  if (status === 'error')
    return <span className="inline-flex items-center gap-1 text-red-400 text-[11px]"><XCircle className="w-3 h-3" />Error</span>
  return <span className="inline-flex items-center gap-1 text-green-400 text-[11px]"><CheckCircle2 className="w-3 h-3" />{status === 'completed' ? 'Done' : 'Success'}</span>
}

function FlowNodeCard({ node, broke }: { node: FlowNode; broke: boolean }) {
  const [open, setOpen] = useState(false)
  const hasDetail = !!(node.input || node.output)
  const dot =
    node.status === 'error' ? 'bg-red-500' :
    node.status === 'running' ? 'bg-amber-400' :
    node.kind === 'final' ? 'bg-green-400' : 'bg-primary-500'

  return (
    <div className="relative pl-8">
      {/* rail */}
      <span className="absolute left-[10px] top-0 bottom-0 w-px bg-gray-700/70" />
      <span className={clsx('absolute left-[5px] top-3 w-[11px] h-[11px] rounded-full ring-4 ring-gray-950', dot,
        broke && 'animate-pulse')} />

      <div className={clsx('mb-2 rounded-lg border bg-gray-800/40 overflow-hidden',
        broke ? 'border-red-700/70 shadow-[0_0_0_1px_rgba(239,68,68,0.25)]' : 'border-gray-700/60')}>
        <button
          onClick={() => hasDetail && setOpen(!open)}
          className={clsx('w-full flex items-center gap-2.5 px-3 py-2 text-left',
            hasDetail && 'hover:bg-gray-800/70 transition-colors')}
        >
          <div className={clsx('w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0',
            node.status === 'error' ? 'bg-red-900/50 text-red-300' :
            node.kind === 'final' ? 'bg-green-900/50 text-green-300' :
            node.kind === 'tool' ? 'bg-blue-900/40 text-blue-300' : 'bg-primary-900/50 text-primary-300')}>
            <NodeIcon node={node} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 flex-shrink-0">#{node.stepNum}</span>
              <span className="text-xs font-semibold text-gray-200 truncate">{node.component}</span>
            </div>
            <p className="text-xs text-gray-400 truncate mt-0.5">{node.action}</p>
          </div>

          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <StatusBadge status={node.status} />
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              {node.tokens != null && (
                <span className="inline-flex items-center gap-0.5"><Coins className="w-3 h-3" />{fmtTokens(node.tokens)}</span>
              )}
              {node.durationMs != null && (
                <span className="inline-flex items-center gap-0.5"><Clock className="w-3 h-3" />{fmtDuration(node.durationMs)}</span>
              )}
            </div>
          </div>
          {hasDetail && (open
            ? <ChevronDown className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
            : <ChevronRight className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />)}
        </button>

        {open && hasDetail && (
          <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-700/40">
            {node.input && (
              <div>
                <p className="text-gray-600 uppercase tracking-wide mb-0.5" style={{ fontSize: '10px' }}>Input</p>
                <pre className="bg-gray-900/80 rounded p-2 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-32">{node.input}</pre>
              </div>
            )}
            {node.output && (
              <div>
                <p className="text-gray-600 uppercase tracking-wide mb-0.5" style={{ fontSize: '10px' }}>Output</p>
                <pre className="bg-gray-900/80 rounded p-2 text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-40">{node.output}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function AgentFlow({
  steps, model, running, error,
}: {
  steps: FlowStep[]
  model: string
  running: boolean
  error?: string | null
}) {
  const nodes = buildNodes(steps, model)
  if (nodes.length === 0 && !running) return null

  const totalTokens = steps.reduce((a, s) => a + (s.tokens?.total || 0), 0)
  const totalMs = steps.reduce((a, s) => a + (s.duration_ms || 0), 0)
  const breakIndex = nodes.findIndex((n) => n.status === 'error')
  const broke = breakIndex !== -1 && !running

  return (
    <div className="border border-gray-700/60 rounded-xl bg-gray-900/30 overflow-hidden">
      {/* Telemetry header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 bg-gray-800/40 border-b border-gray-700/50 text-xs">
        <span className="font-semibold text-gray-200">Flow trace</span>
        <span className="text-gray-400">{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
        <span className="inline-flex items-center gap-1 text-gray-400"><Coins className="w-3.5 h-3.5" />{totalTokens.toLocaleString()} tokens</span>
        {totalMs > 0 && <span className="inline-flex items-center gap-1 text-gray-400"><Clock className="w-3.5 h-3.5" />{fmtDuration(totalMs)}</span>}
        {running && <span className="inline-flex items-center gap-1 text-amber-400 ml-auto"><Loader2 className="w-3.5 h-3.5 animate-spin" />tracing…</span>}
      </div>

      {/* Break banner */}
      {broke && (
        <div className="flex items-start gap-2 px-4 py-2 bg-red-950/40 border-b border-red-800/40 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Chain broke at step #{nodes[breakIndex].stepNum} — <span className="font-medium">{nodes[breakIndex].component}</span>: {nodes[breakIndex].action}
          </span>
        </div>
      )}

      {/* Node graph */}
      <div className="p-3 pt-4">
        {nodes.map((n, i) => (
          <FlowNodeCard key={i} node={n} broke={broke && i === breakIndex} />
        ))}
        {running && (
          <div className="relative pl-8">
            <span className="absolute left-[5px] top-1 w-[11px] h-[11px] rounded-full bg-amber-400 ring-4 ring-gray-950 animate-pulse" />
            <div className="flex items-center gap-2 text-gray-500 text-xs py-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> waiting for next hop…
            </div>
          </div>
        )}
      </div>

      {error && !broke && (
        <div className="px-4 py-2 bg-amber-950/30 border-t border-amber-800/30 text-xs text-amber-300">{error}</div>
      )}
    </div>
  )
}
