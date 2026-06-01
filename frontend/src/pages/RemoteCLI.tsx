import { useState, useEffect, useRef } from 'react'
import {
  Terminal, Play, Loader2, MonitorCheck, MonitorX,
  ChevronDown, ChevronRight, Globe, Code2, FileText, RefreshCw,
} from 'lucide-react'
import api, { baseURL } from '../lib/api'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import ReactMarkdown from 'react-markdown'

interface CliSession {
  session_id: string
  hostname: string
  cwd: string
  platform: string
  connected_at: string
}

interface StepEvent {
  name: string
  input: string
  output: string
  thought: string
}

interface RunState {
  status: 'idle' | 'running' | 'done' | 'error'
  steps: StepEvent[]
  result?: string
  error?: string
}

const TOOL_ICONS: Record<string, any> = {
  web_search: Globe,
  code_exec: Code2,
  bash_exec: Terminal,
  read_file: FileText,
  write_file: FileText,
  patch_file: FileText,
  search_files: Globe,
}

const TOOL_COLOR: Record<string, string> = {
  web_search:   'text-blue-400',
  code_exec:    'text-yellow-400',
  bash_exec:    'text-yellow-400',
  read_file:    'text-sky-400',
  write_file:   'text-green-400',
  patch_file:   'text-green-400',
  search_files: 'text-purple-400',
}

