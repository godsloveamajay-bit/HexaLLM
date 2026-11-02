import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Hexagon, Cpu, Code2, Github, Twitter, Check, ArrowRight,
} from 'lucide-react'
import { Logo as BrandLogo } from '../components/Logo'
import Reveal from '../components/ui/Reveal'

/* ─────────────────────────────────────────────────────────────────────────────
   HexaLLM Brand Landing — Palette:
   Hex Black #0D0D0D · Hex White #FFFFFF · Hex Graphite #1A1A1A · Hex Silver #C8C8C8
   Hex Cyan #4FF3FF · Hex Violet #A78BFA · Hex Blue #3B82F6
   Hex Slate #334155 · Hex Charcoal #0F172A · Hex Fog #E5E7EB
   ─────────────────────────────────────────────────────────────────────────────*/

const HEX_TILE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100' viewBox='0 0 56 100'%3E%3Cg fill='none' stroke='%234FF3FF' stroke-opacity='0.14' stroke-width='1'%3E%3Cpath d='M28 66L0 50V18l28-16 28 16v32L28 66z'/%3E%3Cpath d='M28 0l28 16v32L28 64 0 48V16L28 0z'/%3E%3Cpath d='M28 100l28-16V52L28 68 0 52v32L28 100z'/%3E%3Cpath d='M28 34l28 16v32L28 98l-28-16V50l28-16z'/%3E%3C/g%3E%3C/svg%3E"

const FAMILIES = [
  {
    series: 'hex-4',
    blurb: 'Everyday intelligence — chat, code and vision.',
    variants: ['hex-4.2-code', 'hex-4.2-turbo', 'hex-4.3-write', 'hex-4.1-vision', 'hex-4.2-math'],
  },
  {
    series: 'hex-5',
    blurb: 'Prime-tier adaptive models that self-route per task.',
    variants: ['hex-5.1-prime'],
  },
  {
    series: 'hex-6',
    blurb: 'Deep reasoning with deliberate, step-by-step thought.',
    variants: ['hex-6.0-reason'],
  },
]

const CATALOG = [
  {
    name: 'hex-4.2-turbo',
    tag: 'Everyday',
    blurb: 'Fast, fluid conversation for day-to-day work.',
    caps: ['Instant, low-latency responses', '7B model · GPU accelerated', '8k context window'],
  },
  {
    name: 'hex-4.1-vision',
    tag: 'Multimodal',
    blurb: 'Understands screenshots, diagrams and imagery.',
    caps: ['Image understanding & captions', '11B vision model', 'Documents & photos ready'],
  },
  {
    name: 'hex-5.1-prime',
    tag: 'Adaptive',
    blurb: 'Automatically picks the best engine for the job.',
    caps: ['Smart per-task routing', 'Code, chat and writing', 'Quality-tuned defaults'],
  },
  {
    name: 'hex-6.0-reason',
    tag: 'Deep Think',
    blurb: 'Deliberate reasoning with visible chain-of-thought.',
    caps: ['Step-by-step analysis', '8B reasoning model', 'Handles hard multi-part tasks'],
  },
]

const FEATURES = [
  {
    icon: Cpu,
    title: 'HexaCore',
    text: 'The engine powering HexaLLM. Local, GPU-accelerated inference tuned for a single powerful host.',
  },
  {
    icon: Code2,
    title: 'HexaAPI',
    text: 'Developer-friendly access to all hex models via a clean, OpenAI-compatible API.',
  },
]

type ApiTab = 'python' | 'js' | 'curl'

const TABS: { id: ApiTab; label: string }[] = [
  { id: 'python', label: 'Python' },
  { id: 'js', label: 'JS' },
  { id: 'curl', label: 'cURL' },
]

const API_SAMPLES: Record<ApiTab, string[]> = {
  python: [
    'from openai import OpenAI',
    '',
    'client = OpenAI(',
    '    base_url="https://ai.hexallm.co.uk/v1",',
    '    api_key=os.environ["HEXA_API_KEY"],',
    ')',
    '',
    'response = client.chat.completions.create(',
    '    model="hex-4.2-turbo",',
    '    messages=[{"role": "user", "content": "Hello"}],',
    ')',
    '',
    'print(response.choices[0].message.content)',
  ],
  js: [
    'import OpenAI from "openai";',
    '',
    'const client = new OpenAI({',
    '  baseURL: "https://ai.hexallm.co.uk/v1",',
    '  apiKey: process.env.HEXA_API_KEY,',
    '});',
    '',
    'const completion = await client.chat.completions.create({',
    '  model: "hex-4.2-turbo",',
    '  messages: [{ role: "user", content: "Hello" }],',
    '});',
    '',
    'console.log(completion.choices[0].message.content);',
  ],
  curl: [
    'curl https://ai.hexallm.co.uk/v1/chat/completions \\',
    '  -H "Authorization: Bearer $HEXA_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    "  -d '{",
    '    "model": "hex-4.2-turbo",',
    '    "messages": [{"role": "user", "content": "Hello"}]',
    "  }'",
  ],
}

const TOKEN_RE = /("(?:\\.|[^"\\])*"|https?:\/\/[^\s\\]+|\b(?:from|import|await|new)\b)/g

