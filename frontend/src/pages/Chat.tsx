import { useState, useEffect, useRef } from 'react'
import { Send, Plus, Trash2, Bot, User, Loader2, ChevronDown, BookOpen, FileText, Sparkles, Sparkle, Zap, Scale, Brain, Settings2, Menu, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'

interface Citation {
  index: number
  chunk_id: number
  document_id: number
  document_filename: string
  score: number
  snippet: string
}
interface RouteInfo {
  variant: string
  chosen_model: string
  reason: string
}
interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
  citations?: Citation[]
  route?: RouteInfo
}
interface Session { id: number; title: string; model_name: string; updated_at: string }
interface KB { id: number; name: string; document_count: number; chunk_count: number }
interface NebulaVariant {
  id: string
  label: string
  description: string
  ready: boolean
  available_bases: string[]
  missing_bases: string[]
}

const VARIANT_ICONS: Record<string, any> = {
  'nebulax:fast': Zap,
  'nebulax:balanced': Scale,
  'nebulax:thinking': Brain,
  'nebulax:custom': Settings2,
}

const CUSTOM_VARIANT_ID = 'nebulax:custom'

// ── Module-level: survives component remounts ─────────────────────────────
// Keeps the stream alive and the accumulated text reachable even if the user
// navigates away before generation finishes.
interface StreamEntry {
  content: string
  citations: Citation[]
  route: RouteInfo | undefined
  done: boolean
  onComplete: Array<(content: string, citations: Citation[], route: RouteInfo | undefined) => void>
}
const liveStreams = new Map<number, StreamEntry>()
// ─────────────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState('nebulax:balanced')
  const [sending, setSending] = useState(false)          // true only during fast-mode streaming
  const [streamPhase, setStreamPhase] = useState<'idle' | 'thinking' | 'typing'>('idle')
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [kbs, setKbs] = useState<KB[]>([])
  const [kbId, setKbId] = useState<number | null>(null)
  const [variants, setVariants] = useState<NebulaVariant[]>([])
  const [ollamaModels, setOllamaModels] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const typeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const typeIndexRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (typeTimerRef.current) clearInterval(typeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    loadSessions()
    loadKbs()
    loadVariants()
    loadOllamaModels()
  }, [])

  const loadVariants = async () => {
    try {
      const { data } = await api.get('/models/nebulax/variants')
      const list: NebulaVariant[] = data.variants || []
      setVariants(list)
      const firstReady = list.find((v) => v.ready)
      if (firstReady) setModel(firstReady.id)
    } catch {}
  }

  const loadOllamaModels = async () => {
    try {
      const { data } = await api.get('/models/ollama/list')
      setOllamaModels((data.models || []).map((m: any) => m.name))
    } catch {}
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [input])

  const loadSessions = async () => {
    try {
      const { data } = await api.get('/chat/sessions')
      setSessions(data)
    } catch {}
  }

  const loadKbs = async () => {
    try {
      const { data } = await api.get('/knowledge')
      setKbs(data)
    } catch {}
  }

  // ── Typewriter ──────────────────────────────────────────────────────────
  function startTypewriter(content: string, citations: Citation[], route: RouteInfo | undefined) {
    if (!mountedRef.current) return
    const total = content.length
    if (!total) { setStreamPhase('idle'); return }

    // Target ~2.5 seconds to reveal the entire message, minimum 4 chars/tick at 60 fps
    const charsPerTick = Math.max(4, Math.ceil(total / 150))
    typeIndexRef.current = 0
    setStreamPhase('typing')
    if (typeTimerRef.current) clearInterval(typeTimerRef.current)

    typeTimerRef.current = setInterval(() => {
      if (!mountedRef.current) {
        clearInterval(typeTimerRef.current!)
        typeTimerRef.current = null
        return
      }
      typeIndexRef.current = Math.min(typeIndexRef.current + charsPerTick, total)
      const slice = content.slice(0, typeIndexRef.current)
      const done = typeIndexRef.current >= total
      setMessages(prev => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: slice,
            ...(done ? { citations: citations.length ? citations : undefined, route } : {}),
          }
        }
        return updated
      })
      if (done) {
        clearInterval(typeTimerRef.current!)
        typeTimerRef.current = null
        setStreamPhase('idle')
      }
    }, 16)
  }

  function cancelTypewriter() {
    if (typeTimerRef.current) {
      clearInterval(typeTimerRef.current)
      typeTimerRef.current = null
    }
    setStreamPhase('idle')
  }
  // ───────────────────────────────────────────────────────────────────────

  const createSession = async () => {
    const { data } = await api.post('/chat/sessions', {
      model_name: model,
      title: 'New Chat',
      system_prompt: systemPrompt || null,
    })
    setSessions((s) => [data, ...s])
    setActiveSession(data)
    setMessages([])
    return data
  }

  const selectSession = async (session: Session) => {
    cancelTypewriter()
    setActiveSession(session)
    setSessionPanelOpen(false)

    // Re-attach to a live stream if the user navigated away mid-generation
    const live = liveStreams.get(session.id)
    if (live) {
      if (live.done) {
        // Generation finished while away; DB has the full response
        try {
          const { data } = await api.get(`/chat/sessions/${session.id}/messages`)
          setMessages(data.map((m: any) => ({ role: m.role as Message['role'], content: m.content })))
        } catch {}
        liveStreams.delete(session.id)
      } else {
        // Still generating — show prior messages + thinking placeholder
        try {
          const { data } = await api.get(`/chat/sessions/${session.id}/messages`)
          setMessages([
            ...data.map((m: any) => ({ role: m.role as Message['role'], content: m.content })),
            { role: 'assistant' as const, content: '' },
          ])
        } catch {
          setMessages([{ role: 'assistant' as const, content: '' }])
        }
        setStreamPhase('thinking')
        live.onComplete.push((content, citations, route) => {
          if (!mountedRef.current) return
          liveStreams.delete(session.id)
          // Set full content so typewriter starts from the right place
          setMessages(prev => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content }
            }
            return updated
          })
          startTypewriter(content, citations, route)
        })
      }
      return
    }

    try {
      const { data } = await api.get(`/chat/sessions/${session.id}/messages`)
      setMessages(data.map((m: any) => ({ role: m.role, content: m.content })))
    } catch {}
  }

  const deleteSession = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    await api.delete(`/chat/sessions/${id}`)
    setSessions((s) => s.filter((x) => x.id !== id))
    if (activeSession?.id === id) { setActiveSession(null); setMessages([]) }
  }

  const sendMessage = async () => {
    if (!input.trim() || streamPhase !== 'idle' || sending) return
    const userMsg: Message = { role: 'user', content: input.trim() }
    setMessages((m) => [...m, userMsg])
    setInput('')

    let session = activeSession ?? await createSession()
    if (!session) return

    const newMessages = [...messages, userMsg]
    setMessages((m) => [...m, { role: 'assistant', content: '' }])

    const isFirstMessage = messages.length === 0
    // Typewriter for every model except nebulax:fast
    const useTypewriter = model !== 'nebulax:fast'

    // Register stream entry so page navigation can re-attach
    const entry: StreamEntry = {
      content: '', citations: [], route: undefined, done: false, onComplete: [],
    }
    liveStreams.set(session.id, entry)

    if (useTypewriter) {
      setStreamPhase('thinking')
    } else {
      setSending(true)
    }

    try {
      const resp = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          model,
          messages: newMessages,
          session_id: session?.id,
          system_prompt: systemPrompt || null,
          stream: true,
          knowledge_base_id: kbId,
        }),
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

          if (event === 'route') {
            try {
              entry.route = JSON.parse(data) as RouteInfo
              // Fast mode: update message state immediately
              if (!useTypewriter && mountedRef.current) {
                setMessages(m => {
                  const u = [...m]
                  u[u.length - 1] = { role: 'assistant', content: entry.content, citations: undefined, route: entry.route }
                  return u
                })
              }
            } catch {}
          } else if (event === 'citations') {
            try {
              entry.citations = JSON.parse(data) as Citation[]
              if (!useTypewriter && mountedRef.current) {
                setMessages(m => {
                  const u = [...m]
                  u[u.length - 1] = { role: 'assistant', content: entry.content, citations: entry.citations, route: entry.route }
                  return u
                })
              }
            } catch {}
          } else if (data !== '[DONE]' && data) {
            entry.content += data
            // Fast mode: stream chunks directly to UI; typewriter mode: only accumulate
            if (!useTypewriter && mountedRef.current) {
              setMessages(m => {
                const u = [...m]
                u[u.length - 1] = {
                  role: 'assistant',
                  content: entry.content,
                  citations: entry.citations.length ? entry.citations : undefined,
                  route: entry.route,
                }
                return u
              })
            }
          }
        }
      }
    } catch {
      toast.error('Failed to send message')
      if (mountedRef.current) setMessages((m) => m.slice(0, -1))
      liveStreams.delete(session.id)
    } finally {
      entry.done = true
      // Notify any listener that re-attached after navigation
      entry.onComplete.forEach(fn => fn(entry.content, entry.citations, entry.route))
      // Clean up the registry after a grace period
      setTimeout(() => liveStreams.delete(session.id), 10_000)

      if (useTypewriter) {
        // Begin typewriter reveal (no-ops if component unmounted)
        startTypewriter(entry.content, entry.citations, entry.route)
      } else {
        if (mountedRef.current) setSending(false)
      }

      // AI-generated title after first exchange
      if (isFirstMessage && session) {
        api.post(`/chat/sessions/${session.id}/rename`).then(({ data }) => {
          const title = data.title
          const sid = session.id
          setSessions((s) => s.map((x) => x.id === sid ? { ...x, title } : x))
          setActiveSession((a) => a?.id === sid ? ({ ...a, title } as Session) : a)
        }).catch(() => {})
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  const activeKb = kbs.find((k) => k.id === kbId)

  return (
    <div className="flex h-full">
      {/* Session panel mobile overlay */}
      {sessionPanelOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSessionPanelOpen(false)}
        />
      )}

      {/* Session sidebar — drawer on mobile, static on desktop */}
      <div className={`
        flex-shrink-0 w-64 border-r border-gray-800 bg-gray-900 flex flex-col
        fixed top-12 bottom-0 left-0 z-40 transition-transform duration-300
        lg:static lg:top-auto lg:bottom-auto lg:z-auto lg:translate-x-0 lg:transition-none
        ${sessionPanelOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-3 border-b border-gray-800 flex items-center gap-2">
          <button onClick={createSession} className="btn-primary flex-1 justify-center py-2">
            <Plus className="w-4 h-4" /> New Chat
          </button>
          <button
            onClick={() => setSessionPanelOpen(false)}
            className="lg:hidden p-2 rounded-lg hover:bg-gray-800 text-gray-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => selectSession(s)}
              className={clsx(
                'flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer group text-sm',
                activeSession?.id === s.id ? 'bg-primary-900/40 text-primary-300' : 'hover:bg-gray-800 text-gray-400'
              )}
            >
              <Bot className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="flex-1 truncate">{s.title}</span>
              <button onClick={(e) => deleteSession(s.id, e)} className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar — two compact rows on mobile, one on sm+ */}
        <div className="flex-shrink-0 border-b border-gray-800 bg-gray-900">
          {/* Row 1: sessions toggle + model selector + system prompt toggle */}
          <div className="flex items-center gap-2 px-3 py-2">
            {/* Session panel toggle — mobile only */}
            <button
              onClick={() => setSessionPanelOpen(true)}
              className="lg:hidden p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 flex-shrink-0"
              title="Chat sessions"
            >
              <Menu className="w-4 h-4" />
            </button>

            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {variants.length > 0 && (
                <optgroup label="NebulaX (routed)">
                  {variants.map((v) => (
                    <option key={v.id} value={v.id} disabled={!v.ready}>
                      {v.label}{v.ready ? '' : ' (no base)'}
                    </option>
                  ))}
                </optgroup>
              )}
              {ollamaModels.length > 0 && (
                <optgroup label="Ollama (direct)">
                  {ollamaModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </optgroup>
              )}
            </select>

            {/* Model badge — hidden on mobile to save space */}
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-gradient-to-r from-primary-900/40 to-purple-900/40 text-primary-300 text-xs font-medium border border-primary-800/60 flex-shrink-0">
              <Sparkles className="w-3 h-3" />
              {variants.find((v) => v.id === model)?.label || model}
            </span>

            {model === CUSTOM_VARIANT_ID && (
              <button onClick={() => setShowSystem(!showSystem)} className="btn-ghost text-xs gap-1 flex-shrink-0 ml-auto">
                <ChevronDown className={clsx('w-3 h-3 transition-transform', showSystem && 'rotate-180')} />
                <span className="hidden sm:inline">System Prompt</span>
              </button>
            )}
          </div>

          {/* Row 2: Knowledge base selector — own row so it never overflows */}
          {kbs.length > 0 && (
            <div className="flex items-center gap-2 px-3 pb-2">
              <BookOpen className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
              <select
                value={kbId ?? ''}
                onChange={(e) => setKbId(e.target.value ? parseInt(e.target.value) : null)}
                className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary-500"
                title="Ground responses in a knowledge base (RAG)"
              >
                <option value="">No knowledge base</option>
                {kbs.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.chunk_count} chunks)
                  </option>
                ))}
              </select>
              {activeKb && (
                <span className="badge bg-primary-900/30 text-primary-400 flex-shrink-0 text-xs">RAG</span>
              )}
            </div>
          )}
        </div>

        {model === CUSTOM_VARIANT_ID && showSystem && (
          <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/50">
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful assistant that..."
              rows={2}
              className="input text-sm resize-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Custom is the only variant where you control the system prompt. Other variants enforce their branded voice.
            </p>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
              <Bot className="w-12 h-12" />
              <p className="text-lg font-medium">Start a conversation</p>
              <p className="text-sm">
                {activeKb
                  ? `Grounded in "${activeKb.name}" — answers will cite your documents.`
                  : 'Pick a NebulaX model for routed answers, or any Ollama model for direct access.'}
              </p>
              {variants.some((v) => v.ready) && (
                <div className="flex gap-2 mt-2">
                  {variants.filter((v) => v.ready).map((v) => {
                    const Icon = VARIANT_ICONS[v.id] || Sparkles
                    return (
                      <button
                        key={v.id}
                        onClick={() => setModel(v.id)}
                        className={clsx(
                          'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors',
                          model === v.id
                            ? 'bg-primary-900/40 border-primary-700 text-primary-200'
                            : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700'
                        )}
                      >
                        <Icon className="w-3 h-3" />
                        {v.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {messages.map((msg, i) => {
            const isLastAssistant = i === messages.length - 1 && msg.role === 'assistant'
            const isThinking = streamPhase === 'thinking' && isLastAssistant
            const isTyping   = streamPhase === 'typing'   && isLastAssistant
            const isFastStream = sending && isLastAssistant
            const isActive   = isThinking || isTyping || isFastStream

            return (
              <div key={i} className={clsx('flex gap-3 fade-in', msg.role === 'user' ? 'flex-row-reverse' : '')}>
                {msg.role === 'user' ? (
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-primary-600">
                    <User className="w-4 h-4 text-white" />
                  </div>
                ) : (
                  <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                    <Sparkle
                      className={clsx(
                        'w-6 h-6 text-primary-500 fill-primary-500',
                        isActive ? 'star-shine' : 'star-rest'
                      )}
                    />
                  </div>
                )}

                {msg.role === 'assistant' ? (
                  <div className="max-w-2xl text-sm text-gray-200 pt-1">
                    {isThinking ? (
                      /* Waiting for the model to finish generating */
                      <div className="flex items-center gap-1.5 py-2">
                        <span className="w-2 h-2 rounded-full bg-primary-500 typing-dot" />
                        <span className="w-2 h-2 rounded-full bg-primary-500 typing-dot" style={{ animationDelay: '0.2s' }} />
                        <span className="w-2 h-2 rounded-full bg-primary-500 typing-dot" style={{ animationDelay: '0.4s' }} />
                      </div>
                    ) : (isTyping || isFastStream) ? (
                      /* Revealing text: typewriter or fast-mode stream */
                      <p className="whitespace-pre-wrap leading-relaxed text-gray-200">
                        {msg.content}
                        <span className="stream-cursor text-primary-500" />
                      </p>
                    ) : (
                      /* Finished: full markdown render */
                      <div className="prose prose-sm">
                        <ReactMarkdown
                          components={{
                            code({ className, children }) {
                              const lang = /language-(\w+)/.exec(className || '')?.[1]
                              return lang ? (
                                <SyntaxHighlighter style={oneDark as any} language={lang} PreTag="div">
                                  {String(children).replace(/\n$/, '')}
                                </SyntaxHighlighter>
                              ) : (
                                <code className={className}>{children}</code>
                              )
                            },
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}

                    {/* Citations — only after reveal is complete */}
                    {!isThinking && !isTyping && !isFastStream && msg.citations && msg.citations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-800 not-prose">
                        <p className="text-xs text-gray-500 mb-2 flex items-center gap-1.5">
                          <FileText className="w-3 h-3" />
                          Sources
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
                  </div>
                ) : (
                  <div className="max-w-2xl rounded-2xl px-4 py-3 text-sm bg-primary-600 text-white rounded-tr-none">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                )}
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-gray-800 bg-gray-900">
          <div className="flex items-end gap-2 max-w-4xl mx-auto">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message… (Enter to send, Shift+Enter for newline)"
              rows={1}
              style={{ maxHeight: '200px' }}
              className="input flex-1 resize-none leading-relaxed"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || streamPhase !== 'idle' || sending}
              className="btn-primary px-3 py-2.5 flex-shrink-0"
            >
              {sending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