function StepRow({ step }: { step: StepEvent }) {
  const [open, setOpen] = useState(false)
  const Icon = TOOL_ICONS[step.name] || Terminal
  const color = TOOL_COLOR[step.name] || 'text-gray-400'

  return (
    <div className="border border-gray-700/50 rounded-lg overflow-hidden text-xs">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-800/40 hover:bg-gray-800/70 text-left transition-colors"
      >
        <Icon className={clsx('w-3.5 h-3.5 flex-shrink-0', color)} />
        <span className="text-gray-400 font-mono">{step.name}</span>
        {step.thought && (
          <span className="text-gray-600 truncate flex-1 italic">
            — {step.thought.slice(0, 80)}{step.thought.length > 80 ? '…' : ''}
          </span>
        )}
        {open
          ? <ChevronDown className="w-3 h-3 text-gray-600 flex-shrink-0" />
          : <ChevronRight className="w-3 h-3 text-gray-600 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-2 space-y-2 bg-gray-950/30">
          {step.input && (
            <div>
              <p className="text-gray-600 mb-0.5" style={{ fontSize: 10 }}>INPUT</p>
              <pre className="text-gray-300 bg-gray-900/60 rounded p-2 overflow-x-auto whitespace-pre-wrap">{step.input}</pre>
            </div>
          )}
          {step.output && (
            <div>
              <p className="text-gray-600 mb-0.5" style={{ fontSize: 10 }}>OUTPUT</p>
              <pre className="text-gray-300 bg-gray-900/60 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-48">{step.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const DEFAULT_TOOLS = ['web_search', 'code_exec', 'bash_exec', 'read_file', 'write_file', 'search_files']

export default function RemoteCLIPage() {
  const [sessions, setSessions] = useState<CliSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [selectedSession, setSelectedSession] = useState<string>('')
  const [task, setTask] = useState('')
  const [model, setModel] = useState('llama3:8B')
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [runState, setRunState] = useState<RunState>({ status: 'idle', steps: [] })
  const outputRef = useRef<HTMLDivElement>(null)

  const loadSessions = async () => {
    setLoadingSessions(true)
    try {
      const { data } = await api.get('/cli/sessions')
      setSessions(data)
      if (data.length > 0 && !selectedSession) setSelectedSession(data[0].session_id)
    } catch {
      setSessions([])
    } finally {
      setLoadingSessions(false)
    }
  }

  useEffect(() => {
    loadSessions()
    api.get('/models/ollama/list').then(({ data }) => {
      const names = (data.models || []).map((m: any) => m.name)
      if (names.length) setOllamaModels(names)
    }).catch(() => {})

    const interval = setInterval(loadSessions, 8000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' })
  }, [runState.steps, runState.result])

  const runTask = async () => {
    if (!task.trim() || runState.status === 'running') return
    if (sessions.length === 0) {
      toast.error('No CLI connected. Run `nebula daemon` on your machine.')
      return
    }

    setRunState({ status: 'running', steps: [] })

    try {
      const resp = await fetch(`${baseURL}/cli/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          task,
          model,
          session_id: selectedSession || undefined,
          tools: DEFAULT_TOOLS,
        }),
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }))
        setRunState({ status: 'error', steps: [], error: err.detail || 'Request failed' })
        return
      }

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let nl: number
        while ((nl = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 2)
          const dataLine = block.split('\n').find(l => l.startsWith('data: '))
          if (!dataLine) continue
          try {
            const msg = JSON.parse(dataLine.slice(6))
            if (msg.type === 'step') {
              setRunState(prev => ({
                ...prev,
                steps: [...prev.steps, {
                  name: msg.name,
                  input: msg.input,
                  output: msg.output,
                  thought: msg.thought || '',
                }],
              }))
            } else if (msg.type === 'done') {
              setRunState(prev => ({
                ...prev,
                status: 'done',
                result: msg.result,
              }))
            } else if (msg.type === 'error') {
              setRunState(prev => ({
                ...prev,
                status: 'error',
                error: msg.error,
              }))
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setRunState(prev => ({
        ...prev,
        status: 'error',
        error: e?.message || 'Network error',
      }))
    }
  }

  const activeSession = sessions.find(s => s.session_id === selectedSession)

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <Terminal className="w-6 h-6 text-primary-400" />
          Remote CLI
        </h1>
        <p className="text-gray-400 mt-1">
          Dispatch tasks to a <code className="text-primary-400 text-sm">nebula daemon</code> running on any connected machine.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: sessions + task form */}
        <div className="lg:col-span-2 space-y-4">

          {/* Connected sessions */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-100">Connected Machines</h2>
              <button onClick={loadSessions} className="btn-ghost p-1" title="Refresh">
                <RefreshCw className={clsx('w-3.5 h-3.5', loadingSessions && 'animate-spin')} />
              </button>
            </div>

            {sessions.length === 0 ? (
              <div className="text-center py-6 text-gray-600 space-y-2">
                <MonitorX className="w-8 h-8 mx-auto" />
                <p className="text-sm">No CLI connected</p>
                <p className="text-xs">
                  Run on your machine:<br />
                  <code className="text-primary-400">nebula daemon</code>
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map(s => (
                  <button
                    key={s.session_id}
                    onClick={() => setSelectedSession(s.session_id)}
                    className={clsx(
                      'w-full text-left px-3 py-2.5 rounded-lg border transition-colors',
                      selectedSession === s.session_id
                        ? 'border-primary-600 bg-primary-900/20'
                        : 'border-gray-700 bg-gray-800/40 hover:border-gray-600',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <MonitorCheck className="w-4 h-4 text-green-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-gray-200 truncate">{s.hostname}</span>
                      <span className="text-xs text-gray-600 ml-auto flex-shrink-0">{s.platform}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 truncate pl-6">{s.cwd}</p>
                    <p className="text-xs text-gray-700 pl-6 font-mono">#{s.session_id}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Task form */}
          <div className="card space-y-4">
            <h2 className="text-sm font-semibold text-gray-100">Send Task</h2>

            <div>
              <label className="label">Task</label>
              <textarea
                value={task}
                onChange={e => setTask(e.target.value)}
                placeholder="List all Python files and show me their line counts…"
                rows={5}
                className="input resize-none text-sm"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runTask() }}
              />
              <p className="text-xs text-gray-600 mt-1">Ctrl/Cmd + Enter to run</p>
            </div>

            <div>
              <label className="label">Model</label>
              <select value={model} onChange={e => setModel(e.target.value)} className="input text-sm">
                {ollamaModels.length > 0
                  ? ollamaModels.map(m => <option key={m} value={m}>{m}</option>)
                  : <option value={model}>{model}</option>}
              </select>
            </div>

            {activeSession && (
              <div className="text-xs text-gray-500 bg-gray-800/40 rounded-lg px-3 py-2">
                Target: <span className="text-gray-300">{activeSession.hostname}</span>
                {' '}·{' '}
                <span className="font-mono text-gray-500">{activeSession.cwd}</span>
              </div>
            )}

            <button
              onClick={runTask}
              disabled={!task.trim() || runState.status === 'running' || sessions.length === 0}
              className="btn-primary w-full justify-center py-2.5"
            >
              {runState.status === 'running'
                ? <><Loader2 className="w-4 h-4 animate-spin" />Running…</>
                : <><Play className="w-4 h-4" />Run on CLI</>}
            </button>
          </div>
        </div>

        {/* Right: live output */}
        <div className="lg:col-span-3 card flex flex-col" style={{ minHeight: 520 }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-100">Live Output</h2>
            {runState.status !== 'idle' && (
              <span className={clsx('badge text-xs', {
                'bg-yellow-900/40 text-yellow-300': runState.status === 'running',
                'bg-green-900/40 text-green-300':   runState.status === 'done',
                'bg-red-900/40 text-red-300':        runState.status === 'error',
              })}>
                {runState.status}
              </span>
            )}
          </div>

          {runState.status === 'idle' ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-600 gap-2">
              <Terminal className="w-10 h-10" />
              <p className="text-sm">Send a task to see live execution here</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2" ref={outputRef}>

              {/* Steps */}
              {runState.steps.length > 0 && (
                <div className="border border-gray-700/60 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-800/30 text-sm text-gray-400">
                    <Terminal className="w-4 h-4 text-primary-400" />
                    <span className="font-medium text-primary-300">
                      {runState.status === 'running'
                        ? <>Executing <span className="animate-pulse">…</span></>
                        : `Ran ${runState.steps.length} step${runState.steps.length !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                  <div className="p-2.5 space-y-1.5 bg-gray-950/20">
                    {runState.steps.map((step, i) => (
                      <StepRow key={i} step={step} />
                    ))}
                    {runState.status === 'running' && (
                      <div className="flex items-center gap-2 text-gray-500 text-xs px-2 py-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                        Working…
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Result */}
              {runState.result && (
                <div className="border border-green-800/50 rounded-xl bg-green-900/10 p-4">
                  <p className="text-xs text-green-400 mb-2 font-medium">Result</p>
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown>{runState.result}</ReactMarkdown>
                  </div>
                </div>
              )}

              {/* Error */}
              {runState.error && (
                <div className="border border-red-800/50 rounded-xl bg-red-900/10 p-4">
                  <p className="text-xs text-red-400 mb-1 font-medium">Error</p>
                  <p className="text-gray-300 text-sm">{runState.error}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
