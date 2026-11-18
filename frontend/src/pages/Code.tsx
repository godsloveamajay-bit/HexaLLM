import { useState } from 'react'
import { Code2, Folder, FileText, Terminal, Play, Loader2, RefreshCw } from 'lucide-react'
import { isTauri, native, pet } from '../lib/tauri'
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
  const [computerTask, setComputerTask] = useState('')
  const [computerLog, setComputerLog] = useState('')
  const [runningComputer, setRunningComputer] = useState(false)
  const [inputText, setInputText] = useState('')
  const [inputKey, setInputKey] = useState('enter')
  const [mouseX, setMouseX] = useState(100)
  const [mouseY, setMouseY] = useState(100)
  const [scrollDelta, setScrollDelta] = useState(3)
  const [devices, setDevices] = useState('')
  const [loadingDevices, setLoadingDevices] = useState(false)


  const runInputText = async () => {
    if (!inputText.trim()) return
    try { await native.input.typeText(inputText); toast.success('Typed text') } catch (e: any) { toast.error(e?.message || 'Type failed') }
  }
  const runInputKey = async () => {
    try { await native.input.key(inputKey); toast.success(`Pressed ${inputKey}`) } catch (e: any) { toast.error(e?.message || 'Key failed') }
  }
  const runMouseMove = async () => {
    try { await native.input.move(mouseX, mouseY); toast.success('Moved mouse') } catch (e: any) { toast.error(e?.message || 'Move failed') }
  }
  const runMouseClick = async (button: string) => {
    try { await native.input.click(button); toast.success(`${button} click`) } catch (e: any) { toast.error(e?.message || 'Click failed') }
  }
  const runMouseScroll = async () => {
    try { await native.input.scroll(scrollDelta); toast.success('Scrolled') } catch (e: any) { toast.error(e?.message || 'Scroll failed') }
  }
  const loadDevices = async () => {
    setLoadingDevices(true)
    try { setDevices(String(await native.input.devices())) } catch (e: any) { toast.error(e?.message || 'Failed to list devices') }
    finally { setLoadingDevices(false) }
  }


  const extractJson = (raw: string) => {
    const text = raw.trim()
    try { return JSON.parse(text) } catch {}
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    try { return JSON.parse(m[0]) } catch { return null }
  }

  const runComputerTool = async (tool: string, input: any): Promise<string> => {
    const arg = typeof input === 'string' ? input : JSON.stringify(input ?? '')
    switch (tool) {
      case 'type_text': await native.input.typeText(arg); return 'typed'
      case 'press_key': await native.input.key(arg); return `pressed ${arg}`
      case 'move_mouse': {
        const [x, y] = arg.split(',').map((n) => Number(n.trim()))
        await native.input.move(x || 0, y || 0)
        return `moved to ${x}, ${y}`
      }
      case 'click': await native.input.click(arg || 'left'); return `${arg || 'left'} click`
      case 'scroll': await native.input.scroll(Number(arg) || 0); return `scrolled ${arg}`
      case 'run_command': {
        const out = await native.shell.exec('bash', ['-c', arg])
        return String(out || '')
      }
      case 'read_file': return String(await native.fs.read(arg))
      case 'write_file': {
        const data = typeof input === 'string' ? JSON.parse(input) : input
        await native.fs.write(String(data.path), String(data.content ?? ''))
        return `wrote ${data.path}`
      }
      case 'list_files': return JSON.stringify(await native.fs.list(arg || '.'))
      case 'devices': return String(await native.input.devices())
      default: return `Unknown tool: ${tool}`
    }
  }

  const runComputerAgent = async () => {
    if (!computerTask.trim()) return
    setRunningComputer(true)
    setComputerLog('')
    const log = (line: string) => setComputerLog((t) => t + line + '\n')
    const model = 'qwen2.5:7b'
    const system = `You are a computer-use agent. Use tools to complete the task. Reply ONLY with JSON: {"thought":"...", "tool":"tool_name", "input":"..."} or {"thought":"...", "tool":"done", "input":"final answer"}. Tools: type_text, press_key, move_mouse, click, scroll, run_command, read_file, write_file, list_files, devices.`
    const messages: { role: string; content: string }[] = [{ role: 'user', content: computerTask }]
    try {
      for (let step = 0; step < 6; step++) {
        log(`Step ${step + 1}: thinking…`)
        const res = await fetch('http://localhost:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, stream: false, options: { temperature: 0.2 } }),
        })
        const data = await res.json()
        const raw = data?.message?.content || ''
        const obj = extractJson(raw)
        if (!obj) { log(raw); break }
        log(`Thought: ${obj.thought || ''}`)
        if (obj.tool === 'done') { log(`Result: ${obj.input || ''}`); break }
        const output = await runComputerTool(String(obj.tool || ''), obj.input)
        log(`Tool ${obj.tool}: ${String(output).slice(0, 500)}`)
        messages.push({ role: 'assistant', content: raw })
        messages.push({ role: 'user', content: `Tool result: ${String(output).slice(0, 2000)}` })
      }
    } catch (e: any) {
      log(`Error: ${e?.message || e}`)
    } finally {
      setRunningComputer(false)
    }
  }

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
    if (isTauri()) pet.status('working', 'Running agent…')
    try {
      await native.shell.execStream(
        'python3',
        ['-m', 'hexa_cli', 'run', task],
        (line) => setAgentOutput((t) => t + line + '\n'),
        (line) => setAgentOutput((t) => t + line + '\n'),
        () => {},
      )
      if (isTauri()) pet.status('done', 'Agent finished')
    } catch (e: any) {
      if (isTauri()) pet.status('needs_input', e?.message || 'Agent failed')
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
            <h2 className="text-sm font-semibold text-gray-100">Computer Control</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Text to type" className="input text-sm" />
              <button onClick={runInputText} className="btn-secondary px-3 py-2 text-xs">Type Text</button>
              <select value={inputKey} onChange={(e) => setInputKey(e.target.value)} className="input text-sm">
                {['enter','tab','escape','backspace','up','down','left','right','space','a'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <button onClick={runInputKey} className="btn-secondary px-3 py-2 text-xs">Press Key</button>
              <input type="number" value={mouseX} onChange={(e) => setMouseX(Number(e.target.value))} className="input text-sm" placeholder="X" />
              <input type="number" value={mouseY} onChange={(e) => setMouseY(Number(e.target.value))} className="input text-sm" placeholder="Y" />
              <button onClick={runMouseMove} className="btn-secondary px-3 py-2 text-xs">Move Mouse</button>
              <div className="flex gap-2">
                <button onClick={() => runMouseClick('left')} className="btn-secondary px-3 py-2 text-xs flex-1">Left Click</button>
                <button onClick={() => runMouseClick('right')} className="btn-secondary px-3 py-2 text-xs flex-1">Right Click</button>
              </div>
              <input type="number" value={scrollDelta} onChange={(e) => setScrollDelta(Number(e.target.value))} className="input text-sm" placeholder="Scroll delta" />
              <button onClick={runMouseScroll} className="btn-secondary px-3 py-2 text-xs">Scroll</button>
            </div>
            <button onClick={loadDevices} disabled={loadingDevices} className="btn-secondary px-3 py-2 text-xs w-full">
              {loadingDevices ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'List Connected Devices'}
            </button>
            {devices && <pre className="max-h-48 overflow-auto rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs text-gray-300 whitespace-pre-wrap font-mono">{devices.slice(0, 8000)}</pre>}
          </div>


          <div className="card space-y-3">
            <h2 className="text-sm font-semibold text-gray-100">Computer Agent</h2>
            <p className="text-xs text-gray-500">Runs a local agent that can type, click, scroll, run commands, and edit files on this machine.</p>
            <textarea value={computerTask} onChange={(e) => setComputerTask(e.target.value)}
              placeholder="Open the browser and search for Rust Tauri docs…" rows={3}
              className="input resize-none text-sm" />
            <button onClick={runComputerAgent} disabled={runningComputer || !computerTask.trim()} className="btn-primary px-3 py-2 text-xs">
              {runningComputer ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Run Computer Agent'}
            </button>
            {computerLog && (
              <pre className="max-h-80 overflow-auto rounded-lg border border-gray-800 bg-gray-950 p-3 text-xs text-gray-300 whitespace-pre-wrap font-mono">
                {computerLog}
              </pre>
            )}
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
