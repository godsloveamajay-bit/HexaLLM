import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Send, Loader2, ChevronDown,
  FileText, Sparkles, Zap, Scale, Brain, Settings2, User,
  X, Paperclip, BookMarked, Clipboard, ClipboardCheck,
  Mic, MicOff, Square, Download, RotateCcw,
  ChevronRight, Wrench, Lock, Sparkle, SlidersHorizontal, Globe, Sigma,
  Sliders,
} from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../store/auth'
import { useSessions, activeSessionOf, type Session } from '../store/sessions'
import { prettyModel } from '../lib/models'
import PersonalitySliders from '../components/PersonalitySliders'
import { normalizeTraits, isActive as personalityActive, type TraitKey } from '../lib/personality'
import AiSparkle from '../components/AiSparkle'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import katex from 'katex'
import 'katex/dist/katex.min.css'
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
interface HexaLLMVariant {
  id: string; label: string; description: string; ready: boolean
  available_bases: string[]; missing_bases: string[]
}

const VARIANT_ICONS: Record<string, any> = {
  'hex-5.1-prime': Scale,
  'hex-4.2-code':     Zap,
  'hex-4.2-turbo':     Brain,
  'hex-4.3-write':    Sparkles,
  'hex-6.0-reason':    Brain,
  'hex-4.2-custom':   Settings2,
  'hex-4.2-math':     Sigma,
}

const CUSTOM_VARIANT_ID = 'hex-4.2-custom'
// Gemini-style starter prompts shown under the empty composer.
const SUGGESTIONS = [
  'Explain a complex topic simply',
  'Help me write or debug code',
  'Summarize an article or document',
  'Brainstorm ideas for a project',
]
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

// ── Math renderer (inline $…$ and block $$…$$) ──────────────────────────
function InlineMath({ value }: { value: string }) {
  const html = katex.renderToString(value, { throwOnError: false, displayMode: false })
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}
function BlockMath({ value }: { value: string }) {
  const html = katex.renderToString(value, { throwOnError: false, displayMode: true })
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

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
function ChatThoughtDrawer({ steps, reasoning, running, label = 'Agent Thinking' }: { steps: StepEvent[]; reasoning?: string; running: boolean; label?: string }) {
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
          {running ? `${label}…` : label}
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
      <span className="text-sm text-gray-500 shimmer-text">{label || verb}…{mmss && <span className="text-gray-600 tabular-nums">{mmss}</span>}</span>
    </div>
  )
}

