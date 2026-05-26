import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Send, Plus, Trash2, Bot, User, Loader2, ChevronDown, BookOpen,
  FileText, Sparkles, Sparkle, Zap, Scale, Brain, Settings2, Menu,
  X, Paperclip, Share2, BookMarked, Clipboard, ClipboardCheck,
  Mic, MicOff, Square, Download, RotateCcw, Search, Terminal,
  ChevronRight, Wrench,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import js from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import ts from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import py from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
SyntaxHighlighter.registerLanguage('javascript', js)
SyntaxHighlighter.registerLanguage('typescript', ts)
SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('jsx', jsx)
SyntaxHighlighter.registerLanguage('python', py)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('shell', bash)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('html', markup)
SyntaxHighlighter.registerLanguage('xml', markup)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('sql', sql)
import api, { baseURL } from '../lib/api'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'

interface Citation {
  index: number; chunk_id: number; document_id: number
  document_filename: string; score: number; snippet: string
}
interface RouteInfo { variant: string; chosen_model: string; reason: string }
interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  citations?: Citation[]
  route?: RouteInfo
  usage?: { prompt_tokens: number; completion_tokens: number }
  latency_ms?: number
  steps?: StepEvent[]
}
interface StepEvent { name: string; input: string; output: string; thought: string }
interface Template { id: number; name: string; content: string }
interface Attachment { type: 'image' | 'pdf' | 'text'; name: string; base64: string; preview?: string }
interface Session { id: number; title: string; model_name: string; updated_at: string }
interface KB { id: number; name: string; document_count: number; chunk_count: number }
interface CliSession { session_id: string; hostname: string; cwd: string; platform: string }
interface NebulaVariant {
  id: string; label: string; description: string; ready: boolean
  available_bases: string[]; missing_bases: string[]
}

const VARIANT_ICONS: Record<string, any> = {
  'nebulax:code':   Zap,
  'nebulax:chat':   Scale,
  'nebulax:write':  Brain,
  'nebulax:think':  Sparkles,
  'nebulax:custom': Settings2,
}

const CUSTOM_VARIANT_ID = 'nebulax:custom'

interface StreamEntry {
  content: string; citations: Citation[]; route: RouteInfo | undefined
  usage: { prompt_tokens: number; completion_tokens: number } | undefined
  latency_ms: number; done: boolean
  onComplete: Array<(c: string, ci: Citation[], r: RouteInfo | undefined, u: StreamEntry['usage'], l: number) => void>
}
const liveStreams = new Map<number, StreamEntry>()

// ── Code block with copy button ───────────────────────────────────────────
function CodeBlock({ language, children }: { language?: string; children: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="relative group/code my-3">
      <div className="flex items-center justify-between bg-gray-800 px-4 py-1.5 rounded-t-lg border border-gray-700/60 border-b-0">
        <span className="text-xs text-gray-500 font-mono">{language || 'code'}</span>
        <button onClick={copy} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
          {copied ? <><ClipboardCheck className="w-3.5 h-3.5 text-green-400" /><span className="text-green-400">Copied</span></>
                  : <><Clipboard className="w-3.5 h-3.5" />Copy</>}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark as any}
        language={language || 'text'}
        PreTag="div"
        customStyle={{ margin: 0, borderRadius: '0 0 0.5rem 0.5rem', border: '1px solid rgba(51,65,85,0.6)', borderTop: 'none' }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  )
}

