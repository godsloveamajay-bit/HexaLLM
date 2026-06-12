import { useState, useEffect, useRef } from 'react'
import { Bot, Play, ChevronDown, ChevronRight, Globe, Code2, FileText, Check, Loader2, Search, BarChart2, Sliders, Server, Brain, Terminal, ShieldCheck, ShieldAlert, Wrench, GitBranch, FolderSearch, Clock, Zap } from 'lucide-react'
import api, { baseURL } from '../lib/api'
import { loadModelOptions, defaultModelValue, ModelOption } from '../lib/models'
import { useAuth } from '../store/auth'
import AgentFlow, { FlowStep } from '../components/AgentFlow'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface MCPServer { id: number; name: string; tools_cache: any[] | null }

interface Step {
  step: number
  thought?: string
  tool?: string
  input?: string
  output?: string
  status?: 'success' | 'error' | 'completed' | 'running'
  tokens?: { prompt: number; completion: number; total: number }
  duration_ms?: number
}

interface AgentRun {
  id: number
  task: string
  model_name?: string
  status: string
  steps: Step[]
  result?: string
  error?: string
  created_at: string
}

const TOOL_ICONS: Record<string, any> = {
  web_search: Globe,
  code_exec: Code2,
  bash_exec: Terminal,
  read_file: FileText,
  write_file: FileText,
  list_files: FolderSearch,
  delegate: GitBranch,
}

const AVAILABLE_TOOLS = ['web_search', 'code_exec', 'bash_exec', 'read_file', 'write_file', 'list_files']

interface Persona {
  id: string
  label: string
  description: string
  icon: any
  tools: string[]
  systemPrompt: string
}

const PERSONAS: Persona[] = [
  {
    id: 'research',
    label: 'Research Assistant',
    description: 'Searches the web and synthesizes information',
    icon: Search,
    tools: ['web_search', 'read_file'],
    systemPrompt: 'You are a meticulous research assistant. Your goal is to find accurate, up-to-date information and present it in a clear, structured way with sources cited.',
  },
  {
    id: 'coder',
    label: 'Code Engineer',
    description: 'Writes, runs, and debugs code',
    icon: Code2,
    tools: ['code_exec', 'bash_exec', 'read_file', 'write_file'],
    systemPrompt: 'You are an expert software engineer. Write clean, efficient code. Always test your code by executing it. When writing files, prefer well-structured, readable code with clear variable names.',
  },
  {
    id: 'analyst',
    label: 'Data Analyst',
    description: 'Analyses data and produces insights',
    icon: BarChart2,
    tools: ['code_exec', 'bash_exec', 'read_file'],
    systemPrompt: 'You are a skilled data analyst. Use Python with pandas, numpy, or other libraries to analyse data. Produce clear summaries with key statistics and actionable insights.',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Configure tools and behaviour yourself',
    icon: Sliders,
    tools: AVAILABLE_TOOLS,
    systemPrompt: '',
  },
]

interface SandboxStatus {
  docker_available: boolean
  mode: 'docker' | 'subprocess'
  image: string | null
}

function SubStepCard({ text }: { text: string }) {
  const match = text.match(/^\s*Step\s+(\d+):\s+(\S+)\s+→\s+(.*)$/)
  if (!match) return <pre className="text-xs text-gray-500 pl-4">{text}</pre>
  const [, num, tool, output] = match
  const Icon = TOOL_ICONS[tool] || Bot
  return (
    <div className="flex items-start gap-2 pl-4 py-1 border-l-2 border-primary-800/30">
      <Icon className="w-3 h-3 text-primary-400 mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="text-xs text-gray-500">Step {num}</span>{' '}
        <span className="text-xs text-gray-300 font-medium">{tool}</span>
        <p className="text-xs text-gray-500 truncate mt-0.5">{output}</p>
      </div>
    </div>
  )
}

