import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Send, Plus, Trash2, Bot, User, Loader2, ChevronDown, BookOpen,
  FileText, Sparkles, Zap, Scale, Brain, Settings2, Menu,
  X, Paperclip, Share2, BookMarked, Clipboard, ClipboardCheck,
  Mic, MicOff, Square, Download, RotateCcw, Search, Terminal,
  ChevronRight, Wrench, Lock, Sparkle, SlidersHorizontal, Globe,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../store/auth'
import PersonalitySliders from '../components/PersonalitySliders'
import { normalizeTraits, isActive as personalityActive, type TraitKey } from '../lib/personality'
import AiSparkle from '../components/AiSparkle'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
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
  index: number; chunk_id: number | string; document_id?: number
  document_filename: string; score?: number; snippet: string; url?: string
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
interface ContentMatch { id: number; title: string; model_name: string; updated_at: string; match_count: number; snippet: string; role: string | null }
interface KB { id: number; name: string; document_count: number; chunk_count: number }
interface CliSession { session_id: string; hostname: string; cwd: string; platform: string }
interface NebulaVariant {
  id: string; label: string; description: string; ready: boolean
  available_bases: string[]; missing_bases: string[]
}

const VARIANT_ICONS: Record<string, any> = {
  'nebulax:balanced': Scale,
  'nebulax:code':     Zap,
  'nebulax:chat':     Brain,
  'nebulax:write':    Sparkles,
  'nebulax:think':    Brain,
  'nebulax:custom':   Settings2,
}