// ── CLI Thought Drawer ────────────────────────────────────────────────────
function ChatThoughtDrawer({ steps, running }: { steps: StepEvent[]; running: boolean }) {
  const [open, setOpen] = useState(false)
  const prevRunning = useRef(false)

  useEffect(() => {
    if (running && !prevRunning.current) setOpen(true)
    if (!running && prevRunning.current && steps.length > 0) setOpen(false)
    prevRunning.current = running
  }, [running, steps.length])

  if (steps.length === 0 && !running) return null

  return (
    <div className="mb-2 rounded-lg border border-gray-700/60 bg-gray-950/50 overflow-hidden text-xs">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800/40 transition-colors"
      >
        <Terminal className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
        <span className="flex-1 text-left font-medium">
          {running ? 'Running…' : `${steps.length} terminal step${steps.length !== 1 ? 's' : ''}`}
        </span>
        {running && (
          <span className="flex gap-0.5">
            {[0, 0.15, 0.3].map((d, i) => (
              <span key={i} className="w-1 h-1 rounded-full bg-emerald-400 animate-bounce" style={{ animationDelay: `${d}s` }} />
            ))}
          </span>
        )}
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {open && steps.length > 0 && (
        <div className="border-t border-gray-700/60 divide-y divide-gray-800/60">
          {steps.map((s, i) => (
            <details key={i} className="group/step">
              <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-800/30 list-none">
                <Wrench className="w-3 h-3 text-emerald-500/70 flex-shrink-0" />
                <code className="text-emerald-400 font-mono">{s.name}</code>
                <span className="text-gray-600 truncate flex-1">{s.input.slice(0, 60)}{s.input.length > 60 ? '…' : ''}</span>
                <ChevronRight className="w-3 h-3 group-open/step:rotate-90 transition-transform flex-shrink-0" />
              </summary>
              <div className="px-3 pb-2 space-y-1">
                {s.thought && <p className="text-gray-500 italic">{s.thought}</p>}
                <pre className="bg-gray-900 rounded p-2 text-gray-300 overflow-x-auto whitespace-pre-wrap break-all font-mono">{s.output.slice(0, 800)}{s.output.length > 800 ? '\n…(truncated)' : ''}</pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Message bubble with copy/actions ────────────────────────────────────
function MessageBubble({
  msg, index, isLast, isActive, streamPhase, sending, onRegenerate, isCliActive,
}: {
  msg: Message; index: number; isLast: boolean
  isActive: boolean; streamPhase: string; sending: boolean
  onRegenerate: () => void; isCliActive: boolean
}) {
  const [copied, setCopied] = useState(false)
  const isThinking  = streamPhase === 'thinking' && isLast && msg.role === 'assistant'
  const isTyping    = streamPhase === 'typing'   && isLast && msg.role === 'assistant'
  const isFastStream = sending && isLast && msg.role === 'assistant'
  const streaming   = isThinking || isTyping || isFastStream

  const copyMsg = () => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className={clsx('flex gap-3 group fade-in', msg.role === 'user' ? 'flex-row-reverse' : '')}>
      {/* Avatar */}
      {msg.role === 'user' ? (
        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-primary-600 shadow">
          <User className="w-4 h-4 text-white" />
        </div>
      ) : (
        <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
          <Sparkle className={clsx('w-6 h-6 text-primary-500 fill-primary-500', isActive ? 'star-shine' : 'star-rest')} />
        </div>
      )}

      {/* Content */}
      {msg.role === 'assistant' ? (
        <div className="max-w-2xl flex-1">
          {(msg.steps && msg.steps.length > 0 || isCliActive) && (
            <ChatThoughtDrawer steps={msg.steps || []} running={isCliActive} />
          )}
          {isThinking ? (
            <div className="flex items-center gap-1.5 py-2">
              {[0, 0.2, 0.4].map((d, i) => (
                <span key={i} className="w-2 h-2 rounded-full bg-primary-500 typing-dot" style={{ animationDelay: `${d}s` }} />
              ))}
            </div>
          ) : (isTyping || isFastStream) ? (
            <p className="whitespace-pre-wrap leading-relaxed text-gray-200 text-sm">
              {msg.content}<span className="stream-cursor text-primary-500" />
            </p>
          ) : (
            <div className="prose prose-sm">
              <ReactMarkdown
                components={{
                  code({ className, children }) {
                    const lang = /language-(\w+)/.exec(className || '')?.[1]
                    const code = String(children).replace(/\n$/, '')
                    return lang
                      ? <CodeBlock language={lang}>{code}</CodeBlock>
                      : <code className={className}>{children}</code>
                  },
                }}
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          )}

          {/* Token badge */}
          {!streaming && msg.usage && (
            <div className="mt-1 flex items-center gap-2 text-xs text-gray-600">
              <span>{(msg.usage.prompt_tokens + msg.usage.completion_tokens).toLocaleString()} tokens</span>
              {msg.latency_ms ? <span>· {(msg.latency_ms / 1000).toFixed(1)}s</span> : null}
            </div>
          )}

          {/* Citations */}
          {!streaming && msg.citations && msg.citations.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-800 not-prose">
              <p className="text-xs text-gray-500 mb-2 flex items-center gap-1.5">
                <FileText className="w-3 h-3" />Sources
              </p>
              <div className="space-y-1.5">
                {msg.citations.map((c) => (
                  <details key={c.chunk_id} className="text-xs bg-gray-950/60 rounded-md border border-gray-800">
                    <summary className="cursor-pointer px-2.5 py-1.5 text-gray-400 hover:text-gray-200 flex items-center gap-2">
                      <span className="text-primary-400 font-mono">[{c.index}]</span>
                      <span className="truncate flex-1">{c.document_filename}</span>
                      <span className="text-gray-600">{c.score.toFixed(3)}</span>
                    </summary>
                    <p className="px-2.5 pb-2 text-gray-400 whitespace-pre-wrap leading-relaxed">
                      {c.snippet}{c.snippet.length >= 240 ? '…' : ''}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          )}

          {/* Action row */}
          {!streaming && msg.content && (
            <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={copyMsg} className="btn-ghost py-1 px-2 text-xs gap-1">
                {copied ? <ClipboardCheck className="w-3.5 h-3.5 text-green-400" /> : <Clipboard className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              {isLast && (
                <button onClick={onRegenerate} className="btn-ghost py-1 px-2 text-xs gap-1">
                  <RotateCcw className="w-3.5 h-3.5" />Regenerate
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="max-w-2xl">
          <div className="rounded-2xl px-4 py-3 text-sm bg-primary-600 text-white rounded-tr-none shadow">
            <p className="whitespace-pre-wrap">{msg.content}</p>
          </div>
          {/* Copy for user message */}
          {msg.content && (
            <div className="flex justify-end mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={copyMsg} className="btn-ghost py-1 px-2 text-xs gap-1">
                {copied ? <ClipboardCheck className="w-3.5 h-3.5 text-green-400" /> : <Clipboard className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState('nebulax:chat')
  const [sending, setSending] = useState(false)
  const [streamPhase, setStreamPhase] = useState<'idle' | 'thinking' | 'typing'>('idle')
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false)
  const [sessionSearch, setSessionSearch] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [kbs, setKbs] = useState<KB[]>([])
  const [kbId, setKbId] = useState<number | null>(null)
  const [variants, setVariants] = useState<NebulaVariant[]>([])
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [listening, setListening] = useState(false)
  const [cliSessions, setCliSessions] = useState<CliSession[]>([])
  const [activeCli, setActiveCli] = useState<string>('')

  const bottomRef    = useRef<HTMLDivElement>(null)
  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mountedRef   = useRef(true)
  const abortRef     = useRef<AbortController | null>(null)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      recognitionRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    if (!showTemplates) return
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-templates-panel]')) setShowTemplates(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showTemplates])

  useEffect(() => {
    loadSessions(); loadKbs(); loadVariants(); loadOllamaModels(); loadTemplates(); loadCliSessions()
  }, [])

  useEffect(() => {
    const id = setInterval(loadCliSessions, 8000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (variants.length > 0 && sessions.length === 0) {
      const first = variants.find((v) => v.ready)
      if (first) setModel(first.id)
    }
  }, [variants, sessions])

  const loadCliSessions = async () => {
    try { const { data } = await api.get('/cli/sessions'); setCliSessions(data || []) } catch {}
  }
  const loadVariants = async () => {
    try { const { data } = await api.get('/models/nebulax/variants'); setVariants(data.variants || []) } catch {}
  }
  const loadTemplates = async () => {
    try { const { data } = await api.get('/templates'); setTemplates(data) } catch {}
  }
  const loadOllamaModels = async () => {
    try { const { data } = await api.get('/models/ollama/list'); setOllamaModels((data.models || []).map((m: any) => m.name)) } catch {}
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => {
    const ta = textareaRef.current; if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [input])

  const loadSessions = async () => {
    try {
      const { data } = await api.get('/chat/sessions')
      setSessions(data)
      if (data.length > 0) {
        const first: Session = data[0]
        setActiveSession(first); setModel(first.model_name)
        const { data: msgs } = await api.get(`/chat/sessions/${first.id}/messages`)
        setMessages(msgs.map((m: any) => ({ role: m.role as Message['role'], content: m.content })))
      }
    } catch {}
  }
  const loadKbs = async () => {
    try { const { data } = await api.get('/knowledge'); setKbs(data) } catch {}
  }

  // ── Stop generation ───────────────────────────────────────────────────
  const stopGeneration = () => {
    abortRef.current?.abort()
    setSending(false)
    setStreamPhase('idle')
  }

  // ── Session management ────────────────────────────────────────────────
  const createSession = async () => {
    const { data } = await api.post('/chat/sessions', { model_name: model, title: 'New Chat', system_prompt: systemPrompt || null })
    setSessions((s) => [data, ...s]); setActiveSession(data); setMessages([])
    return data
  }

  const selectSession = async (session: Session) => {
    setSending(false); setStreamPhase('idle')
    setActiveSession(session); setModel(session.model_name)
    setAttachment(null); setSessionPanelOpen(false)
    const live = liveStreams.get(session.id)
    if (live) {
      if (live.done) {
        try { const { data } = await api.get(`/chat/sessions/${session.id}/messages`); setMessages(data.map((m: any) => ({ role: m.role as Message['role'], content: m.content }))) } catch {}
        liveStreams.delete(session.id)
      } else {
        try { const { data } = await api.get(`/chat/sessions/${session.id}/messages`); setMessages([...data.map((m: any) => ({ role: m.role as Message['role'], content: m.content })), { role: 'assistant' as const, content: live.content }]) } catch { setMessages([{ role: 'assistant' as const, content: live.content }]) }
        setSending(true); setStreamPhase(live.content ? 'typing' : 'thinking')
        live.onComplete.push((content, citations, route, usage, latency_ms) => {
          if (!mountedRef.current) return
          liveStreams.delete(session.id)
          setMessages(prev => { const u = [...prev]; const l = u[u.length - 1]; if (l?.role === 'assistant') u[u.length - 1] = { ...l, content, citations: citations.length ? citations : undefined, route, usage, latency_ms }; return u })
          setSending(false); setStreamPhase('idle')
        })
      }
      return
    }
    try { const { data } = await api.get(`/chat/sessions/${session.id}/messages`); setMessages(data.map((m: any) => ({ role: m.role, content: m.content }))) } catch {}
  }

  const deleteSession = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await api.delete(`/chat/sessions/${id}`)
    setSessions((s) => s.filter((x) => x.id !== id))
    if (activeSession?.id === id) { setActiveSession(null); setMessages([]) }
  }

  // ── Send / regenerate ────────────────────────────────────────────────
  const doStream = useCallback(async (userMessages: Message[], session: { id: number }, isFirst: boolean) => {
    const entry: StreamEntry = { content: '', citations: [], route: undefined, usage: undefined, latency_ms: 0, done: false, onComplete: [] }
    liveStreams.set(session.id, entry)

    abortRef.current = new AbortController()
    setSending(true)
    setStreamPhase('thinking')

    // rAF-batched flush — coalesces rapid token updates to one DOM write per frame
    let rafId: number | null = null
    const scheduleFlush = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (!mountedRef.current) return
        setMessages(m => {
          const u = [...m]; const l = u[u.length - 1]
          if (l?.role === 'assistant') u[u.length - 1] = { ...l, content: entry.content, citations: entry.citations.length ? entry.citations : undefined, route: entry.route, steps: l.steps }
          return u
        })
      })
    }

    let firstToken = true
    let errored = false

    try {
      const resp = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ model, messages: userMessages, session_id: session.id, system_prompt: systemPrompt || null, stream: true, knowledge_base_id: kbId, attachment_base64: attachment?.base64 || null, attachment_type: attachment?.type || null, attachment_name: attachment?.name || null, cli_session_id: activeCli || null }),
        signal: abortRef.current.signal,
      })

      const reader = resp.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sepIdx: number
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sepIdx); buffer = buffer.slice(sepIdx + 2)
          let event = 'message'; const dataLines: string[] = []
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
            else if (line.startsWith('data:')) dataLines.push(line.slice(5))
          }
          const data = dataLines.join('\n')
          if (event === 'route') { try { entry.route = JSON.parse(data) } catch {} }
          else if (event === 'citations') { try { entry.citations = JSON.parse(data) } catch {} }
          else if (event === 'usage') { try { const p = JSON.parse(data); entry.usage = { prompt_tokens: p.prompt_tokens || 0, completion_tokens: p.completion_tokens || 0 }; entry.latency_ms = p.latency_ms || 0 } catch {} }
          else if (event === 'step') {
            try {
              const step: StepEvent = JSON.parse(data)
              if (mountedRef.current) {
                setMessages(m => {
                  const u = [...m]; const l = u[u.length - 1]
                  if (l?.role === 'assistant') u[u.length - 1] = { ...l, steps: [...(l.steps || []), step] }
                  return u
                })
              }
            } catch {}
          }
          else if (data !== '[DONE]' && data) {
            if (firstToken) { firstToken = false; setStreamPhase('typing') }
            entry.content += data
            if (mountedRef.current) scheduleFlush()
          }
        }
      }
    } catch (e: any) {
      errored = true
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      if (e?.name !== 'AbortError') {
        toast.error('Failed to send message')
        if (mountedRef.current) setMessages((m) => m.slice(0, -1))
      }
      liveStreams.delete(session.id)
      entry.done = true
      if (mountedRef.current) { setSending(false); setStreamPhase('idle') }
      return
    } finally {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      entry.done = true
      entry.onComplete.forEach(fn => fn(entry.content, entry.citations, entry.route, entry.usage, entry.latency_ms))
      setTimeout(() => liveStreams.delete(session.id), 10_000)
      if (!errored && mountedRef.current) {
        // Final flush: include usage/latency now that stream is complete
        setMessages(m => {
          const u = [...m]; const l = u[u.length - 1]
          if (l?.role === 'assistant') u[u.length - 1] = { ...l, content: entry.content, citations: entry.citations.length ? entry.citations : undefined, route: entry.route, usage: entry.usage, latency_ms: entry.latency_ms, steps: l.steps }
          return u
        })
        setSending(false)
        setStreamPhase('idle')
      }
      setAttachment(null)
      if (!errored && isFirst && session) {
        api.post(`/chat/sessions/${session.id}/rename`).then(({ data }) => {
          const { title } = data; const sid = session.id
          setSessions((s) => s.map((x) => x.id === sid ? { ...x, title } : x))
          setActiveSession((a) => a?.id === sid ? ({ ...a, title } as Session) : a)
        }).catch(() => {})
      }
    }
  }, [model, systemPrompt, kbId, attachment, activeCli])

  const sendMessage = async () => {
    if (!input.trim() || streamPhase !== 'idle' || sending) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages([...newMessages, { role: 'assistant', content: '' }])
    setInput('')
    const isFirst = messages.length === 0
    const session = activeSession ?? await createSession()
    if (!session) return
    await doStream(newMessages, session, isFirst)
  }

  const regenerate = async () => {
    if (streamPhase !== 'idle' || sending || !activeSession) return
    // Find last user message index
    const lastUserIdx = [...messages].reverse().findIndex(m => m.role === 'user')
    if (lastUserIdx === -1) return
    const userMsgIdx = messages.length - 1 - lastUserIdx
    const history = messages.slice(0, userMsgIdx + 1)
    // Replace from that point: keep history up to & including last user msg, add empty assistant slot
    setMessages([...history, { role: 'assistant', content: '' }])
    await doStream(history, activeSession, false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = ''
    const reader = new FileReader()
    const type: Attachment['type'] = file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'text'
    reader.onload = () => setAttachment({ type, name: file.name, base64: reader.result as string, preview: type === 'image' ? reader.result as string : undefined })
    reader.readAsDataURL(file)
  }

  const shareSession = async () => {
    if (!activeSession) return
    try { const { data } = await api.post(`/chat/sessions/${activeSession.id}/share`); await navigator.clipboard.writeText(`${window.location.origin}/share/${data.token}`); toast.success('Share link copied!') }
    catch { toast.error('Failed to share') }
  }

  const exportConversation = () => {
    if (!messages.length) return
    const title = activeSession?.title || 'conversation'
    const md = messages
      .filter(m => m.role !== 'system')
      .map(m => `## ${m.role === 'user' ? 'You' : 'NebulaX AI'}\n\n${m.content}`)
      .join('\n\n---\n\n')
    const blob = new Blob([`# ${title}\n\n${md}`], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`; a.click()
  }

  // ── Voice input ───────────────────────────────────────────────────────
  const toggleVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { toast.error('Voice input not supported in this browser'); return }
    if (listening) {
      recognitionRef.current?.stop(); setListening(false); return
    }
    const rec = new SR()
    rec.continuous = false; rec.interimResults = true; rec.lang = 'en-US'
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join('')
      setInput(transcript)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => { setListening(false); toast.error('Voice recognition error') }
    rec.start(); recognitionRef.current = rec; setListening(true)
  }

  const applyTemplate = (t: Template) => { setSystemPrompt(t.content); setShowSystem(true); setShowTemplates(false); if (model !== CUSTOM_VARIANT_ID) setModel(CUSTOM_VARIANT_ID) }
  const saveTemplate = async () => {
    if (!newTemplateName.trim() || !systemPrompt.trim()) return
    try { const { data } = await api.post('/templates', { name: newTemplateName.trim(), content: systemPrompt }); setTemplates(t => [data, ...t]); setNewTemplateName(''); toast.success('Template saved!') } catch { toast.error('Failed to save') }
  }
  const deleteTemplate = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation(); await api.delete(`/templates/${id}`); setTemplates(t => t.filter(x => x.id !== id))
  }

  const activeKb = kbs.find((k) => k.id === kbId)
  const filteredSessions = sessions.filter(s => s.title.toLowerCase().includes(sessionSearch.toLowerCase()))
  const isStreaming = streamPhase !== 'idle' || sending

  return (
    <div className="flex h-full">
      {sessionPanelOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSessionPanelOpen(false)} />
      )}

      {/* Session sidebar */}
      <div className={clsx(
        'flex-shrink-0 w-64 border-r border-gray-800 bg-gray-900 flex flex-col',
        'fixed top-12 bottom-0 left-0 z-40 transition-transform duration-300',
        'lg:static lg:top-auto lg:bottom-auto lg:z-auto lg:translate-x-0 lg:transition-none',
        sessionPanelOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      )}>
        <div className="p-2.5 border-b border-gray-800 space-y-2">
          <div className="flex items-center gap-2">
            <button onClick={createSession} className="btn-primary flex-1 justify-center py-2 text-sm">
              <Plus className="w-4 h-4" /> New Chat
            </button>
            <button onClick={() => setSessionPanelOpen(false)} className="lg:hidden p-2 rounded-lg hover:bg-gray-800 text-gray-500">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* Session search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
            <input
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
              placeholder="Search chats…"
              className="w-full bg-gray-800 border border-gray-700/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-500/50"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredSessions.map((s) => (
            <div key={s.id} onClick={() => selectSession(s)}
              className={clsx('flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer group text-sm transition-colors',
                activeSession?.id === s.id ? 'bg-primary-900/40 text-primary-300' : 'hover:bg-gray-800 text-gray-400'
              )}>
              <Bot className="w-3.5 h-3.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm">{s.title}</p>
                <p className="text-xs text-gray-600 truncate">{s.model_name.replace('nebulax:', '')}</p>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                {activeSession?.id === s.id && (
                  <button onClick={e => { e.stopPropagation(); shareSession() }} className="hover:text-primary-400" title="Share"><Share2 className="w-3 h-3" /></button>
                )}
                <button onClick={(e) => deleteSession(s.id, e)} className="hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
          ))}
          {filteredSessions.length === 0 && sessionSearch && (
            <p className="text-xs text-gray-600 px-3 py-4 text-center">No chats match "{sessionSearch}"</p>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex-shrink-0 border-b border-gray-800 bg-gray-900">
          <div className="flex items-center gap-2 px-3 py-2">
            <button onClick={() => setSessionPanelOpen(true)} className="lg:hidden p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 flex-shrink-0"><Menu className="w-4 h-4" /></button>

            <select value={model} onChange={(e) => {
              const m = e.target.value; setModel(m)
              if (activeSession) {
                api.patch(`/chat/sessions/${activeSession.id}`, { model_name: m }).catch(() => {})
                setSessions(s => s.map(x => x.id === activeSession.id ? { ...x, model_name: m } : x))
                setActiveSession(a => a ? { ...a, model_name: m } : a)
              }
            }} className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500">
              {variants.length > 0 && <optgroup label="NebulaX (routed)">{variants.map((v) => <option key={v.id} value={v.id} disabled={!v.ready}>{v.label}{v.ready ? '' : ' (no base)'}</option>)}</optgroup>}
              {ollamaModels.length > 0 && <optgroup label="Ollama (direct)">{ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup>}
            </select>

            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary-900/20 text-primary-300 text-xs font-medium border border-primary-800/40 flex-shrink-0">
              <Sparkles className="w-3 h-3" />{variants.find((v) => v.id === model)?.label || model}
            </span>

            {/* Export */}
            {messages.length > 0 && (
              <button onClick={exportConversation} className="btn-ghost p-1.5 flex-shrink-0" title="Export as Markdown">
                <Download className="w-4 h-4" />
              </button>
            )}

            {/* Templates */}
            <div className="relative flex items-center gap-1 flex-shrink-0" data-templates-panel>
              <button onClick={() => setShowTemplates(!showTemplates)} className="btn-ghost text-xs gap-1 p-1.5" title="Prompt templates">
                <BookMarked className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Templates</span>
              </button>
              {model === CUSTOM_VARIANT_ID && (
                <button onClick={() => setShowSystem(!showSystem)} className="btn-ghost text-xs gap-1 p-1.5">
                  <ChevronDown className={clsx('w-3 h-3 transition-transform', showSystem && 'rotate-180')} />
                  <span className="hidden sm:inline">System</span>
                </button>
              )}
              {showTemplates && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Saved templates</p>
                  {templates.length === 0 && <p className="text-xs text-gray-600">No templates yet.</p>}
                  {templates.map((t) => (
                    <div key={t.id} onClick={() => applyTemplate(t)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-800 group">
                      <span className="flex-1 text-sm text-gray-300 truncate">{t.name}</span>
                      <button onClick={(e) => deleteTemplate(t.id, e)} className="opacity-0 group-hover:opacity-100 hover:text-red-400"><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  {systemPrompt.trim() && (
                    <div className="pt-2 border-t border-gray-800 flex gap-2">
                      <input value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)} placeholder="Template name…" className="input text-xs flex-1 py-1" onKeyDown={e => e.key === 'Enter' && saveTemplate()} />
                      <button onClick={saveTemplate} className="btn-primary text-xs px-2 py-1">Save</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {kbs.length > 0 && (
            <div className="flex items-center gap-2 px-3 pb-2">
              <BookOpen className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
              <select value={kbId ?? ''} onChange={e => setKbId(e.target.value ? parseInt(e.target.value) : null)}
                className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500">
                <option value="">No knowledge base</option>
                {kbs.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.chunk_count} chunks)</option>)}
              </select>
              {activeKb && <span className="badge bg-primary-900/30 text-primary-400 text-xs flex-shrink-0">RAG</span>}
            </div>
          )}

          <div className="flex items-center gap-2 px-3 pb-2">
            <Terminal className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
            <select value={activeCli} onChange={e => setActiveCli(e.target.value)}
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-500">
              <option value="">No terminal (chat only)</option>
              {cliSessions.map((s) => (
                <option key={s.session_id} value={s.session_id}>{s.hostname} — {s.cwd}</option>
              ))}
            </select>
            {activeCli && <span className="badge bg-emerald-900/30 text-emerald-400 text-xs flex-shrink-0">CLI</span>}
            {cliSessions.length === 0 && <span className="text-xs text-gray-600">Run <code className="font-mono">nebula daemon</code> to connect</span>}
          </div>
        </div>

        {model === CUSTOM_VARIANT_ID && showSystem && (
          <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/50">
            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="You are a helpful assistant that…" rows={2} className="input text-sm resize-none" />
            <p className="text-xs text-gray-500 mt-1">Custom variant lets you set the system prompt. Other variants enforce their own behaviour.</p>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
              <Bot className="w-12 h-12" />
              <p className="text-lg font-medium text-gray-500">Start a conversation</p>
              <p className="text-sm text-center max-w-sm">
                {activeKb ? `Grounded in "${activeKb.name}" — answers cite your documents.` : 'Pick a model and start chatting.'}
              </p>
              {variants.some(v => v.ready) && (
                <div className="flex flex-wrap gap-2 mt-2 justify-center">
                  {variants.filter(v => v.ready).map(v => {
                    const Icon = VARIANT_ICONS[v.id] || Sparkles
                    return (
                      <button key={v.id} onClick={() => setModel(v.id)}
                        className={clsx('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors',
                          model === v.id ? 'bg-primary-900/40 border-primary-700 text-primary-200' : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700')}>
                        <Icon className="w-3 h-3" />{v.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={i} msg={msg} index={i}
              isLast={i === messages.length - 1}
              isActive={(streamPhase !== 'idle' || sending) && i === messages.length - 1 && msg.role === 'assistant'}
              streamPhase={streamPhase} sending={sending}
              onRegenerate={regenerate}
              isCliActive={!!activeCli && (streamPhase !== 'idle' || sending) && i === messages.length - 1 && msg.role === 'assistant'}
            />
          ))}

          {isStreaming && (
            <div className="flex justify-center">
              <button onClick={stopGeneration} className="btn-secondary text-xs gap-1.5 py-1.5">
                <Square className="w-3 h-3 fill-current" />Stop generating
              </button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Attachment preview */}
        {attachment && (
          <div className="px-4 py-2 border-t border-gray-800 bg-gray-900/60 flex items-center gap-3">
            {attachment.preview ? <img src={attachment.preview} alt="attachment" className="w-10 h-10 object-cover rounded" /> : <FileText className="w-5 h-5 text-gray-500 flex-shrink-0" />}
            <span className="text-xs text-gray-400 flex-1 truncate">{attachment.name}</span>
            <button onClick={() => setAttachment(null)} className="text-gray-600 hover:text-gray-400"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Input bar */}
        <div className="px-4 py-3 border-t border-gray-800 bg-gray-900">
          <div className="flex items-end gap-2 max-w-4xl mx-auto">
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.md" className="hidden" onChange={handleFile} />
            <button onClick={() => fileInputRef.current?.click()} className="btn-ghost p-2 flex-shrink-0" title="Attach file or image">
              <Paperclip className="w-4 h-4" />
            </button>
            <button onClick={toggleVoice} className={clsx('btn-ghost p-2 flex-shrink-0 transition-colors', listening && 'text-red-400 bg-red-900/20')} title={listening ? 'Stop listening' : 'Voice input'}>
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <textarea
              ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={listening ? 'Listening…' : 'Message… (Enter to send, Shift+Enter for newline)'}
              rows={1} style={{ maxHeight: '200px' }} className="input flex-1 resize-none leading-relaxed"
            />
            {isStreaming ? (
              <button onClick={stopGeneration} className="btn-danger px-3 py-2.5 flex-shrink-0">
                <Square className="w-4 h-4 fill-current" />
              </button>
            ) : (
              <button onClick={sendMessage} disabled={!input.trim()} className="btn-primary px-3 py-2.5 flex-shrink-0">
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