function highlight(line: string, key: number) {
  const out: React.ReactNode[] = []
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(line))) {
    if (m.index > last) out.push(<span key={i++} className="text-[#E5E7EB]">{line.slice(last, m.index)}</span>)
    const t = m[0]
    if (t.startsWith('http')) out.push(<span key={i++} className="text-energy-400">{t}</span>)
    else if (t.startsWith('"')) {
      out.push(
        <span key={i++} className={t.includes('hex-') ? 'text-primary-400' : 'text-secondary-400'}>{t}</span>,
      )
    } else {
      out.push(<span key={i++} className="text-primary-400">{t}</span>)
    }
    last = m.index + t.length
  }
  if (last < line.length) out.push(<span key={i++} className="text-[#E5E7EB]">{line.slice(last)}</span>)
  return <div key={key} className="whitespace-pre">{out}</div>
}

function Logo({ size = 36 }: { size?: number }) {
  return <BrandLogo size={size} textClassName="text-white text-lg" />
}

export default function LandingPage() {
  const [tab, setTab] = useState<ApiTab>('python')

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 antialiased">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b border-gray-800/70 bg-gray-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Logo size={28} />
          <nav className="hidden items-center gap-6 text-sm text-gray-400 md:flex">
            <a href="#features" className="hover:text-gray-100">Features</a>
            <a href="#models" className="hover:text-gray-100">Models</a>
            <a href="#api" className="hover:text-gray-100">API</a>
            <Link to="/downloads" className="hover:text-gray-100">Downloads</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-gray-400 hover:text-gray-100">Sign in</Link>
            <Link to="/register" className="rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-400">
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="text-sm font-medium text-primary-400">HexaLLM</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-6xl">
              Local AI, presented like a product.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-gray-400">
              Chat, agents, workflows, and an OpenAI-compatible API on your own host. Fast models, private data, and tools you control.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" className="rounded-md bg-primary-500 px-5 py-3 text-sm font-medium text-white hover:bg-primary-400">
                Create account
              </Link>
              <Link to="/login" className="rounded-md border border-gray-700 px-5 py-3 text-sm font-medium text-gray-200 hover:bg-gray-900">
                Sign in
              </Link>
            </div>
          </div>
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4 shadow-2xl">
            <div className="rounded-xl border border-gray-800 bg-gray-950 p-5">
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="h-2 w-2 rounded-full bg-primary-400" />
                HexaLLM chat
              </div>
              <p className="mt-4 text-sm text-gray-300">Summarize this repository and suggest the next refactor.</p>
              <div className="mt-4 rounded-lg bg-gray-900 p-3 text-sm text-gray-400">
                I found 3 hotspots: session state, workflow execution, and agent tool safety. I can patch them now.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-y border-gray-800 bg-gray-900/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">Everything in one workspace.</h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-gray-800 bg-gray-950 p-5">
                <f.icon className="h-5 w-5 text-primary-400" />
                <h3 className="mt-4 font-medium">{f.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-400">{f.text}</p>
              </div>
            ))}
            {FAMILIES.map((f) => (
              <div key={f.series} className="rounded-xl border border-gray-800 bg-gray-950 p-5">
                <p className="font-mono text-sm text-primary-400">{f.series}</p>
                <p className="mt-2 text-sm leading-6 text-gray-400">{f.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Models */}
      <section id="models" className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-primary-400">Models</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">Choose the right engine.</h2>
          </div>
          <Link to="/models" className="text-sm text-gray-400 hover:text-gray-100">View all</Link>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CATALOG.map((m) => (
            <div key={m.name} className="rounded-xl border border-gray-800 bg-gray-900 p-5">
              <p className="font-mono text-sm text-primary-400">{m.name}</p>
              <p className="mt-1 text-xs text-gray-500">{m.tag}</p>
              <p className="mt-3 text-sm text-gray-400">{m.blurb}</p>
              <ul className="mt-4 space-y-2 text-sm text-gray-400">
                {m.caps.map((c) => (
                  <li key={c} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 text-primary-400" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* API */}
      <section id="api" className="border-y border-gray-800 bg-gray-900/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="text-sm font-medium text-primary-400">API</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">OpenAI-compatible from the first request.</h2>
              <p className="mt-4 text-gray-400">Use your existing SDKs. Point the base URL at HexaLLM and start building.</p>
              <Link to="/register" className="mt-8 inline-flex rounded-md bg-primary-500 px-5 py-3 text-sm font-medium text-white hover:bg-primary-400">
                Get an API key
              </Link>
            </div>
            <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950">
              <div className="flex gap-1 border-b border-gray-800 px-4 py-3">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`rounded-md px-3 py-1.5 font-mono text-xs ${tab === t.id ? 'bg-gray-800 text-primary-400' : 'text-gray-500 hover:text-gray-200'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <pre className="overflow-x-auto p-5 font-mono text-xs leading-6 text-gray-300">
                {API_SAMPLES[tab].map((line, i) => highlight(line, i))}
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-10 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Start building with HexaLLM.</h2>
          <p className="mt-3 text-gray-400">Create an account and run your first model in minutes.</p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to="/register" className="rounded-md bg-primary-500 px-5 py-3 text-sm font-medium text-white hover:bg-primary-400">
              Get started
            </Link>
            <Link to="/login" className="rounded-md border border-gray-700 px-5 py-3 text-sm font-medium text-gray-200 hover:bg-gray-900">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
          <Logo size={24} />
          <div className="flex gap-5">
            <a href="https://github.com/HexaLLM" className="hover:text-gray-200">GitHub</a>
            <Link to="/downloads" className="hover:text-gray-200">Downloads</Link>
            <Link to="/login" className="hover:text-gray-200">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
