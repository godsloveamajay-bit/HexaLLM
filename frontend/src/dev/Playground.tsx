import { useEffect, useRef, useState } from 'react'
import { Play, Square, Copy, Check, Trash2, Terminal, Save, FolderOpen } from 'lucide-react'
import Markdown from '../components/ui/Markdown'
import { api, baseURL } from '../lib/api'
import { useDevStore, type Workspace, type WorkspaceItem } from './devStore'
import { fetchWorkspaces, saveItem, fetchItems, createWorkspace } from './workspacesApi'

type Variant = { id: string; label?: string; description?: string; ready?: boolean }
type RawModel = { name: string; size?: number; details?: { quantization_level?: string; family?: string } }

type Stats = {
  prompt_tokens: number
  completion_tokens: number
  latency_ms: number
}

const LABEL_STYLE = {
  fontFamily: 'monospace',
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: '#8b949e',
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format: (v: number) => string
}) {
  return (
    <div>
      <div className="flex justify-between font-mono text-xs mb-1">
        <span style={{ color: '#8b949e' }}>{label}</span>
        <span style={{ color: '#4ade80' }}>{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[#4ade80]"
      />
    </div>
  )
}

function Input({
  value,
  onChange,
  placeholder,
  mono = true,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={mono ? 4 : 3}
      className={`w-full resize-y rounded border px-3 py-2 outline-none focus:border-[#4ade80] transition-colors text-[13px] leading-relaxed ${
        mono ? 'font-mono' : ''
      }`}
      style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
    />
  )
}

export default function Playground() {
  const [variants, setVariants] = useState<Variant[]>([])
  const [rawModels, setRawModels] = useState<RawModel[]>([])
  const [model, setModel] = useState('')
  const [system, setSystem] = useState('')
  const [prompt, setPrompt] = useState('')
  const [temperature, setTemperature] = useState(0.7)
  const [topP, setTopP] = useState(0.9)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [stream, setStream] = useState(true)

  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)
  const [phase, setPhase] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const outputRef = useRef<HTMLDivElement | null>(null)

  const { activeWorkspaceId, setActiveWorkspace, pendingPreset, loadPreset } = useDevStore()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [presets, setPresets] = useState<WorkspaceItem[]>([])

  useEffect(() => {
    api.get('/models/hexallm/variants').then(({ data }) => {
      const list: Variant[] = Array.isArray(data) ? data : data?.variants ?? []
      setVariants(list)
      if (!model && list.length) setModel(list[0].id)
    }).catch(() => {})
    api.get('/models/ollama').then(({ data }) => {
      setRawModels(data?.models ?? [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    fetchWorkspaces().then((list) => {
      setWorkspaces(list)
      if (!activeWorkspaceId && list.length) setActiveWorkspace(list[0].id)
    }).catch(() => {})
  }, [activeWorkspaceId, setActiveWorkspace])

  useEffect(() => {
    if (activeWorkspaceId !== null) {
      fetchItems(activeWorkspaceId, 'playground').then(setPresets).catch(() => {})
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    if (pendingPreset) {
      const p = pendingPreset.payload as Record<string, unknown>
      if (typeof p.model === 'string') setModel(p.model)
      if (typeof p.system === 'string') setSystem(p.system)
      if (typeof p.prompt === 'string') setPrompt(p.prompt)
      if (typeof p.temperature === 'number') setTemperature(p.temperature)
      if (typeof p.topP === 'number') setTopP(p.topP)
      if (typeof p.maxTokens === 'number') setMaxTokens(p.maxTokens)
      if (typeof p.stream === 'boolean') setStream(p.stream)
      loadPreset(null)
    }
  }, [pendingPreset, loadPreset])

  const savePreset = async () => {
    let wsId = activeWorkspaceId
    if (wsId === null) {
      const ws = await createWorkspace('default', 'auto-created by playground')
      setWorkspaces((prev) => [...prev, ws])
      setActiveWorkspace(ws.id)
      wsId = ws.id
    }
    if (!wsId || !model) return
    const name = `preset · ${model} · ${new Date().toLocaleTimeString()}`
    await saveItem(wsId, 'playground', name, { model, system, prompt, temperature, topP, maxTokens, stream })
    setPresets(await fetchItems(wsId, 'playground'))
    setSavedFlash(name)
    setTimeout(() => setSavedFlash(null), 2000)
  }

  const ollamaOptions = { top_p: topP }

  const buildBody = () => {
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream,
      temperature,
      max_tokens: maxTokens,
      ollama_options: ollamaOptions,
    }
    if (system.trim()) body.system_prompt = system.trim()
    return body
  }

  const curl = () => {
    const token = localStorage.getItem('token')
    const auth = token ? `  -H "Authorization: Bearer ${token}" \\\n` : ''
    return `curl -N "${window.location.origin}/api/v1/chat/completions" \\\n${auth}  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(buildBody())}'`
  }

  const copyCurl = async () => {
    await navigator.clipboard.writeText(curl())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const stop = () => abortRef.current?.abort()

  const run = async () => {
    if (!model || !prompt.trim() || running) return
    setRunning(true)
    setOutput('')
    setStats(null)
    setError(null)
    setPhase('connecting')

    const abort = new AbortController()
    abortRef.current = abort
    const startedAt = performance.now()

    try {
      const token = localStorage.getItem('token')
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const resp = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildBody()),
        signal: abort.signal,
      })
      if (!resp.ok) {
        let detail = `HTTP ${resp.status}`
        try { detail = (await resp.json()).detail || detail } catch {}
        setError(detail)
        setRunning(false)
        return
      }

      if (!stream) {
        const data = await resp.json()
        setOutput(data.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2))
        setStats({
          prompt_tokens: data.usage?.prompt_tokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? 0,
          latency_ms: data.usage?.latency_ms ?? Math.round(performance.now() - startedAt),
        })
        setPhase(null)
        setRunning(false)
        return
      }

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let firstToken = true
      let content = ''
      let usage: Stats | null = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sepIdx: number
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sepIdx)
          buffer = buffer.slice(sepIdx + 2)
          let event = 'message'
          const dataLines: string[] = []
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
            else if (line.startsWith('data:')) dataLines.push(line.slice(5))
          }
          const data = dataLines.join('\n')
          if (event === 'usage') {
            try {
              const p = JSON.parse(data)
              usage = {
                prompt_tokens: p.prompt_tokens || 0,
                completion_tokens: p.completion_tokens || 0,
                latency_ms: p.latency_ms || 0,
              }
            } catch {}
          } else if (event === 'warming') {
            setPhase('warming — loading model into VRAM…')
          } else if (event === 'reasoning') {
            setPhase('reasoning…')
          } else if (event === 'searching') {
            setPhase('searching the web…')
          } else if (event === 'reading') {
            setPhase('reading sources…')
          } else if (data !== '[DONE]' && data) {
            if (firstToken) {
              firstToken = false
              setPhase('streaming')
            }
            content += data
            setOutput(content)
          }
        }
      }
      setStats(usage ?? { prompt_tokens: 0, completion_tokens: 0, latency_ms: Math.round(performance.now() - startedAt) })
      setPhase(null)
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message || 'request failed')
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [output])

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Terminal size={18} style={{ color: '#4ade80' }} />
        <div className="mr-auto">
          <h1 className="font-mono font-bold text-lg" style={{ color: '#e6edf3' }}>
            model playground
          </h1>
          <p className="font-mono text-xs" style={{ color: '#8b949e' }}>
            fire raw requests at any model — params, streaming, timings, curl
          </p>
        </div>

        <div className="flex items-center gap-1.5 font-mono text-xs">
          <select
            value={activeWorkspaceId ?? ''}
            onChange={(e) => setActiveWorkspace(e.target.value ? Number(e.target.value) : null)}
            className="font-mono text-xs px-2 py-1.5 rounded border outline-none focus:border-[#4ade80]"
            style={{ background: '#0d1117', borderColor: '#30363d', color: '#8b949e' }}
            title="active workspace"
          >
            <option value="">no workspace</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <select
            value=""
            onChange={(e) => {
              const item = presets.find((p) => p.id === Number(e.target.value))
              if (item) loadPreset(item)
            }}
            className="font-mono text-xs px-2 py-1.5 rounded border outline-none focus:border-[#4ade80] max-w-[180px]"
            style={{ background: '#0d1117', borderColor: '#30363d', color: '#8b949e' }}
            title="load a saved preset"
          >
            <option value="">load preset…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={savePreset}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded border transition-colors hover:bg-[#0d1117]"
            style={{ borderColor: savedFlash ? 'rgba(74,222,128,0.6)' : '#30363d', color: savedFlash ? '#4ade80' : '#8b949e' }}
            title="save current config to the active workspace"
          >
            <Save size={13} /> {savedFlash ? 'saved' : 'save'}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Request pane ── */}
        <div className="rounded-lg border overflow-hidden flex flex-col" style={{ borderColor: '#30363d', background: '#161b22' }}>
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: '#30363d' }}>
            <span className="font-mono text-xs font-semibold" style={{ color: '#e6edf3' }}>request</span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ color: '#8b949e', background: '#0d1117' }}>
              POST /api/v1/chat/completions
            </span>
          </div>
          <div className="p-3 space-y-3">
            <div>
              <div style={LABEL_STYLE} className="mb-1">model</div>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full font-mono text-[13px] px-2.5 py-2 rounded border outline-none focus:border-[#4ade80]"
                style={{ background: '#0d1117', borderColor: '#30363d', color: '#e6edf3' }}
              >
                {variants.length > 0 && (
                  <optgroup label="hexa virtual models">
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>{v.label || v.id}{!v.ready ? ' (warming)' : ''}</option>
                    ))}
                  </optgroup>
                )}
                {rawModels.length > 0 && (
                  <optgroup label="raw ollama models">
                    {rawModels.map((m) => (
                      <option key={m.name} value={m.name}>{m.name}{m.details?.quantization_level ? ` (${m.details.quantization_level})` : ''}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            <div>
              <div style={LABEL_STYLE} className="mb-1">system prompt</div>
              <Input value={system} onChange={setSystem} placeholder="optional — set the model's behaviour" />
            </div>

            <div>
              <div style={LABEL_STYLE} className="mb-1">prompt</div>
              <Input value={prompt} onChange={setPrompt} placeholder="> ask the model something…" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Slider label="temperature" value={temperature} min={0} max={2} step={0.05} onChange={setTemperature} format={(v) => v.toFixed(2)} />
              <Slider label="top_p" value={topP} min={0.01} max={1} step={0.01} onChange={setTopP} format={(v) => v.toFixed(2)} />
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex justify-between font-mono text-xs mb-1">
                  <span style={{ color: '#8b949e' }}>max tokens</span>
                  <span style={{ color: '#4ade80' }}>{maxTokens}</span>
                </div>
                <input
                  type="range"
                  min={64}
                  max={32768}
                  step={64}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                  className="w-full accent-[#4ade80]"
                />
              </div>
              <label className="flex items-center gap-2 font-mono text-xs cursor-pointer select-none" style={{ color: '#8b949e' }}>
                <input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)} className="accent-[#4ade80]" />
                stream
              </label>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={run}
                disabled={running || !model || !prompt.trim()}
                className="flex items-center gap-2 font-mono text-sm px-4 py-2 rounded font-semibold disabled:opacity-40 transition-colors"
                style={{ background: '#4ade80', color: '#0d1117' }}
              >
                {running ? <Square size={14} /> : <Play size={14} />}
                {running ? 'stop' : 'run'}
              </button>
              <button
                onClick={copyCurl}
                className="flex items-center gap-2 font-mono text-xs px-3 py-2 rounded border transition-colors hover:bg-[#0d1117]"
                style={{ borderColor: '#30363d', color: '#8b949e' }}
              >
                {copied ? <Check size={13} style={{ color: '#4ade80' }} /> : <Copy size={13} />}
                {copied ? 'copied' : 'copy curl'}
              </button>
              <button
                onClick={() => { setPrompt(''); setOutput(''); setStats(null); setError(null) }}
                className="flex items-center gap-2 font-mono text-xs px-3 py-2 rounded border transition-colors hover:bg-[#0d1117]"
                style={{ borderColor: '#30363d', color: '#8b949e' }}
              >
                <Trash2 size={13} /> clear
              </button>
            </div>
          </div>
        </div>

        {/* ── Output pane ── */}
        <div className="rounded-lg border overflow-hidden flex flex-col min-h-[420px]" style={{ borderColor: '#30363d', background: '#161b22' }}>
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: '#30363d' }}>
            <span className="font-mono text-xs font-semibold" style={{ color: '#e6edf3' }}>response</span>
            <div className="flex items-center gap-2 font-mono text-[10px]">
              {phase && <span style={{ color: '#fbbf24' }}>{phase}</span>}
              {stats && (
                <span style={{ color: '#8b949e' }}>
                  {stats.prompt_tokens}→{stats.completion_tokens} tok · {stats.latency_ms} ms
                  {stats.completion_tokens > 0 && ` · ${((stats.completion_tokens / Math.max(stats.latency_ms, 1)) * 1000).toFixed(1)} tok/s`}
                </span>
              )}
            </div>
          </div>
          <div ref={outputRef} className="flex-1 overflow-y-auto p-4" style={{ background: '#0d1117' }}>
            {error ? (
              <div className="font-mono text-sm whitespace-pre-wrap" style={{ color: '#f87171' }}>
                ✗ {error}
              </div>
            ) : output ? (
              <div className="prose prose-invert prose-sm max-w-none" style={{ color: '#e6edf3' }}>
                <Markdown streaming={running}>{output}</Markdown>
              </div>
            ) : (
              <div className="font-mono text-sm flex flex-col items-center justify-center h-full gap-1" style={{ color: '#6e7681' }}>
                <Terminal size={20} />
                <span>output appears here</span>
                <span className="text-xs">hit run — streaming toggles SSE vs full JSON</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border overflow-hidden" style={{ borderColor: '#30363d', background: '#161b22' }}>
        <div className="px-3 py-2 border-b" style={{ borderColor: '#30363d' }}>
          <span className="font-mono text-xs font-semibold" style={{ color: '#e6edf3' }}>generated curl</span>
        </div>
        <pre className="font-mono text-xs p-3 overflow-x-auto" style={{ color: '#4ade80', background: '#010409' }}>
          {curl()}
        </pre>
      </div>
    </div>
  )
}
