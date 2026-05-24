import { useState, useEffect, useRef } from 'react'
import { Bot, Play, ChevronDown, ChevronRight, Globe, Code2, FileText, Check, Loader2, Search, BarChart2, Sliders } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface Step {
  step: number
  thought?: string
  tool?: string
  input?: string
  output?: string
}

interface AgentRun {
  id: number
  task: string
  status: string
  steps: Step[]
  result?: string
  error?: string
  created_at: string
}

const TOOL_ICONS: Record<string, any> = {
  web_search: Globe,
  code_exec: Code2,
  read_file: FileText,
  write_file: FileText,
}

const AVAILABLE_TOOLS = ['web_search', 'code_exec', 'read_file', 'write_file']

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
    tools: ['code_exec', 'read_file', 'write_file'],
    systemPrompt: 'You are an expert software engineer. Write clean, efficient code. Always test your code by executing it. When writing files, prefer well-structured, readable code with clear variable names.',
  },
  {
    id: 'analyst',
    label: 'Data Analyst',
    description: 'Analyses data and produces insights',
    icon: BarChart2,
    tools: ['code_exec', 'read_file'],
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

function StepCard({ step }: { step: Step }) {
  const [open, setOpen] = useState(true)
  const Icon = step.tool ? TOOL_ICONS[step.tool] || Bot : Bot

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-800/50 hover:bg-gray-800 transition-colors text-left"
      >
        <div className={clsx('w-6 h-6 rounded flex items-center justify-center flex-shrink-0',
          step.tool === 'done' ? 'bg-green-900/60' : 'bg-primary-900/60'
        )}>
          <Icon className="w-3.5 h-3.5 text-primary-300" />
        </div>
        <span className="text-xs text-gray-400">Step {step.step}</span>
        <span className="text-sm font-medium text-gray-200 flex-1">
          {step.tool === 'done' ? 'Completed' : step.tool || 'Thinking...'}
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
      </button>
      {open && (
        <div className="p-4 space-y-3 text-sm">
          {step.thought && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Thought</p>
              <p className="text-gray-300 italic">{step.thought}</p>
            </div>
          )}
          {step.input && step.tool !== 'done' && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Input</p>
              <pre className="bg-gray-900 rounded p-2 text-gray-300 text-xs overflow-x-auto whitespace-pre-wrap">{step.input}</pre>
            </div>
          )}
          {step.output && (
            <div>
              <p className="text-xs text-gray-500 mb-1">Output</p>
              <pre className="bg-gray-900 rounded p-2 text-gray-300 text-xs overflow-x-auto whitespace-pre-wrap max-h-48">{step.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function AgentsPage() {
  const [task, setTask] = useState('')
  const [model, setModel] = useState('llama3.2:3b')
  const [persona, setPersona] = useState<string>('research')
  const [selectedTools, setSelectedTools] = useState(PERSONAS[0].tools)
  const [customPrompt, setCustomPrompt] = useState('')
  const [maxSteps, setMaxSteps] = useState(10)
  const [running, setRunning] = useState(false)
  const [currentRun, setCurrentRun] = useState<AgentRun | null>(null)
  const [history, setHistory] = useState<AgentRun[]>([])
  const [ollamaModels, setOllamaModels] = useState<string[]>(['llama3.2:3b'])
  const stepsRef = useRef<HTMLDivElement>(null)

  const activePersona = PERSONAS.find((p) => p.id === persona) ?? PERSONAS[0]

  const selectPersona = (p: Persona) => {
    setPersona(p.id)
    setSelectedTools(p.tools)
  }

  useEffect(() => {
    api.get('/agents/runs').then(({ data }) => setHistory(data)).catch(() => {})
    api.get('/models/ollama/list').then(({ data }) => {
      const names = data.models?.map((m: any) => m.name) || []
      if (names.length) { setOllamaModels(names); setModel(names[0]) }
    }).catch(() => {})
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
      const resp = await fetch('/api/v1/agents/run/stream', {
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">AI Agents</h1>
        <p className="text-gray-400 mt-1">Run autonomous agents that can search the web, write and execute code, and more.</p>
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
                  {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-100">Agent Output</h2>
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

              {currentRun.steps.map((step, i) => (
                <StepCard key={i} step={step} />
              ))}

              {running && (
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Thinking...
                </div>
              )}

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