const CUSTOM_VARIANT_ID = 'nebulax:custom'
// Guests have no server-side session; this local-only id keeps the streaming
// plumbing (liveStreams map) working while the backend persists nothing.
const GUEST_SESSION_ID = -1
// Typewriter smoothing: the visible text drains its backlog toward the received
// text over roughly this window, so bursty/slow tokens read as a steady flow.
const STREAM_SMOOTH_MS = 350

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
function ChatThoughtDrawer({ steps, reasoning, running }: { steps: StepEvent[]; reasoning?: string; running: boolean }) {
  const [open, setOpen] = useState(false)
  const prevRunning = useRef(false)
  const hasReasoning = !!(reasoning && reasoning.trim())

  useEffect(() => {
    // Open whenever a run is active (not only on the false→true edge) so the
    // reasoning drawer reliably expands on every message, even if the component
    // instance is reused across turns. Auto-collapse when the run ends.
    if (running) setOpen(true)
    else if (prevRunning.current) setOpen(false)
    prevRunning.current = running
  }, [running])

  if (steps.length === 0 && !hasReasoning && !running) return null

  return (
    <div className="mb-2 rounded-lg border border-gray-700/60 bg-gray-950/50 overflow-hidden text-xs">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-gray-400 hover:text-gray-200 hover:bg-gray-800/40 transition-colors"
      >
        <Brain className="w-3.5 h-3.5 text-secondary-400 flex-shrink-0" />
        <span className="flex-1 text-left font-medium text-secondary-300">
          {running ? 'Agent Thinking…' : 'Agent Thinking'}
        </span>
        {running && (
          <span className="flex gap-0.5">
            {[0, 0.15, 0.3].map((d, i) => (
              <span key={i} className="w-1 h-1 rounded-full bg-secondary-400 animate-bounce" style={{ animationDelay: `${d}s` }} />
            ))}
          </span>
        )}
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {open && (hasReasoning || steps.length > 0) && (
        <div className="border-t border-gray-700/60 divide-y divide-gray-800/60">
          {hasReasoning && (
            <div className="px-3 py-2 text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">
              {reasoning!.trim()}
            </div>
          )}
          {steps.map((s, i) => (
            <details key={i} className="group/step">
              <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-800/30 list-none">
                <Wrench className="w-3 h-3 text-secondary-500/80 flex-shrink-0" />
                <code className="text-secondary-400 font-mono">{s.name}</code>
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

// Split deepseek-r1 <think>…</think> reasoning out of the visible answer.
// Handles a still-streaming, unclosed <think> (everything after it is reasoning).
function splitThink(content: string): { think: string; clean: string; thinking: boolean } {
  let think = ''
  const closed = /<think>([\s\S]*?)<\/think>/gi
  let m: RegExpExecArray | null
  while ((m = closed.exec(content))) think += (think ? '\n' : '') + m[1].trim()
  let clean = content.replace(closed, '')
  let thinking = false
  const openIdx = clean.lastIndexOf('<think>')
  if (openIdx !== -1) {
    think += (think ? '\n' : '') + clean.slice(openIdx + '<think>'.length).trim()
    clean = clean.slice(0, openIdx)
    thinking = true
  }
  return { think: think.trim(), clean: clean.trim(), thinking }
}

// Playful status verbs cycled next to the avatar while the model works.
const THINK_VERBS = [
  'Thinking', 'Pondering', 'Reasoning', 'Cooking', 'Noodling', 'Mulling it over',
  'Connecting the dots', 'Synthesizing', 'Considering', 'Crunching', 'Brainstorming',
  'Untangling', 'Percolating', 'Working it out', 'Deliberating',
]

// Animated dots + a status label. `label` (e.g. "Searching the web") pins the
// text; otherwise it gently rotates through playful verbs. When `since` (a start
// timestamp in ms) is given, a live mm:ss counter is appended — on this CPU box
// web answers take a while to "read" the sources, so showing elapsed time makes
// it obvious the model is working, not frozen.
function ThinkingIndicator({ label, since }: { label?: string; since?: number }) {
  const [verb, setVerb] = useState(() => THINK_VERBS[Math.floor(Math.random() * THINK_VERBS.length)])
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (label) return
    const id = setInterval(() => {
      setVerb((v) => {
        let n = v
        while (n === v) n = THINK_VERBS[Math.floor(Math.random() * THINK_VERBS.length)]
        return n
      })
    }, 2200)
    return () => clearInterval(id)
  }, [label])
  useEffect(() => {
    if (!since) { setElapsed(0); return }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - since) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [since])
  const mmss = since && elapsed >= 1
    ? ` ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
    : ''
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="flex items-center gap-1.5">
        {[0, 0.2, 0.4].map((d, i) => (
          <span key={i} className="w-2 h-2 rounded-full bg-primary-500 typing-dot" style={{ animationDelay: `${d}s` }} />
        ))}
      </div>
      <span className="text-sm text-gray-500 fade-in">{label || verb}…{mmss && <span className="text-gray-600 tabular-nums">{mmss}</span>}</span>
    </div>
  )
}

// ── Message bubble with copy/actions ────────────────────────────────────
function MessageBubble({
  msg, index, isLast, isActive, streamPhase, warmingModel, sending, onRegenerate, isCliActive, activity, activitySince,
}: {
  msg: Message; index: number; isLast: boolean
  isActive: boolean; streamPhase: string; warmingModel?: string; sending: boolean
  onRegenerate: () => void; isCliActive: boolean; activity?: string | null; activitySince?: number | null
}) {
  const [copied, setCopied] = useState(false)
  const isWarming   = streamPhase === 'warming'  && isLast && msg.role === 'assistant'
  const isThinking  = streamPhase === 'thinking' && isLast && msg.role === 'assistant'
  const isTyping    = streamPhase === 'typing'   && isLast && msg.role === 'assistant'
  // During the cold-load warm-up there are no tokens yet, so suppress the
  // generic "sending" typing indicator and show the warming notice instead.
  const isFastStream = sending && !isWarming && isLast && msg.role === 'assistant'
  const streaming   = isWarming || isThinking || isTyping || isFastStream
  // Fold deepseek-r1 <think> reasoning into the Agent Thinking drawer; show only
  // the clean answer in the message body.
  const { think, clean, thinking: thinkOpen } = splitThink(msg.content)
  const reasoningStreaming = (isTyping || isFastStream) && thinkOpen

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
          <AiSparkle size={26} active={isActive} />
        </div>
      )}

      {/* Content */}
      {msg.role === 'assistant' ? (
        <div className="max-w-2xl flex-1">
          {((msg.steps && msg.steps.length > 0) || isCliActive || !!think) && (
            <ChatThoughtDrawer steps={msg.steps || []} reasoning={think} running={isCliActive || reasoningStreaming} />
          )}
          {isWarming ? (
            <div className="flex items-center gap-2 py-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-gray-600 border-t-energy-400 rounded-full animate-spin" />
              <span className="text-sm text-energy-300/90">
                Warming up{warmingModel ? ` ${warmingModel}` : ' the model'}… the first response after idle can take up to a minute.
              </span>
            </div>
          ) : (isThinking || ((isTyping || isFastStream) && !clean.trim())) ? (
            // Show the thinking indicator until the model produces visible answer
            // text. Reasoning models stream <think>… first (no clean text yet), which
            // used to flip the body to an empty cursor — so this also keeps a status
            // label showing on every turn, and reflects web search when active.
            <ThinkingIndicator
              label={activity === 'searching' ? 'Searching the web' : activity === 'reading' ? 'Reading sources' : undefined}
              since={activitySince ?? undefined}
            />
          ) : (isTyping || isFastStream) ? (
            <p className="whitespace-pre-wrap leading-relaxed text-gray-200 text-sm">
              {clean}<span className="stream-cursor text-primary-500" />
            </p>
          ) : (
            <div className="prose prose-sm">
              <ReactMarkdown
                // Allow base64 data: image/video URLs (generated media streams in
                // as data URLs); keep default sanitization for everything else.
                urlTransform={(url) =>
                  url.startsWith('data:image/') || url.startsWith('data:video/')
                    ? url
                    : defaultUrlTransform(url)
                }
                components={{
                  code({ className, children }) {
                    const lang = /language-(\w+)/.exec(className || '')?.[1]
                    const code = String(children).replace(/\n$/, '')
                    return lang
                      ? <CodeBlock language={lang}>{code}</CodeBlock>
                      : <code className={className}>{children}</code>
                  },
                  img({ src, alt }) {
                    // Generated videos arrive via image markdown with a video data
                    // URL — render them as a real <video> player instead of <img>.
                    if (typeof src === 'string' && src.startsWith('data:video/')) {
                      return (
                        <video
                          src={src}
                          controls
                          loop
                          playsInline
                          className="rounded-lg border border-gray-700/60 max-w-full my-2"
                          style={{ maxHeight: '512px' }}
                        />
                      )
                    }
                    return (
                      <img
                        src={src}
                        alt={alt || ''}
                        loading="lazy"
                        className="rounded-lg border border-gray-700/60 max-w-full my-2"
                        style={{ maxHeight: '512px' }}
                      />
                    )
                  },
                }}
              >
                {clean}
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
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          className="truncate flex-1 text-primary-300 hover:underline">{c.document_filename}</a>
                      ) : (
                        <span className="truncate flex-1">{c.document_filename}</span>
                      )}
                      {typeof c.score === 'number'
                        ? <span className="text-gray-600">{c.score.toFixed(3)}</span>
                        : <Globe className="w-3 h-3 text-gray-600 flex-shrink-0" />}
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
  const { user } = useAuth()
  const isGuest = !user
  // Free trial: how many guest messages remain today (from the backend), and
  // whether the daily cap has been hit (locks the composer behind a sign-up CTA).
  const [guestRemaining, setGuestRemaining] = useState<number | null>(null)
  const [guestBlocked, setGuestBlocked] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState(user?.ai_default_model || 'nebulax:balanced')
  const [sending, setSending] = useState(false)
  const [streamPhase, setStreamPhase] = useState<'idle' | 'thinking' | 'warming' | 'typing'>('idle')
  const [showJump, setShowJump] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [streamActivity, setStreamActivity] = useState<string | null>(null)
  const [activitySince, setActivitySince] = useState<number | null>(null)
  const [warmingModel, setWarmingModel] = useState<string>('')
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false)
  const [sessionSearch, setSessionSearch] = useState('')
  const [contentResults, setContentResults] = useState<ContentMatch[] | null>(null)
  const [searching, setSearching] = useState(false)
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
  const [personas, setPersonas] = useState<any[]>([])
  const [showPersonas, setShowPersonas] = useState(false)
  // Per-message temperature override (applied when a persona is selected).
  const [temperature, setTemperature] = useState<number | null>(typeof user?.ai_temperature === 'number' ? user.ai_temperature : null)
  // Personality Engine — sliders shaping the model's voice + sampling.
  const [personality, setPersonality] = useState<Record<TraitKey, number>>(normalizeTraits(user?.ai_personality))
  const [showPersonality, setShowPersonality] = useState(false)
  const [savingPersonality, setSavingPersonality] = useState(false)
  const [listening, setListening] = useState(false)     // mic is recording
  const [transcribing, setTranscribing] = useState(false) // uploading → Whisper
  const [cliSessions, setCliSessions] = useState<CliSession[]>([])
  const [activeCli, setActiveCli] = useState<string>('')

  const bottomRef    = useRef<HTMLDivElement>(null)
  const scrollRef    = useRef<HTMLDivElement>(null)
  const atBottomRef  = useRef(true)
  const textareaRef  = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mountedRef   = useRef(true)
  const abortRef     = useRef<AbortController | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef   = useRef<MediaStream | null>(null)
  const audioChunksRef   = useRef<Blob[]>([])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      try { mediaRecorderRef.current?.stop() } catch {}
      mediaStreamRef.current?.getTracks().forEach(t => t.stop())
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
    // Model lists are public; everything else is account-bound, so guests skip it.
    loadVariants(); loadOllamaModels()
    if (!isGuest) {
      loadSessions(); loadKbs(); loadTemplates(); loadPersonas(); loadCliSessions()
    }
  }, [isGuest])

  useEffect(() => {
    if (isGuest) return
    const id = setInterval(loadCliSessions, 8000)
    return () => clearInterval(id)
  }, [isGuest])

  useEffect(() => {
    if (variants.length > 0 && sessions.length === 0) {
      // Prefer the user's configured default model when it's available,
      // otherwise fall back to the first ready variant.
      const pref = user?.ai_default_model
      const prefReady = pref && variants.some((v) => v.id === pref && v.ready)
      const first = variants.find((v) => v.ready)
      if (prefReady) setModel(pref!)
      else if (first) setModel(first.id)
    }
  }, [variants, sessions, user])

  const loadCliSessions = async () => {
    try { const { data } = await api.get('/cli/sessions'); setCliSessions(data || []) } catch {}
  }
  const loadVariants = async () => {
    try { const { data } = await api.get('/models/nebulax/variants'); setVariants(data.variants || []) } catch {}
  }
  const loadPersonas = async () => {
    try { const { data } = await api.get('/personas'); setPersonas(data || []) } catch {}
  }
  const loadTemplates = async () => {
    try { const { data } = await api.get('/templates'); setTemplates(data) } catch {}
  }
  const loadOllamaModels = async () => {
    try { const { data } = await api.get('/models/ollama/list'); setOllamaModels((data.models || []).map((m: any) => m.name)) } catch {}
  }

  // Auto-scroll to the newest message ONLY when the user is already near the
  // bottom. Otherwise streaming tokens (which update `messages` constantly) kept
  // yanking the view down while they tried to read earlier replies.
  useEffect(() => { if (atBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const onMessagesScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    atBottomRef.current = near
    setShowJump(!near)
  }
  const jumpToLatest = () => {
    atBottomRef.current = true
    setShowJump(false)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Esc stops an in-progress generation from anywhere in the chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (streamPhase !== 'idle' || sending)) { abortRef.current?.abort() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [streamPhase, sending])

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
        setMessages(msgs.map((m: any) => ({ role: m.role as Message['role'], content: m.content, steps: m.steps || undefined })))
      }
    } catch {}
  }
  const loadKbs = async () => {
    try {
      const { data } = await api.get('/knowledge'); setKbs(data)
      // Apply the user's default knowledge base if it still exists and the user
      // hasn't already picked one this session.
      const def = user?.ai_default_kb_id
      if (def && data.some((k: KB) => k.id === def)) setKbId(prev => prev ?? def)
    } catch {}
  }

  // ── Stop generation ───────────────────────────────────────────────────
  const stopGeneration = () => {
    abortRef.current?.abort()
    setSending(false)
    setStreamPhase('idle')
  }

  // ── Session management ────────────────────────────────────────────────
  // NB: does NOT clear the message list — sendMessage calls this *after* adding
  // the user's message, so wiping here would drop the first message of a new
  // chat (the bug where the send appeared to do nothing and the picker stayed).
  const createSession = async () => {
    const { data } = await api.post('/chat/sessions', { model_name: model, title: 'New Chat', system_prompt: systemPrompt || null })
    setSessions((s) => [data, ...s]); setActiveSession(data)
    return data
  }

  // Explicit "New Chat" button — start a fresh empty session.
  const newChat = async () => {
    setMessages([])
    setInput('')
    await createSession()
  }

  const selectSession = async (session: Session) => {
    setSending(false); setStreamPhase('idle')
    setActiveSession(session); setModel(session.model_name)
    setAttachment(null); setSessionPanelOpen(false)
    const live = liveStreams.get(session.id)
    if (live) {
      if (live.done) {
        try { const { data } = await api.get(`/chat/sessions/${session.id}/messages`); setMessages(data.map((m: any) => ({ role: m.role as Message['role'], content: m.content, steps: m.steps || undefined }))) } catch {}
        liveStreams.delete(session.id)
      } else {
        try { const { data } = await api.get(`/chat/sessions/${session.id}/messages`); setMessages([...data.map((m: any) => ({ role: m.role as Message['role'], content: m.content, steps: m.steps || undefined })), { role: 'assistant' as const, content: live.content }]) } catch { setMessages([{ role: 'assistant' as const, content: live.content }]) }
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
    try { const { data } = await api.get(`/chat/sessions/${session.id}/messages`); setMessages(data.map((m: any) => ({ role: m.role, content: m.content, steps: m.steps || undefined }))) } catch {}
  }

  const deleteSession = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await api.delete(`/chat/sessions/${id}`)
    setSessions((s) => s.filter((x) => x.id !== id))
    if (activeSession?.id === id) { setActiveSession(null); setMessages([]) }
  }

  // ── Send / regenerate ────────────────────────────────────────────────
  const doStream = useCallback(async (userMessages: Message[], session: { id: number }, isFirst: boolean, opts: { regenerate?: boolean } = {}) => {
    const entry: StreamEntry = { content: '', citations: [], route: undefined, usage: undefined, latency_ms: 0, done: false, onComplete: [] }
    liveStreams.set(session.id, entry)

    abortRef.current = new AbortController()
    setSending(true)
    setStreamPhase('thinking')

    // Typewriter smoothing buffer: tokens arrive in bursts (and slowly, on CPU),
    // so rather than repainting whole tokens we animate the *visible* length
    // toward the received length at an adaptive cadence — a burst speeds up to
    // catch up, a trickle flows char-by-char. Decouples render from net jitter.
    let rafId: number | null = null
    let displayed = 0      // chars currently shown
    let carry = 0          // fractional-char accumulator between frames
    let lastTs = 0
    let finalized = false

    const setLast = (patch: Partial<Message>) => {
      if (!mountedRef.current) return
      setMessages(m => {
        const u = [...m]; const l = u[u.length - 1]
        if (l?.role === 'assistant') u[u.length - 1] = { ...l, ...patch }
        return u
      })
    }
    const renderDisplayed = () => {
      if (!mountedRef.current) return
      setMessages(m => {
        const u = [...m]; const l = u[u.length - 1]
        if (l?.role === 'assistant') {
          // Never move backwards: if something already showed more (e.g. a session
          // resume rendered the full buffer), catch up instead of shrinking.
          if (l.content.length > displayed) displayed = Math.min(entry.content.length, l.content.length)
          u[u.length - 1] = { ...l, content: entry.content.slice(0, displayed), citations: entry.citations.length ? entry.citations : undefined, route: entry.route }
        }
        return u
      })
    }
    const finalize = () => {
      if (finalized) return
      finalized = true
      if (!mountedRef.current) return
      setLast({ content: entry.content, citations: entry.citations.length ? entry.citations : undefined, route: entry.route, usage: entry.usage, latency_ms: entry.latency_ms })
      setSending(false); setStreamPhase('idle'); setWarmingModel(''); setStreamActivity(null); setActivitySince(null)
    }
    const pump = (ts: number) => {
      if (!lastTs) lastTs = ts
      const dt = Math.min(ts - lastTs, 100); lastTs = ts   // clamp gaps (hidden tab)
      const target = entry.content.length
      let backlog = target - displayed
      if (backlog > 0) {
        // Drain the current backlog over ~STREAM_SMOOTH_MS; once the stream is
        // done finish quickly so the tail doesn't dribble out.
        let cps = backlog / (STREAM_SMOOTH_MS / 1000)
        if (entry.done) cps = Math.max(cps, backlog / 0.1, 120)
        carry += cps * dt / 1000
        const step = Math.floor(carry)
        if (step > 0) {
          carry -= step
          displayed = Math.min(target, displayed + step)
          renderDisplayed()
          backlog = target - displayed
        }
      }
      if (entry.done && displayed >= target) { rafId = null; finalize(); return }
      if (!entry.done && backlog <= 0) { rafId = null; return }   // idle until next token
      rafId = requestAnimationFrame(pump)
    }
    const ensurePump = () => {
      if (rafId === null && !finalized) { lastTs = 0; rafId = requestAnimationFrame(pump) }
    }

    let firstToken = true
    let errored = false

    try {
      const token = localStorage.getItem('token')
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      const resp = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: userMessages, session_id: session.id > 0 ? session.id : null, system_prompt: systemPrompt || null, stream: true, ...(temperature != null ? { temperature } : {}), ...(personalityActive(personality) ? { personality } : {}), ...(opts.regenerate ? { regenerate: true } : {}), ...(webSearch ? { web_search: true } : {}), knowledge_base_id: kbId, attachment_base64: attachment?.base64 || null, attachment_type: attachment?.type || null, attachment_name: attachment?.name || null, cli_session_id: activeCli || null }),
        signal: abortRef.current.signal,
      })

      // Guest daily cap reached (or other rejection) — surface a sign-up CTA
      // instead of trying to read a stream that isn't there.
      if (!resp.ok) {
        let detail = 'Failed to send message'
        try { detail = (await resp.json()).detail || detail } catch {}
        if (resp.status === 429 && isGuest) { setGuestBlocked(true); setGuestRemaining(0) }
        toast.error(detail)
        errored = true
        liveStreams.delete(session.id)
        entry.done = true
        if (mountedRef.current) { setMessages(m => m.slice(0, -1)); setSending(false); setStreamPhase('idle'); setStreamActivity(null); setActivitySince(null) }
        return
      }

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
          else if (event === 'guest') { try { const g = JSON.parse(data); setGuestRemaining(typeof g.remaining === 'number' ? g.remaining : null) } catch {} }
          else if (event === 'citations') { try { entry.citations = JSON.parse(data) } catch {} }
          else if (event === 'usage') { try { const p = JSON.parse(data); entry.usage = { prompt_tokens: p.prompt_tokens || 0, completion_tokens: p.completion_tokens || 0 }; entry.latency_ms = p.latency_ms || 0 } catch {} }
          else if (event === 'warming') {
            // Model isn't resident yet (cold start) — first token may take a while.
            try { const w = JSON.parse(data); setWarmingModel(w.model || '') } catch {}
            setStreamPhase('warming')
          }
          else if (event === 'searching') {
            // Web search in progress — drives the "Searching the web" status label.
            // Start the elapsed timer so the (slow) wait reads as working, not hung.
            if (mountedRef.current) { setStreamActivity('searching'); setActivitySince(Date.now()) }
          }
          else if (event === 'reading') {
            // Sources fetched; model is now prefilling them (the slow part on CPU).
            if (mountedRef.current) setStreamActivity('reading')
          }
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
            if (firstToken) { firstToken = false; setStreamPhase('typing'); setStreamActivity(null); setActivitySince(null) }
            entry.content += data
            if (mountedRef.current) ensurePump()
          }
        }
      }
    } catch (e: any) {
      errored = true
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      if (e?.name !== 'AbortError') {
        toast.error('Failed to send message')
        if (mountedRef.current) setMessages((m) => m.slice(0, -1))
      } else if (mountedRef.current) {
        // User hit stop — reveal everything received so far (skip smoothing).
        setMessages(m => { const u = [...m]; const l = u[u.length - 1]; if (l?.role === 'assistant') u[u.length - 1] = { ...l, content: entry.content, citations: entry.citations.length ? entry.citations : undefined, route: entry.route }; return u })
      }
      liveStreams.delete(session.id)
      entry.done = true
      if (mountedRef.current) { setSending(false); setStreamPhase('idle'); setStreamActivity(null); setActivitySince(null) }
      return
    } finally {
      entry.done = true
      entry.onComplete.forEach(fn => fn(entry.content, entry.citations, entry.route, entry.usage, entry.latency_ms))
      setTimeout(() => liveStreams.delete(session.id), 10_000)
      if (!errored) {
        // Let the smoothing buffer finish revealing the tail, then finalize
        // (applies usage/latency + flips back to idle). ensurePump also covers
        // the zero-token case where the pump never started.
        ensurePump()
      }
      setAttachment(null)
      if (!errored && isFirst && session && session.id > 0) {
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
    if (isGuest && guestBlocked) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages([...newMessages, { role: 'assistant', content: '' }])
    setInput('')
    const isFirst = messages.length === 0
    let session: { id: number } | null
    try {
      session = isGuest ? { id: GUEST_SESSION_ID } : (activeSession ?? await createSession())
    } catch {
      // Session couldn't be created — undo the optimistic user/assistant bubbles
      // so the composer isn't left in a half-sent state.
      toast.error('Could not start the chat. Please try again.')
      if (mountedRef.current) { setMessages(messages); setInput(userMsg.content) }
      return
    }
    if (!session) return
    await doStream(newMessages, session, isFirst)
  }

  const regenerate = async () => {
    if (streamPhase !== 'idle' || sending) return
    if (isGuest && guestBlocked) return
    const session = isGuest ? { id: GUEST_SESSION_ID } : activeSession
    if (!session) return
    // Find last user message index
    const lastUserIdx = [...messages].reverse().findIndex(m => m.role === 'user')
    if (lastUserIdx === -1) return
    const userMsgIdx = messages.length - 1 - lastUserIdx
    const history = messages.slice(0, userMsgIdx + 1)
    // Replace from that point: keep history up to & including last user msg, add empty assistant slot
    setMessages([...history, { role: 'assistant', content: '' }])
    await doStream(history, session, false, { regenerate: true })
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

  // ── Voice input (record → server-side Whisper transcription) ───────────
  const toggleVoice = async () => {
    // Second click stops the recording, which fires onstop → upload + transcribe.
    if (listening) { try { mediaRecorderRef.current?.stop() } catch {} return }
    if (transcribing) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast.error('Voice input isn’t supported in this browser.'); return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e: any) {
      toast.error(
        e?.name === 'NotAllowedError' ? 'Microphone blocked. Allow mic access for this site and try again.'
        : e?.name === 'NotFoundError' ? 'No microphone was found.'
        : 'Could not access the microphone.')
      return
    }
    mediaStreamRef.current = stream
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
      .find(t => (window as any).MediaRecorder?.isTypeSupported?.(t)) || ''
    let mr: MediaRecorder
    try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined) }
    catch { stream.getTracks().forEach(t => t.stop()); toast.error('Voice recording is unavailable in this browser.'); return }

    audioChunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data && e.data.size) audioChunksRef.current.push(e.data) }
    mr.onerror = () => { mediaStreamRef.current?.getTracks().forEach(t => t.stop()); if (mountedRef.current) setListening(false) }
    mr.onstop = async () => {
      mediaStreamRef.current?.getTracks().forEach(t => t.stop())
      mediaStreamRef.current = null
      if (mountedRef.current) setListening(false)
      const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || 'audio/webm' })
      if (!blob.size) return
      if (mountedRef.current) setTranscribing(true)
      try {
        const ext = (mr.mimeType || '').includes('mp4') ? 'mp4' : (mr.mimeType || '').includes('ogg') ? 'ogg' : 'webm'
        const fd = new FormData()
        fd.append('file', blob, `voice.${ext}`)
        const tok = localStorage.getItem('token')
        const headers: Record<string, string> = {}
        if (tok) headers.Authorization = `Bearer ${tok}`
        // Raw fetch (not the axios instance) so the browser sets the multipart boundary.
        const resp = await fetch(`${baseURL}/transcribe`, { method: 'POST', headers, body: fd })
        if (!resp.ok) {
          let detail = 'Transcription failed'
          try { detail = (await resp.json()).detail || detail } catch {}
          throw new Error(detail)
        }
        const { text } = await resp.json()
        const t = (text || '').trim()
        if (!t) { toast('No speech detected'); return }
        if (mountedRef.current) setInput(prev => (prev.trim() ? `${prev.trim()} ${t}` : t))
      } catch (e: any) {
        toast.error(e?.message || 'Transcription failed. Please try again.')
      } finally {
        if (mountedRef.current) setTranscribing(false)
      }
    }

    try { mr.start() } catch { stream.getTracks().forEach(t => t.stop()); if (mountedRef.current) setListening(false); return }
    mediaRecorderRef.current = mr
    if (mountedRef.current) setListening(true)
  }

  const applyTemplate = (t: Template) => { setSystemPrompt(t.content); setShowSystem(true); setShowTemplates(false); if (model !== CUSTOM_VARIANT_ID) setModel(CUSTOM_VARIANT_ID) }
  const applyPersona = (p: any) => {
    // A persona is a saved chat config: model + system prompt + KB + temperature.
    if (p.base_model) setModel(p.base_model)
    setSystemPrompt(p.system_prompt || '')
    setShowSystem(true)
    if (p.knowledge_base_id) setKbId(p.knowledge_base_id)
    setTemperature(typeof p.temperature === 'number' ? p.temperature : null)
    if (p.personality) setPersonality(normalizeTraits(p.personality))
    setShowPersonas(false)
    toast.success(`Persona "${p.name}" applied`)
    if (p.id) api.post(`/personas/${p.id}/use`).catch(() => {})
  }
  const saveTemplate = async () => {
    if (!newTemplateName.trim() || !systemPrompt.trim()) return
    try { const { data } = await api.post('/templates', { name: newTemplateName.trim(), content: systemPrompt }); setTemplates(t => [data, ...t]); setNewTemplateName(''); toast.success('Template saved!') } catch { toast.error('Failed to save') }
  }
  const deleteTemplate = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation(); await api.delete(`/templates/${id}`); setTemplates(t => t.filter(x => x.id !== id))
  }

  const activeKb = kbs.find((k) => k.id === kbId)
  // Search message *content* across all sessions (debounced). Titles are still
  // matched locally for instant feedback; this adds full-text body matches.
  useEffect(() => {
    const q = sessionSearch.trim()
    if (q.length < 2) { setContentResults(null); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/chat/sessions/search', { params: { q } })
        setContentResults(data)
      } catch { setContentResults([]) }
      finally { setSearching(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [sessionSearch])

  const filteredSessions = sessions.filter(s => s.title.toLowerCase().includes(sessionSearch.toLowerCase()))
  const isStreaming = streamPhase !== 'idle' || sending

  return (
    <div className="flex h-full">
      {sessionPanelOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setSessionPanelOpen(false)} />
      )}

      {/* Session sidebar — hidden for guests (no saved chats) */}
      {!isGuest && (
      <div className={clsx(
        'flex-shrink-0 w-64 border-r border-gray-800 bg-gray-900 flex flex-col',
        'fixed top-12 bottom-0 left-0 z-40 transition-transform duration-300',
        'lg:static lg:top-auto lg:bottom-auto lg:z-auto lg:translate-x-0 lg:transition-none',
        sessionPanelOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      )}>
        <div className="p-2.5 border-b border-gray-800 space-y-2">
          <div className="flex items-center gap-2">
            <button onClick={newChat} className="btn-primary flex-1 justify-center py-2 text-sm">
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
          {/* When searching, show full-text results (title + message body) with
              snippets; otherwise the plain recent-session list. */}
          {contentResults !== null ? (
            <>
              {searching && contentResults.length === 0 && (
                <p className="text-xs text-gray-600 px-3 py-4 text-center">Searching…</p>
              )}
              {contentResults.map((s) => (
                <div key={s.id} onClick={() => selectSession(s)}
                  className={clsx('flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-pointer group text-sm transition-colors',
                    activeSession?.id === s.id ? 'bg-primary-900/40 text-primary-300' : 'hover:bg-gray-800 text-gray-400'
                  )}>
                  <Bot className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm">{s.title}</p>
                    {s.snippet ? (
                      <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{s.snippet}</p>
                    ) : (
                      <p className="text-xs text-gray-600 truncate">{s.model_name.replace('nebulax:', '')}</p>
                    )}
                    {s.match_count > 1 && (
                      <p className="text-[10px] text-primary-500/80 mt-0.5">{s.match_count} matches</p>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button onClick={(e) => deleteSession(s.id, e)} className="hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
              {!searching && contentResults.length === 0 && (
                <p className="text-xs text-gray-600 px-3 py-4 text-center">No chats match "{sessionSearch}"</p>
              )}
            </>
          ) : (
            filteredSessions.map((s) => (
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
            ))
          )}
        </div>
      </div>
      )}

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex-shrink-0 border-b border-gray-800 bg-gray-900">
          <div className="flex items-center gap-2 px-3 py-2">
            {!isGuest && (
              <button onClick={() => setSessionPanelOpen(true)} className="lg:hidden p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 flex-shrink-0"><Menu className="w-4 h-4" /></button>
            )}

            <select value={model} onChange={(e) => {
              const m = e.target.value; setModel(m)
              if (activeSession) {
                api.patch(`/chat/sessions/${activeSession.id}`, { model_name: m }).catch(() => {})
                setSessions(s => s.map(x => x.id === activeSession.id ? { ...x, model_name: m } : x))
                setActiveSession(a => a ? { ...a, model_name: m } : a)
              }
            }} className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500">
              <optgroup label="NebulaX (smart routing)">
                {variants.map((v) => <option key={v.id} value={v.id} disabled={!v.ready}>{v.label}{v.ready ? '' : ' (unavailable)'}</option>)}
              </optgroup>
              {!isGuest && ollamaModels.length > 0 && (
                <optgroup label="Models (direct)">
                  {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </optgroup>
              )}
            </select>

            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary-900/20 text-primary-300 text-xs font-medium border border-primary-800/40 flex-shrink-0">
              <Sparkles className="w-3 h-3" />{variants.find((v) => v.id === model)?.label ?? model}
            </span>

            {/* Export */}
            {messages.length > 0 && (
              <button onClick={exportConversation} className="btn-ghost p-1.5 flex-shrink-0" title="Export as Markdown">
                <Download className="w-4 h-4" />
              </button>
            )}

            {!isGuest && (<>
            {/* Web search toggle */}
            <button onClick={() => setWebSearch(w => !w)} title={webSearch ? 'Web search on' : 'Web search off'}
              className={clsx('text-xs gap-1 p-1.5 flex-shrink-0 rounded-md inline-flex items-center transition-colors',
                webSearch ? 'bg-primary-900/40 text-primary-300 border border-primary-700' : 'btn-ghost')}>
              <Globe className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Web</span>
            </button>
            {/* Personas */}
            <div className="relative flex items-center flex-shrink-0">
              <button onClick={() => setShowPersonas(!showPersonas)} className="btn-ghost text-xs gap-1 p-1.5" title="Personas">
                <Bot className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Personas</span>
              </button>
              {showPersonas && (
                <div className="absolute right-0 top-full mt-1 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 p-3 space-y-1">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide pb-1">Personas</p>
                  {personas.length === 0 && <p className="text-xs text-gray-600">No personas yet. Create one on the Personas page.</p>}
                  {personas.map((p) => (
                    <div key={p.id} onClick={() => applyPersona(p)} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-800">
                      <span className="text-base leading-none">{p.emoji || '🤖'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-200 truncate">{p.name}</p>
                        <p className="text-xs text-gray-500 truncate">{p.base_model}{p.description ? ` · ${p.description}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Templates */}
            <div className="relative flex items-center gap-1 flex-shrink-0" data-templates-panel>
              <button onClick={() => setShowTemplates(!showTemplates)} className="btn-ghost text-xs gap-1 p-1.5" title="Prompt templates">
                <BookMarked className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Templates</span>
              </button>
              {(model === CUSTOM_VARIANT_ID || !model.startsWith('nebulax:')) && (
                <button onClick={() => setShowSystem(!showSystem)} className="btn-ghost text-xs gap-1 p-1.5">
                  <ChevronDown className={clsx('w-3 h-3 transition-transform', showSystem && 'rotate-180')} />
                  <span className="hidden sm:inline">System</span>
                </button>
              )}
              {(model === CUSTOM_VARIANT_ID || !model.startsWith('nebulax:')) && (
                <button onClick={() => setShowPersonality(!showPersonality)} className="btn-ghost text-xs gap-1 p-1.5 relative" title="Personality">
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Personality</span>
                  {personalityActive(personality) && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary-400" />}
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
            </>)}
          </div>

          {!isGuest && kbs.length > 0 && (
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

          {!isGuest && (
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
          )}
        </div>

        {/* Guest trial banner */}
        {isGuest && (
          <div className="px-4 py-2 border-b border-gray-800 bg-gradient-to-r from-primary-900/20 to-secondary-900/10 flex items-center gap-2 flex-wrap text-xs">
            <Sparkle className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" />
            <span className="text-gray-300">
              You're chatting as a guest.{' '}
              {guestRemaining != null
                ? <span className="text-primary-300 font-medium">{guestRemaining.toLocaleString()} free tokens left today.</span>
                : <span className="text-gray-400">Sign in to save chats, attach files, and generate images.</span>}
            </span>
            <span className="flex items-center gap-2 ml-auto">
              <Link to="/login" className="text-gray-400 hover:text-gray-200 transition-colors">Sign in</Link>
              <Link to="/register" className="btn-primary py-1 px-2.5">Create free account</Link>
            </span>
          </div>
        )}

        {(model === CUSTOM_VARIANT_ID || !model.startsWith('nebulax:')) && showSystem && (
          <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/50">
            <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="You are a helpful assistant that…" rows={2} className="input text-sm resize-none" />
            <p className="text-xs text-gray-500 mt-1">Custom variant & direct models use this system prompt. Branded variants enforce their own behaviour.</p>
          </div>
        )}

        {!isGuest && (model === CUSTOM_VARIANT_ID || !model.startsWith('nebulax:')) && showPersonality && (
          <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-primary-400" /> Model Personality
              </p>
              <button
                onClick={async () => {
                  setSavingPersonality(true)
                  try { await api.patch('/auth/me', { ai_personality: personality }); toast.success('Saved as your default personality') }
                  catch { toast.error('Could not save') }
                  finally { setSavingPersonality(false) }
                }}
                disabled={savingPersonality}
                className="btn-ghost text-xs gap-1 p-1.5 text-gray-400">
                {savingPersonality ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} Save as default
              </button>
            </div>
            <PersonalitySliders value={personality} onChange={setPersonality} />
            <p className="text-xs text-gray-500 mt-2">Shapes the model's voice and sampling for this chat. Branded variants enforce their own behaviour.</p>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 relative min-h-0">
        <div ref={scrollRef} onScroll={onMessagesScroll} className="h-full overflow-y-auto px-4 py-4 space-y-5">
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
              streamPhase={streamPhase} warmingModel={warmingModel} sending={sending}
              onRegenerate={regenerate}
              isCliActive={!!activeCli && (streamPhase !== 'idle' || sending) && i === messages.length - 1 && msg.role === 'assistant'}
              activity={i === messages.length - 1 ? streamActivity : null}
              activitySince={i === messages.length - 1 ? activitySince : null}
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
          {showJump && (
            <button onClick={jumpToLatest}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 rounded-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-xs py-1.5 px-3 shadow-lg transition-colors">
              <ChevronDown className="w-3.5 h-3.5" /> Jump to latest
            </button>
          )}
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
          {isGuest && guestBlocked ? (
            <div className="max-w-xl mx-auto text-center py-3 px-4 rounded-xl border border-primary-800/50 bg-primary-900/20">
              <Lock className="w-5 h-5 text-primary-400 mx-auto mb-2" />
              <p className="text-sm text-gray-200 font-medium">You've used today's free guest tokens</p>
              <p className="text-xs text-gray-400 mt-1">Create a free account to keep chatting — plus saved history, file uploads, knowledge bases, and image generation.</p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Link to="/register" className="btn-primary py-1.5 px-4 text-sm">Create free account</Link>
                <Link to="/login" className="btn-ghost py-1.5 px-3 text-sm">Sign in</Link>
              </div>
            </div>
          ) : (
          <div className="flex items-end gap-2 max-w-4xl mx-auto">
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.md" className="hidden" onChange={handleFile} />
            {!isGuest && (
              <button onClick={() => fileInputRef.current?.click()} className="btn-ghost p-2 flex-shrink-0" title="Attach file or image">
                <Paperclip className="w-4 h-4" />
              </button>
            )}
            <button onClick={toggleVoice} disabled={transcribing} className={clsx('btn-ghost p-2 flex-shrink-0 transition-colors', listening && 'text-red-400 bg-red-900/20', transcribing && 'opacity-60 cursor-not-allowed')} title={transcribing ? 'Transcribing…' : listening ? 'Stop recording' : 'Voice input (Whisper)'}>
              {transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <textarea
              ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={listening ? 'Recording… click the mic to stop' : transcribing ? 'Transcribing…' : 'Message… (Enter to send, Shift+Enter for newline)'}
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
          )}
        </div>
      </div>
    </div>
  )
}