function StepCard({ step }: { step: Step }) {
  const [open, setOpen] = useState(false)
  const Icon = step.tool ? TOOL_ICONS[step.tool] || Bot : Bot

  const isDelegate = step.tool === 'delegate'
  let delegateResult = ''
  let delegateSteps: string[] = []
  if (isDelegate && step.output) {
    const parts = step.output.split('\n\nSub-agent steps:\n')
    delegateResult = parts[0] ? parts[0].replace(/^Sub-agent result:\s*/, '') : ''
    if (parts[1]) {
      delegateSteps = parts[1].split('\n').filter(l => l.trim() && l.match(/^\s*Step/))
    }
  }

  return (
    <div className="border border-gray-700/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2 bg-gray-800/40 hover:bg-gray-800/70 transition-colors text-left"
      >
        <div className={clsx('w-5 h-5 rounded flex items-center justify-center flex-shrink-0',
          step.tool === 'done' ? 'bg-green-900/60' : 'bg-primary-900/60'
        )}>
          <Icon className="w-3 h-3 text-primary-300" />
        </div>
        <span className="text-xs text-gray-500">Step {step.step}</span>
        <span className={clsx('text-xs font-medium flex-1 truncate',
          step.tool === 'delegate' ? 'text-purple-300' : 'text-gray-300'
        )}>
          {step.tool === 'done' ? 'Finished' : step.tool || 'thinking'}
          {step.thought ? ` — ${step.thought.slice(0, 60)}${step.thought.length > 60 ? '…' : ''}` : ''}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {step.duration_ms != null && step.duration_ms > 0 && (
            <span className="text-xs text-gray-600 flex items-center gap-0.5" title="Duration">
              <Clock className="w-3 h-3" />
              {step.duration_ms >= 1000 ? `${(step.duration_ms / 1000).toFixed(1)}s` : `${step.duration_ms}ms`}
            </span>
          )}
          {step.tokens?.total != null && step.tokens.total > 0 && (
            <span className="text-xs text-gray-600 flex items-center gap-0.5" title="Tokens">
              <Zap className="w-3 h-3" />
              {step.tokens.total}
            </span>
          )}
        </div>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2 space-y-2 text-xs">
          {step.thought && (
            <div>
              <p className="text-gray-600 mb-0.5 uppercase tracking-wide" style={{ fontSize: '10px' }}>Thought</p>
              <p className="text-gray-300 italic leading-relaxed">{step.thought}</p>
            </div>
          )}
          {step.input && step.tool !== 'done' && (
            <div>
              <p className="text-gray-600 mb-0.5 uppercase tracking-wide" style={{ fontSize: '10px' }}>Input</p>
              <pre className="bg-gray-900/80 rounded p-2 text-gray-300 overflow-x-auto whitespace-pre-wrap">{step.input}</pre>
            </div>
          )}
          {isDelegate && delegateResult && (
            <div>
              <p className="text-gray-600 mb-0.5 uppercase tracking-wide" style={{ fontSize: '10px' }}>Sub-Agent Result</p>
              <p className="text-gray-200 whitespace-pre-wrap">{delegateResult}</p>
            </div>
          )}
          {isDelegate && delegateSteps.length > 0 && (
            <div>
              <p className="text-gray-600 mb-0.5 uppercase tracking-wide" style={{ fontSize: '10px' }}>Sub-Agent Steps</p>
              <div className="space-y-0.5">
                {delegateSteps.map((s, i) => <SubStepCard key={i} text={s} />)}
              </div>
            </div>
          )}
          {step.output && !isDelegate && (
            <div>
              <p className="text-gray-600 mb-0.5 uppercase tracking-wide" style={{ fontSize: '10px' }}>Output</p>
              <pre className="bg-gray-900/80 rounded p-2 text-gray-300 overflow-x-auto whitespace-pre-wrap max-h-40">{step.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ThoughtDrawer({ steps, running }: { steps: Step[]; running: boolean }) {
  const [open, setOpen] = useState(false)
  const prevRunning = useRef(false)

  useEffect(() => {
    if (running && !prevRunning.current) setOpen(true)
    if (!running && prevRunning.current && steps.length > 0) setOpen(false)
    prevRunning.current = running
  }, [running, steps.length])

  if (steps.length === 0 && !running) return null

  const toolSteps = steps.filter(s => s.tool !== 'done')

  return (
    <div className="border border-gray-700/60 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-4 py-3 bg-gray-800/30 hover:bg-gray-800/50 transition-colors text-left"
      >
        <Brain className={clsx('w-4 h-4 flex-shrink-0 transition-colors', running ? 'text-primary-400' : 'text-gray-500')} />
        <span className={clsx('text-sm font-medium flex-1 flex items-center gap-1.5', running ? 'text-primary-300' : 'text-gray-400')}>
          {running ? (
            <>
              Thinking
              {[0, 0.15, 0.3].map((delay, i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-bounce flex-shrink-0" style={{ animationDelay: `${delay}s` }} />
              ))}
            </>
          ) : (
            `Thought for ${toolSteps.length} step${toolSteps.length !== 1 ? 's' : ''}`
          )}
        </span>
        {steps.length > 0 && (
          open
            ? <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
            : <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="p-2.5 space-y-1.5 bg-gray-950/30 border-t border-gray-700/40">
          {steps.map((step, i) => (
            <StepCard key={i} step={step} />
          ))}
          {running && (
            <div className="flex items-center gap-2 text-gray-500 text-xs px-2 py-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              Running next step…
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AgentsPage() {
  const { user } = useAuth()
  const [task, setTask] = useState('')
  const [model, setModel] = useState('nebulax:balanced')
  const [persona, setPersona] = useState<string>('research')
  const [selectedTools, setSelectedTools] = useState(PERSONAS[0].tools)
  const [customPrompt, setCustomPrompt] = useState('')
  const [maxSteps, setMaxSteps] = useState(10)
  const [running, setRunning] = useState(false)
  const [currentRun, setCurrentRun] = useState<AgentRun | null>(null)
  const [history, setHistory] = useState<AgentRun[]>([])
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [selectedMcp, setSelectedMcp] = useState<number[]>([])
  const [genTools, setGenTools] = useState<{ id: number; name: string; description: string }[]>([])
  const [selectedGenTools, setSelectedGenTools] = useState<number[]>([])
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null)
  const [flowView, setFlowView] = useState(true)
  const [subagentModel, setSubagentModel] = useState('')
  const [subagentMaxDepth, setSubagentMaxDepth] = useState(3)
  const stepsRef = useRef<HTMLDivElement>(null)

  const activePersona = PERSONAS.find((p) => p.id === persona) ?? PERSONAS[0]

  const selectPersona = (p: Persona) => {
    setPersona(p.id)
    setSelectedTools(p.tools)
  }

  useEffect(() => {
    api.get('/agents/runs').then(({ data }) => setHistory(data)).catch(() => {})
    loadModelOptions(!!user?.is_admin).then((opts) => {
      if (opts.length) { setModelOptions(opts); setModel(defaultModelValue(opts)) }
    }).catch(() => {})
    api.get('/mcp').then(({ data }) => setMcpServers(data.filter((s: any) => s.tools_cache?.length))).catch(() => {})
    api.get('/tools').then(({ data }) =>
      setGenTools(data.filter((t: any) => t.status === 'approved' && t.enabled))).catch(() => {})
    api.get('/agents/sandbox/status').then(({ data }) => setSandboxStatus(data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (stepsRef.current) stepsRef.current.scrollTop = stepsRef.current.scrollHeight
  }, [currentRun?.steps])

  const toggleTool = (t: string) => {
    setSelectedTools((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }

  const runAgent = async () => {
    if (!task.trim()) return
    setRunning(true)
    setCurrentRun({ id: 0, task, status: 'running', steps: [], created_at: new Date().toISOString() })

    try {
      const resp = await fetch(`${baseURL}/agents/run/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          task,
          model,
          tools: selectedTools,
          max_steps: maxSteps,
          system_prompt: persona === 'custom' ? (customPrompt || undefined) : activePersona.systemPrompt,
          mcp_server_ids: selectedMcp,
          generated_tool_ids: selectedGenTools,
          subagent_model: subagentModel || undefined,
          subagent_max_depth: subagentMaxDepth,
        }),
      })

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'step') {
              setCurrentRun((r) => r ? { ...r, steps: [...r.steps, event.step] } : r)
            } else if (event.type === 'done') {
              setCurrentRun((r) => r ? { ...r, status: 'completed', result: event.result, error: event.error } : r)
            } else if (event.type === 'error') {
              setCurrentRun((r) => r ? { ...r, status: 'failed', error: event.error } : r)
            }
          } catch {}
        }
      }
    } catch (e) {
      toast.error('Agent run failed')
      setCurrentRun((r) => r ? { ...r, status: 'failed', error: 'Network error' } : r)
    } finally {
      setRunning(false)
      api.get('/agents/runs').then(({ data }) => setHistory(data)).catch(() => {})
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">AI Agents</h1>
          <p className="text-gray-400 mt-1">Run autonomous agents that can search the web, write and execute code, and more.</p>
        </div>
        {sandboxStatus && (
          <div className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium flex-shrink-0',
            sandboxStatus.docker_available
              ? 'bg-green-900/20 border-green-800/50 text-green-400'
              : 'bg-yellow-900/20 border-yellow-800/50 text-yellow-500'
          )}>
            {sandboxStatus.docker_available
              ? <ShieldCheck className="w-3.5 h-3.5" />
              : <ShieldAlert className="w-3.5 h-3.5" />}
            {sandboxStatus.docker_available ? 'Docker sandbox' : 'No Docker (subprocess)'}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Config panel */}
        <div className="space-y-4">
          <div className="card">
            <h2 className="text-base font-semibold text-gray-100 mb-4">New Agent Run</h2>

            <div className="space-y-4">
              {/* Persona presets */}
              <div>
                <label className="label">Agent Persona</label>
                <div className="grid grid-cols-2 gap-2">
                  {PERSONAS.map((p) => {
                    const Icon = p.icon
                    return (
                      <button
                        key={p.id}
                        onClick={() => selectPersona(p)}
                        className={clsx(
                          'flex items-start gap-2.5 p-3 rounded-lg border text-left transition-all',
                          persona === p.id
                            ? 'border-primary-600 bg-primary-900/20 text-gray-100'
                            : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-600 hover:bg-gray-800'
                        )}
                      >
                        <Icon className={clsx('w-4 h-4 mt-0.5 flex-shrink-0', persona === p.id ? 'text-primary-400' : 'text-gray-500')} />
                        <div className="min-w-0">
                          <p className={clsx('text-xs font-semibold', persona === p.id ? 'text-primary-300' : 'text-gray-300')}>{p.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5 leading-tight">{p.description}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="label">Task</label>
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder={
                    persona === 'research' ? 'Find the latest research on transformer attention mechanisms...' :
                    persona === 'coder' ? 'Write a Python script that reads a CSV and outputs summary stats...' :
                    persona === 'analyst' ? 'Analyse the dataset at /tmp/data.csv and find key trends...' :
                    'Describe what you want the agent to do...'
                  }
                  rows={4}
                  className="input resize-none"
                />
              </div>

              <div>
                <label className="label">Model</label>
                <select value={model} onChange={(e) => setModel(e.target.value)} className="input">
                  {modelOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>

              {persona === 'custom' && (
                <>
                  <div>
                    <label className="label">Tools</label>
                    <div className="flex flex-wrap gap-2">
                      {AVAILABLE_TOOLS.map((t) => (
                        <button
                          key={t}
                          onClick={() => toggleTool(t)}
                          className={clsx(
                            'badge cursor-pointer transition-all',
                            selectedTools.includes(t)
                              ? 'bg-primary-900/60 text-primary-300 border border-primary-700'
                              : 'bg-gray-800 text-gray-500 border border-gray-700'
                          )}
                        >
                          {selectedTools.includes(t) && <Check className="w-3 h-3 mr-1" />}
                          {t.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="label">System Prompt (optional)</label>
                    <textarea
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      placeholder="You are a helpful assistant specialised in..."
                      rows={3}
                      className="input resize-none text-xs"
                    />
                  </div>
                </>
              )}

              {persona !== 'custom' && (
                <div className="flex flex-wrap gap-1.5">
                  {activePersona.tools.map((t) => (
                    <span key={t} className="badge bg-primary-900/30 text-primary-400 border border-primary-800/40 text-xs">
                      {t.replace('_', ' ')}
                    </span>
                  ))}
                </div>
              )}

              <div>
                <label className="label">Max Steps: {maxSteps}</label>
                <input type="range" min={3} max={20} value={maxSteps} onChange={(e) => setMaxSteps(+e.target.value)} className="w-full accent-primary-500" />
              </div>

              <details className="group">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400 select-none font-medium">
                  Sub-Agent Settings
                </summary>
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="label">Sub-Agent Model (default: llama3.2:3b)</label>
                    <select value={subagentModel} onChange={(e) => setSubagentModel(e.target.value)} className="input text-xs">
                      <option value="">Default (llama3.2:3b)</option>
                      {modelOptions.filter(m => m.value.includes('3b') || m.value.includes('1.5b') || m.value.includes('tiny')).map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Max Delegation Depth: {subagentMaxDepth}</label>
                    <input type="range" min={1} max={5} value={subagentMaxDepth} onChange={(e) => setSubagentMaxDepth(+e.target.value)} className="w-full accent-primary-500" />
                  </div>
                </div>
              </details>

              {mcpServers.length > 0 && (
                <div>
                  <label className="label flex items-center gap-1.5"><Server className="w-3.5 h-3.5" /> MCP Servers</label>
                  <div className="flex flex-wrap gap-2">
                    {mcpServers.map((s) => (
                      <button key={s.id} type="button"
                        onClick={() => setSelectedMcp((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                        className={clsx('badge cursor-pointer transition-all',
                          selectedMcp.includes(s.id) ? 'bg-green-900/60 text-green-300 border-green-700' : 'bg-gray-800 text-gray-500 border-gray-700'
                        )}>
                        {selectedMcp.includes(s.id) && <Check className="w-3 h-3 mr-1" />}
                        {s.name} ({s.tools_cache?.length ?? 0})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {genTools.length > 0 && (
                <div>
                  <label className="label flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5" /> AI Tools</label>
                  <div className="flex flex-wrap gap-2">
                    {genTools.map((t) => (
                      <button key={t.id} type="button" title={t.description}
                        onClick={() => setSelectedGenTools((prev) => prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id])}
                        className={clsx('badge cursor-pointer transition-all font-mono',
                          selectedGenTools.includes(t.id) ? 'bg-primary-900/60 text-primary-300 border border-primary-700' : 'bg-gray-800 text-gray-500 border border-gray-700'
                        )}>
                        {selectedGenTools.includes(t.id) && <Check className="w-3 h-3 mr-1" />}
                        {t.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={runAgent} disabled={running || !task.trim()} className="btn-primary w-full justify-center py-2.5">
                {running ? <><Loader2 className="w-4 h-4 animate-spin" /> Running...</> : <><Play className="w-4 h-4" /> Run Agent</>}
              </button>
            </div>
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-100 mb-3">Recent Runs</h2>
              <div className="space-y-2">
                {history.slice(0, 5).map((run) => (
                  <div key={run.id} onClick={() => setCurrentRun(run)}
                    className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-800 cursor-pointer transition-colors">
                    <div className={clsx('w-2 h-2 rounded-full flex-shrink-0',
                      run.status === 'completed' ? 'bg-green-500' :
                      run.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'
                    )} />
                    <p className="flex-1 text-sm text-gray-300 truncate">{run.task}</p>
                    <span className="text-xs text-gray-600 flex-shrink-0">
                      {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Live output */}
        <div className="card flex flex-col" style={{ minHeight: '500px' }}>
          <div className="flex items-center justify-between mb-4 gap-3">
            <h2 className="text-base font-semibold text-gray-100">Agent Output</h2>
            <div className="flex items-center gap-2">
              {currentRun && currentRun.steps.length > 0 && (
                <div className="flex rounded-lg border border-gray-700 overflow-hidden text-xs">
                  <button onClick={() => setFlowView(true)}
                    className={clsx('px-2.5 py-1 transition-colors', flowView ? 'bg-primary-900/50 text-primary-300' : 'text-gray-500 hover:text-gray-300')}>
                    Flow
                  </button>
                  <button onClick={() => setFlowView(false)}
                    className={clsx('px-2.5 py-1 transition-colors border-l border-gray-700', !flowView ? 'bg-primary-900/50 text-primary-300' : 'text-gray-500 hover:text-gray-300')}>
                    Steps
                  </button>
                </div>
              )}
              {currentRun && (
                <span className={clsx('badge', {
                  'bg-yellow-900/40 text-yellow-300': currentRun.status === 'running',
                  'bg-green-900/40 text-green-300': currentRun.status === 'completed',
                  'bg-red-900/40 text-red-300': currentRun.status === 'failed',
                })}>
                  {currentRun.status}
                </span>
              )}
            </div>
          </div>

          {!currentRun ? (
            <div className="flex-1 flex items-center justify-center text-gray-600 flex-col gap-2">
              <Bot className="w-10 h-10" />
              <p>Run an agent to see output here</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-3" ref={stepsRef}>
              <div className="text-sm text-gray-400 bg-gray-800/50 rounded-lg px-3 py-2">
                <span className="text-gray-500">Task: </span>{currentRun.task}
              </div>

              {flowView
                ? <AgentFlow
                    steps={currentRun.steps as FlowStep[]}
                    model={currentRun.model_name || model}
                    running={running}
                    error={currentRun.error}
                  />
                : <ThoughtDrawer steps={currentRun.steps} running={running} />}

              {currentRun.result && (
                <div className="border border-green-800 rounded-lg p-4 bg-green-900/10">
                  <p className="text-xs text-green-400 mb-2 font-medium">Final Result</p>
                  <p className="text-gray-200 text-sm whitespace-pre-wrap">{currentRun.result}</p>
                </div>
              )}

              {currentRun.error && (
                <div className="border border-red-800 rounded-lg p-4 bg-red-900/10">
                  <p className="text-xs text-red-400 mb-2 font-medium">Error</p>
                  <p className="text-gray-300 text-sm">{currentRun.error}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
