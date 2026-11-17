import { useState } from 'react'
import { Code2, Folder, FileText, Terminal, Play, Loader2, RefreshCw } from 'lucide-react'
import { isTauri, native } from '../lib/tauri'
import toast from 'react-hot-toast'

interface Entry { name: string; path: string; is_dir: boolean; size: number }

export default function CodePage() {
  const [root, setRoot] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [selected, setSelected] = useState('')
  const [content, setContent] = useState('')
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [saving, setSaving] = useState(false)
  const [command, setCommand] = useState('')
  const [terminal, setTerminal] = useState('')
  const [running, setRunning] = useState(false)
  const [task, setTask] = useState('')
  const [agentOutput, setAgentOutput] = useState('')
  const [runningAgent, setRunningAgent] = useState(false)

  if (!isTauri()) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-100 mb-2">Code</h1>
        <p className="text-gray-400">The Code workspace uses the desktop app's local file system and shell. Open this page in the HexaLLM desktop app.</p>
      </div>
    )
  }

  const loadDir = async (path: string) => {
    setLoadingFiles(true)
    try {
      const data = await native.fs.list(path)
      setRoot(path)
      setEntries((data as Entry[]) || [])
      setTerminal('')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to list directory')
    } finally {
      setLoadingFiles(false)
    }
  }

  const openFile = async (path: string) => {
    try {
      const data = await native.fs.read(path)
      setSelected(path)
      setContent(String(data ?? ''))
    } catch (e: any) {
      toast.error(e?.message || 'Failed to read file')
    }
  }

  const saveFile = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await native.fs.write(selected, content)
      toast.success('Saved')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save file')
    } finally {
      setSaving(false)
    }
  }

  const runCommand = async () => {
    if (!command.trim()) return
    setTerminal('')
    setRunning(true)
    try {
      await native.shell.execStream(
        'bash',
        ['-c', command],
        (line) => setTerminal((t) => t + line + '\n'),
        (line) => setTerminal((t) => t + line + '\n'),
        (code) => setTerminal((t) => t + `\n[exit ${code}]\n`),
      )
    } catch (e: any) {
      toast.error(e?.message || 'Command failed')
    } finally {
      setRunning(false)
    }
  }

  const runAgent = async () => {
    if (!task.trim()) return
    setAgentOutput('')
    setRunningAgent(true)
    try {
      await native.shell.execStream(
        'python3',
        ['-m', 'hexa_cli', 'run', task],
        (line) => setAgentOutput((t) => t + line + '\n'),
        (line) => setAgentOutput((t) => t + line + '\n'),
        () => {},
      )
    } catch (e: any) {
      toast.error(e?.message || 'Agent failed')
    } finally {
      setRunningAgent(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <Code2 className="w-6 h-6 text-primary-400" /> Code Workspace
        </h1>
        <p className="text-gray-400 mt-1">Browse, edit, run commands, and invoke the HexaLLM coding agent on this machine.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="card space-y-3">
          <div className="flex gap-2">
            <input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="/path/to/project" className="input flex-1 text-sm" />
            <button onClick={() => loadDir(root || '.')} disabled={loadingFiles} className="btn-secondary px-3 py-2 text-xs">
              {loadingFiles ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto space-y-0.5">
            {entries.map((e) => (
              <button key={e.path} onClick={() => e.is_dir ? loadDir(e.path) : openFile(e.path)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-gray-800 text-gray-300">
                {e.is_dir ? <Folder className="w-3.5 h-3.5 text-primary-400" /> : <FileText className="w-3.5 h-3.5 text-gray-500" />}
                <span className="truncate">{e.name}</span>
              </button>
            ))}
            {entries.length === 0 && <p className="text-xs text-gray-600 px-2 py-3">No files loaded.</p>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-200 truncate">{selected || 'No file selected'}</p>
              <button onClick={saveFile} disabled={!selected || saving} className="btn-primary px-3 py-1.5 text-xs">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
              </button>
            </div>
            <textarea value={content} onChange={(e) => setContent(e.target.value)}
              className="input min-h-[260px] font-mono text-sm resize-y" placeholder="Select a file to edit…" />
          </div>

          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-100">Terminal</h2>
            <div className="flex gap-2">
              <input value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runCommand()}
                placeholder="git status, npm test, python script.py…" className="input flex-1 text-sm font-mono" />
              <button onClick={runCommand} disabled={running || !command.trim()} className="btn-secondary px-3 py-2 text-xs">
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Run'}
              </button>
            </div>
            {terminal && (
              <pre className="max-h-64 overflow-auto rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs text-gray-300 whitespace-pre-wrap font-mono">
                {terminal}
              </pre>
            )}
          </div>

          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-100">Coding Agent</h2>
            <textarea value={task} onChange={(e) => setTask(e.target.value)}
              placeholder="Refactor this module, add tests, fix the failing build…" rows={3}
              className="input resize-none text-sm" />
            <button onClick={runAgent} disabled={runningAgent || !task.trim()} className="btn-primary px-3 py-2 text-xs">
              {runningAgent ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Run Agent'}
            </button>
            {agentOutput && (
              <pre className="max-h-80 overflow-auto rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs text-gray-300 whitespace-pre-wrap font-mono">
                {agentOutput}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