// ── Message bubble with copy/actions ────────────────────────────────────
function MessageBubble({
  msg, index, isLast, isActive, streamPhase, warmingModel, sending, onRegenerate, isCliActive, activity, activitySince, reasoningPhase,
}: {
  msg: Message; index: number; isLast: boolean
  isActive: boolean; streamPhase: string; warmingModel?: string; sending: boolean
  onRegenerate: () => void; isCliActive: boolean; activity?: string | null; activitySince?: number | null
  reasoningPhase?: boolean
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
  // The backend flags a reasoning turn up front so the Thought bubble appears
  // immediately, before the (slow on CPU) first <think> token streams in.
  // `reasoningPending` self-resolves: if the model answers directly (no <think>),
  // visible answer text clears it so the bubble never sticks.
  const reasoningActive = !!reasoningPhase && isLast && msg.role === 'assistant'
  const reasoningPending = reasoningActive && !think && !clean.trim()
  const showDrawer = (msg.steps && msg.steps.length > 0) || isCliActive || !!think || reasoningPending
  const drawerRunning = isCliActive || reasoningStreaming || reasoningPending
  const drawerLabel = (isCliActive || (msg.steps && msg.steps.length > 0)) ? 'Agent Thinking' : 'Thinking'

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
        <div className="max-w-3xl flex-1">
          {showDrawer && (
            <ChatThoughtDrawer steps={msg.steps || []} reasoning={think} running={drawerRunning} label={drawerLabel} />
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
            <div className="bg-gray-800/30 rounded-2xl px-4 py-3 prose prose-sm">
              <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                components={{
                  inlineMath: InlineMath,
                  math: BlockMath,
                  code({ className, children }: { className?: string; children?: React.ReactNode }) {
                    const code = String(children).replace(/\n$/, '')
                    return (
                      <code className={className || 'bg-gray-800 text-primary-300 px-1.5 py-0.5 rounded-md text-[0.85em] font-mono'}>
                        {children}
                      </code>
                    )
                  },
                } as any}
              >
                {clean}
              </ReactMarkdown>
              <span className="stream-cursor text-primary-500" />
            </div>
          ) : (
            <div className="bg-gray-800/30 rounded-2xl px-4 py-3 prose prose-sm">
              <ReactMarkdown
                remarkPlugins={[remarkMath, remarkGfm]}
                urlTransform={(url) =>
                  url.startsWith('data:') ? url : defaultUrlTransform(url)
                }
                components={{
                  inlineMath: InlineMath,
                  math: BlockMath,
                  code({ className, children }: { className?: string; children?: React.ReactNode }) {
                    const lang = /language-(\w+)/.exec(className || '')?.[1]
                    const code = String(children).replace(/\n$/, '')
                    return lang
                      ? <CodeBlock language={lang}>{code}</CodeBlock>
                      : <code className={className}>{children}</code>
                  },
                  img({ src, alt }: { src?: string; alt?: string }) {
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
                } as any}
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
        <div className="max-w-3xl">
          <div className="px-1 py-1 text-sm prose prose-sm prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkMath]} components={{ inlineMath: InlineMath, math: BlockMath } as any}>{msg.content}</ReactMarkdown>
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
  const { sessions, activeId, loaded: sessionsLoaded, fetch: fetchSessions, create: createSession,
          remove: deleteSession, setActive: selectSessionId, update: updateSession } = useSessions()
  const activeSession = activeSessionOf({ sessions, activeId })
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const wantsNew = searchParams.get('new') === '1'
  const requestedIdRef = useRef<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState(user?.ai_default_model || 'hex-5.1-prime')
  const [sending, setSending] = useState(false)
  const [streamPhase, setStreamPhase] = useState<'idle' | 'thinking' | 'warming' | 'typing'>('idle')
  const [showJump, setShowJump] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [streamActivity, setStreamActivity] = useState<string | null>(null)
  const [activitySince, setActivitySince] = useState<number | null>(null)
  const [warmingModel, setWarmingModel] = useState<string>('')
  // True once the backend signals a reasoning turn — shows the Thought bubble
  // immediately, before the (often minute-away on CPU) first <think> token.
  const [reasoningPhase, setReasoningPhase] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [variants, setVariants] = useState<HexaLLMVariant[]>([])
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  // Per-message temperature override.
  const [temperature, setTemperature] = useState<number | null>(typeof user?.ai_temperature === 'number' ? user.ai_temperature : null)
  // Personality Engine — sliders shaping the model's voice + sampling.
  const [personality, setPersonality] = useState<Record<TraitKey, number>>(normalizeTraits(user?.ai_personality))
  const [showPersonality, setShowPersonality] = useState(false)
  const [savingPersonality, setSavingPersonality] = useState(false)
  const [listening, setListening] = useState(false)     // mic is recording
  const [transcribing, setTranscribing] = useState(false) // uploading → Whisper
  const [greeting, setGreeting] = useState<string | null>(null)
  const [greetingLoading, setGreetingLoading] = useState(false)

  // Raw model access (Hyper+ plans) + advanced Ollama params
  const hasRawAccess = !!user?.is_admin || user?.subscription?.plan?.slug === 'hyper' || user?.subscription?.plan?.slug === 'supreme'
  const [ollamaOptions, setOllamaOptions] = useState<Record<string, any>>({})
  const [showAdvanced, setShowAdvanced] = useState(false)

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
      fetchSessions(); loadTemplates()
    }
  }, [isGuest, fetchSessions])

  // Gemini sidebar → chat: load the messages for a session the user picked.
  useEffect(() => {
    if (isGuest || activeId === null || !sessionsLoaded) return
    if (requestedIdRef.current === activeId) {
      requestedIdRef.current = null
      loadSessionMessages(activeId)
    }
  }, [activeId, isGuest, sessionsLoaded])

  // First visit: open the most recent chat. "?new=1" (sidebar button) starts fresh.
  useEffect(() => {
    if (isGuest || !sessionsLoaded || activeId !== null) return
    if (wantsNew) {
      newChat()
      navigate('/chat', { replace: true })
      return
    }
    if (sessions.length > 0) requestSession(sessions[0].id)
  }, [isGuest, sessionsLoaded, wantsNew, sessions.length, activeId])

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

  useEffect(() => {
    if (messages.length > 0) return
    let cancelled = false
    setGreetingLoading(true)
    api.post('/chat/greeting').then(({ data }) => {
      if (!cancelled) {
        setGreeting(data.greeting)
        setGreetingLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setGreeting('What can I help with?')
        setGreetingLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [messages.length === 0])

  const loadVariants = async () => {
    try { const { data } = await api.get('/models/hexallm/variants'); setVariants(data.variants || []) } catch {}
  }
  const loadTemplates = async () => {
    try { const { data } = await api.get('/templates'); setTemplates(data) } catch {}
  }
  const loadOllamaModels = async () => {
    try { const { data } = await api.get('/models/ollama/list'); setOllamaModels((data.models || []).map((m: any) => m.name)) } catch {}
  }
  // Re-fetch raw models when access level changes
  useEffect(() => { if (hasRawAccess) loadOllamaModels() }, [hasRawAccess])

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

  const loadSessionMessages = async (id: number) => {
    setSending(false); setStreamPhase('idle')
    setAttachment(null)
    const live = liveStreams.get(id)
    if (live) {
      if (live.done) {
        try { const { data } = await api.get(`/chat/sessions/${id}/messages`); setMessages(data.map((m: any) => ({ role: m.role as Message['role'], content: m.content, steps: m.steps || undefined }))) } catch {}
        liveStreams.delete(id)
      } else {
        try { const { data } = await api.get(`/chat/sessions/${id}/messages`); setMessages([...data.map((m: any) => ({ role: m.role as Message['role'], content: m.content, steps: m.steps || undefined })), { role: 'assistant' as const, content: live.content }]) } catch { setMessages([{ role: 'assistant' as const, content: live.content }]) }
        setSending(true); setStreamPhase(live.content ? 'typing' : 'thinking')
        live.onComplete.push((content, citations, route, usage, latency_ms) => {
          if (!mountedRef.current) return
          liveStreams.delete(id)
          setMessages(prev => { const u = [...prev]; const l = u[u.length - 1]; if (l?.role === 'assistant') u[u.length - 1] = { ...l, content, citations: citations.length ? citations : undefined, route, usage, latency_ms }; return u })
          setSending(false); setStreamPhase('idle')
        })
      }
      return
    }
    try { const { data } = await api.get(`/chat/sessions/${id}/messages`); setMessages(data.map((m: any) => ({ role: m.role, content: m.content, steps: m.steps || undefined }))) } catch {}
  }

  // Sidebar click → load that chat. The ref marks the click so the activeId
  // watcher loads messages exactly once for user picks (not for create()).
  const requestSession = (id: number) => {
    const s = useSessions.getState().sessions.find((x) => x.id === id)
    if (s) setModel(s.model_name)
    requestedIdRef.current = id
    selectSessionId(id)
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
  // Explicit "New Chat" (sidebar / header) — start a fresh empty session.
  const newChat = async () => {
    setMessages([])
    setInput('')
    setAttachment(null)
    try {
      await createSession(model, systemPrompt)
    } catch {
      toast.error('Could not start a new chat.')
    }
  }

  useEffect(() => {
    if (activeId === null && !isGuest) setMessages([])
  }, [activeId, isGuest])

  // ── Send / regenerate ────────────────────────────────────────────────
  const doStream = useCallback(async (userMessages: Message[], session: { id: number }, isFirst: boolean, opts: { regenerate?: boolean } = {}) => {
    const entry: StreamEntry = { content: '', citations: [], route: undefined, usage: undefined, latency_ms: 0, done: false, onComplete: [] }
    liveStreams.set(session.id, entry)

    abortRef.current = new AbortController()
    setSending(true)
    setReasoningPhase(false)
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
      setSending(false); setStreamPhase('idle'); setWarmingModel(''); setStreamActivity(null); setActivitySince(null); setReasoningPhase(false)
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
        body: JSON.stringify({ model, messages: userMessages, session_id: session.id > 0 ? session.id : null, system_prompt: systemPrompt || null, stream: true, ...(temperature != null ? { temperature } : {}), ...(personalityActive(personality) ? { personality } : {}), ...(opts.regenerate ? { regenerate: true } : {}), ...(webSearch ? { web_search: true } : {}), attachment_base64: attachment?.base64 || null, attachment_type: attachment?.type || null, attachment_name: attachment?.name || null, ...(Object.keys(ollamaOptions).length > 0 ? { ollama_options: ollamaOptions } : {}) }),
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
        if (mountedRef.current) { setMessages(m => m.slice(0, -1)); setSending(false); setStreamPhase('idle'); setStreamActivity(null); setActivitySince(null); setReasoningPhase(false) }
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
            // Show the branded variant label; never leak a raw model name to non-admins.
            try {
              const w = JSON.parse(data); const m = w.model || ''
              setWarmingModel((user?.is_admin || m.startsWith('hex-')) ? prettyModel(m) : '')
            } catch {}
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
          else if (event === 'reasoning') {
            // Reasoning turn — surface the Thought bubble right away and start the
            // elapsed timer so the long prefill reads as working, not frozen.
            if (mountedRef.current) { setReasoningPhase(true); setActivitySince(Date.now()) }
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
      if (mountedRef.current) { setSending(false); setStreamPhase('idle'); setStreamActivity(null); setActivitySince(null); setReasoningPhase(false) }
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
          updateSession(session.id, { title: data.title })
        }).catch(() => {})
      }
    }
  }, [model, systemPrompt, attachment])

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
      session = isGuest ? { id: GUEST_SESSION_ID } : (activeSession ?? await createSession(model, systemPrompt))
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
      .map(m => `## ${m.role === 'user' ? 'You' : 'HexaLLM AI'}\n\n${m.content}`)
      .join('\n\n---\n\n')
    const blob = new Blob([`# ${title}\n\n${md}`], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`; a.click()
  }

  // ── Insert math delimiters at cursor ───────────────────────────────────
  const insertMath = () => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const sel = input.slice(start, end)
    const wrapped = sel ? `$$${sel}$$` : '$$  $$'
    const cursorPos = sel ? start + wrapped.length - 2 : start + 3
    setInput(input.slice(0, start) + wrapped + input.slice(end))
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(cursorPos, cursorPos) })
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
  const saveTemplate = async () => {
    if (!newTemplateName.trim() || !systemPrompt.trim()) return
    try { const { data } = await api.post('/templates', { name: newTemplateName.trim(), content: systemPrompt }); setTemplates(t => [data, ...t]); setNewTemplateName(''); toast.success('Template saved!') } catch { toast.error('Failed to save') }
  }
  const deleteTemplate = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation(); await api.delete(`/templates/${id}`); setTemplates(t => t.filter(x => x.id !== id))
  }

  const isStreaming = streamPhase !== 'idle' || sending

  const onModelChange = (m: string) => {
    setModel(m)
    if (activeSession) {
      api.patch(`/chat/sessions/${activeSession.id}`, { model_name: m }).catch(() => {})
      updateSession(activeSession.id, { model_name: m })
    }
  }

  const pickSuggestion = (s: string) => {
    setInput(s)
    textareaRef.current?.focus()
  }

  const composer = (
    <div data-templates-panel
      className="w-full rounded-3xl border border-gray-700/50 bg-gray-900/70 light:bg-white/80 backdrop-blur
                 shadow-lg shadow-black/20 focus-within:border-primary-500/60 transition-colors">
      {isGuest && guestBlocked ? (
        <div className="max-w-xl mx-auto text-center py-4 px-4">
          <Lock className="w-5 h-5 text-primary-400 mx-auto mb-2" />
          <p className="text-sm text-gray-200 font-medium">You've used today's free guest tokens</p>
          <p className="text-xs text-gray-400 mt-1">Create a free account to keep chatting — plus saved history, file uploads, and image generation.</p>
          <div className="flex items-center justify-center gap-2 mt-3">
            <Link to="/register" className="btn-primary py-1.5 px-4 text-sm">Create free account</Link>
            <Link to="/login" className="btn-ghost py-1.5 px-3 text-sm">Sign in</Link>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-end gap-2 px-3 py-2.5">
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt,.md" className="hidden" onChange={handleFile} />
            {!isGuest && (
              <button onClick={() => fileInputRef.current?.click()} className="btn-ghost p-2 flex-shrink-0" title="Attach file or image">
                <Paperclip className="w-4 h-4" />
              </button>
            )}
            <button onClick={toggleVoice} disabled={transcribing} className={clsx('btn-ghost p-2 flex-shrink-0 transition-colors', listening && 'text-red-400 bg-red-900/20', transcribing && 'opacity-60 cursor-not-allowed')} title={transcribing ? 'Transcribing…' : listening ? 'Stop recording' : 'Voice input (Whisper)'}>
              {transcribing ? <Loader2 className="w-4 h-4 animate-spin" /> : listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button onClick={insertMath} className="btn-ghost p-2 flex-shrink-0 text-indigo-400 hover:text-cyan-300 transition-colors" title="Insert math ($$ ... $$)">
              <Sigma className="w-4 h-4" />
            </button>
            <textarea
              ref={textareaRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder={listening ? 'Recording… click the mic to stop' : transcribing ? 'Transcribing…' : messages.length === 0 ? 'What would you like to know?' : 'Message… (Enter to send, Shift+Enter for newline)'}
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

          {/* Chips row */}
          <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
            {variants.filter(v => v.ready).map(v => {
              const Icon = VARIANT_ICONS[v.id] || Sparkles
              return (
                <button key={v.id} onClick={() => onModelChange(v.id)}
                  className={clsx('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-colors',
                    model === v.id ? 'bg-primary-900/40 border-primary-700 text-primary-200' : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700')}>
                  <Icon className="w-3 h-3" />{v.label}
                </button>
              )
            })}
            {hasRawAccess && ollamaModels.length > 0 && (
              <select value={model} onChange={(e) => onModelChange(e.target.value)}
                className="bg-gray-900 border border-gray-800 rounded-md px-1.5 py-1 text-xs text-gray-400 focus:outline-none">
                <optgroup label="Models (direct)">
                  {ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </optgroup>
              </select>
            )}
            {!isGuest && (
              <button onClick={() => setWebSearch(w => !w)} title={webSearch ? 'Web search on' : 'Web search off'}
                className={clsx('inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border transition-colors',
                  webSearch ? 'bg-primary-900/40 text-primary-300 border-primary-700' : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700')}>
                <Globe className="w-3.5 h-3.5" /><span className="hidden sm:inline">Web</span>
              </button>
            )}
            {!isGuest && (
              <button onClick={() => setShowTemplates(!showTemplates)} className="btn-ghost text-xs gap-1 p-1.5" title="Prompt templates">
                <BookMarked className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Templates</span>
              </button>
            )}
            {(model === CUSTOM_VARIANT_ID || !model.startsWith('hex-')) && (
              <button onClick={() => setShowSystem(!showSystem)} className="btn-ghost text-xs gap-1 p-1.5">
                <ChevronDown className={clsx('w-3 h-3 transition-transform', showSystem && 'rotate-180')} />
                <span className="hidden sm:inline">System</span>
              </button>
            )}
            {(model === CUSTOM_VARIANT_ID || !model.startsWith('hex-')) && (
              <button onClick={() => setShowPersonality(!showPersonality)} className="btn-ghost text-xs gap-1 p-1.5 relative" title="Personality">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Personality</span>
                {personalityActive(personality) && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary-400" />}
              </button>
            )}
            {hasRawAccess && (
              <button onClick={() => setShowAdvanced(!showAdvanced)} className={clsx('btn-ghost text-xs gap-1 p-1.5', showAdvanced && 'bg-primary-900/30')} title="Advanced Ollama params">
                <Sliders className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Params</span>
                {Object.keys(ollamaOptions).length > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary-400" />}
              </button>
            )}
            {messages.length > 0 && (
              <button onClick={exportConversation} className="btn-ghost p-1.5 ml-auto" title="Export as Markdown">
                <Download className="w-4 h-4" />
              </button>
            )}
          </div>

          {showTemplates && (
            <div className="mx-3 mb-3 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-3 space-y-2">
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
        </>
      )}
    </div>
  )

  const panels = (
    <>
      {(model === CUSTOM_VARIANT_ID || !model.startsWith('hex-')) && showSystem && (
        <div className="mt-2 rounded-xl border border-gray-800 bg-gray-900/50 p-3">
          <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="You are a helpful assistant that…" rows={2} className="input text-sm resize-none" />
          <p className="text-xs text-gray-500 mt-1">Custom variant & direct models use this system prompt. Branded variants enforce their own behaviour.</p>
        </div>
      )}
      {!isGuest && (model === CUSTOM_VARIANT_ID || !model.startsWith('hex-')) && showPersonality && (
        <div className="mt-2 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
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
      {hasRawAccess && showAdvanced && (
        <div className="mt-2 rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-xs font-semibold text-gray-300 mb-3 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-primary-400" /> Advanced Ollama Params
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { key: 'num_ctx', label: 'Context Length', type: 'number', min: 2048, max: 65536, step: 2048 },
              { key: 'top_k', label: 'Top K', type: 'number', min: 1, max: 100, step: 1 },
              { key: 'repeat_penalty', label: 'Repeat Penalty', type: 'number', min: 0.1, max: 2, step: 0.1 },
              { key: 'frequency_penalty', label: 'Freq Penalty', type: 'number', min: 0, max: 2, step: 0.1 },
              { key: 'presence_penalty', label: 'Presence Penalty', type: 'number', min: 0, max: 2, step: 0.1 },
              { key: 'seed', label: 'Seed (0=random)', type: 'number', min: 0, max: 2147483647, step: 1 },
              { key: 'mirostat', label: 'Mirostat', type: 'select', options: [{value: 0, label: 'Off'}, {value: 1, label: 'Mirostat 1'}, {value: 2, label: 'Mirostat 2'}] },
            ].map(({ key, label, type, min, max, step, options }) => (
              <div key={key}>
                <label className="text-xs text-gray-500 block mb-0.5">{label}</label>
                {type === 'select' ? (
                  <select
                    value={typeof ollamaOptions[key] === 'number' ? ollamaOptions[key] as number : 0}
                    onChange={(e) => setOllamaOptions(o => ({...o, [key]: parseInt(e.target.value)}))}
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 w-full"
                  >
                    {options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input
                    type={type} min={min} max={max} step={step}
                    value={typeof ollamaOptions[key] === 'number' ? ollamaOptions[key] as number : ''}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '') {
                        const next = {...ollamaOptions}; delete next[key]; setOllamaOptions(next)
                      } else {
                        setOllamaOptions(o => ({...o, [key]: type === 'number' ? parseFloat(raw) : raw}))
                      }
                    }}
                    placeholder="Default"
                    className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 w-full"
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button onClick={() => setOllamaOptions({})} className="btn-ghost text-xs px-2 py-1 text-gray-500 hover:text-gray-300">Reset all</button>
            <p className="text-xs text-gray-600">Applies when using direct models. HexaLLM variants ignore these.</p>
          </div>
        </div>
      )}
    </>
  )

  return (
    <div className="flex flex-col h-full">
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

      {/* Composer pinned above the thread (Gemini-style) */}
      {messages.length > 0 && (
        <div className="flex-shrink-0 w-full max-w-3xl mx-auto px-4 pt-4 pb-1">
          {attachment && (
            <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-xl border border-gray-800 bg-gray-900/60">
              {attachment.preview ? <img src={attachment.preview} alt="attachment" className="w-10 h-10 object-cover rounded" /> : <FileText className="w-5 h-5 text-gray-500 flex-shrink-0" />}
              <span className="text-xs text-gray-400 flex-1 truncate">{attachment.name}</span>
              <button onClick={() => setAttachment(null)} className="text-gray-600 hover:text-gray-400"><X className="w-4 h-4" /></button>
            </div>
          )}
          {composer}
          {panels}
        </div>
      )}

      {/* Messages / empty state */}
      {messages.length === 0 ? (
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
          <div className="min-h-full flex flex-col items-center justify-center px-4 py-10">
            <div className="max-w-2xl w-full flex flex-col items-center">
              <div className="w-16 h-16 mb-5 rounded-2xl bg-gradient-to-br from-primary-500/20 to-secondary-500/20 flex items-center justify-center">
                <AiSparkle size={32} active />
              </div>
              {greetingLoading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-6">
                  <span className="inline-block w-5 h-5 border-2 border-gray-600 border-t-primary-400 rounded-full animate-spin" />
                  <span className="text-sm text-gray-500">Thinking of a greeting…</span>
                </div>
              ) : (
                <>
                  <h1 className="text-2xl font-semibold text-gray-100 leading-relaxed text-center">{greeting}</h1>
                  <p className="text-sm text-gray-500 mt-3 max-w-md mx-auto text-center">
                    I'm HexaLLM — code, write, analyze, create. Pick a model and start chatting.
                  </p>
                </>
              )}

              <div className="w-full mt-6">
                {attachment && (
                  <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded-xl border border-gray-800 bg-gray-900/60">
                    {attachment.preview ? <img src={attachment.preview} alt="attachment" className="w-10 h-10 object-cover rounded" /> : <FileText className="w-5 h-5 text-gray-500 flex-shrink-0" />}
                    <span className="text-xs text-gray-400 flex-1 truncate">{attachment.name}</span>
                    <button onClick={() => setAttachment(null)} className="text-gray-600 hover:text-gray-400"><X className="w-4 h-4" /></button>
                  </div>
                )}
                {composer}
                {panels}
              </div>

              <div className="mt-5 grid sm:grid-cols-2 gap-2 w-full">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => pickSuggestion(s)}
                    className="text-left rounded-xl border border-gray-800 bg-gray-900/60 hover:border-primary-500/50 hover:bg-gray-900 px-4 py-3 text-sm text-gray-300 transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div ref={bottomRef} />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 relative">
          <div ref={scrollRef} onScroll={onMessagesScroll} className="h-full overflow-y-auto py-6">
            <div className="max-w-3xl mx-auto space-y-5 px-4">
              {messages.map((msg, i) => (
                <MessageBubble
                  key={i} msg={msg} index={i}
                  isLast={i === messages.length - 1}
                  isActive={(streamPhase !== 'idle' || sending) && i === messages.length - 1 && msg.role === 'assistant'}
                  streamPhase={streamPhase} warmingModel={warmingModel} sending={sending}
                  onRegenerate={regenerate}
                  isCliActive={false}
                  activity={i === messages.length - 1 ? streamActivity : null}
                  activitySince={i === messages.length - 1 ? activitySince : null}
                  reasoningPhase={reasoningPhase && i === messages.length - 1}
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
          </div>
          {showJump && (
            <button onClick={jumpToLatest}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 rounded-full bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 text-xs py-1.5 px-3 shadow-lg transition-colors">
              <ChevronDown className="w-3.5 h-3.5" /> Jump to latest
            </button>
          )}
        </div>
      )}
    </div>
  )
}
