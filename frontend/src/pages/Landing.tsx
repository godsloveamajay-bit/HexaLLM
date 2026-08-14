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
    <div className="scroll-smooth bg-[#0D0D0D] text-white antialiased py-2 sm:py-3 space-y-2 sm:space-y-3">
      {/* ═══ 1 · HERO — Hex Black + Hex Cyan ═══ */}
      <header className="relative min-h-screen flex flex-col overflow-hidden bg-[#0D0D0D] mx-2 sm:mx-4 rounded-[2rem]">
        <div
          className="absolute inset-0 opacity-60 bg-drift"
          style={{ backgroundImage: `url("${HEX_TILE}")`, backgroundSize: '56px 100px' }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0D0D0D]/60 to-[#0D0D0D]" aria-hidden />
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[42rem] h-[42rem] rounded-full bg-primary-400/10 blur-3xl glow-breathe"
          aria-hidden
        />

        <nav className="relative z-10 mx-auto w-full max-w-6xl px-6 py-6 flex items-center justify-between hero-rise">
          <Logo />
          <div className="hidden md:flex items-center gap-8 text-sm text-[#C8C8C8]">
            <a href="#families" className="hover:text-primary-400 transition-colors">Models</a>
            <a href="#features" className="hover:text-primary-400 transition-colors">Features</a>
            <a href="#api" className="hover:text-primary-400 transition-colors">API</a>
            <a href="#catalog" className="hover:text-primary-400 transition-colors">Catalog</a>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-[#C8C8C8] hover:text-white transition-colors">
              Sign in
            </Link>
            <Link
              to="/register"
              className="text-sm font-medium px-4 py-2 rounded-lg bg-[#4FF3FF] text-[#0D0D0D] hover:bg-[#7ff8ff] shadow-lg shadow-primary-400/25 transition-all"
            >
              Get Started
            </Link>
          </div>
        </nav>

        <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 pb-24">
          <div className="relative mb-8 float-y">
            <div className="absolute inset-0 rounded-full bg-primary-400/20 blur-2xl scale-150 glow-breathe" aria-hidden />
            <Hexagon className="relative text-primary-400 w-16 h-16 hero-rise" strokeWidth={1} />
          </div>
          <h1 className="font-display font-bold tracking-tight text-4xl sm:text-6xl lg:text-7xl leading-tight hero-rise hero-rise-1">
            Frontier Intelligence.
            <br />
            Minimal Design. <span className="text-primary-400">HexaLLM.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-[#C8C8C8] hero-rise hero-rise-2">
            A premium AI ecosystem built on geometric precision and modular intelligence.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4 hero-rise hero-rise-3">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 px-7 py-3 rounded-lg font-semibold bg-[#4FF3FF] text-[#0D0D0D] hover:bg-[#7ff8ff] shadow-lg shadow-primary-400/30 transition-all hover:-translate-y-0.5 active:scale-95"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="#catalog"
              className="inline-flex items-center gap-2 px-7 py-3 rounded-lg font-semibold bg-[#3B82F6] text-white hover:bg-[#60a5fa] shadow-lg shadow-energy-500/30 transition-all hover:-translate-y-0.5 active:scale-95"
            >
              View Models
            </a>
          </div>
        </div>
      </header>

      {/* ═══ 2 · MODEL OVERVIEW — White section, Graphite cards ═══ */}
      <section id="families" className="mx-2 sm:mx-4 rounded-[2rem] overflow-hidden bg-[#FFFFFF] text-[#0F172A] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <p className="font-mono text-sm tracking-widest uppercase text-[#3B82F6]">Model Families</p>
            <h2 className="mt-3 font-display font-bold text-3xl sm:text-4xl tracking-tight">
              One host. Every tier of intelligence.
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {FAMILIES.map((f, i) => (
              <Reveal key={f.series} delay={i * 90}>
                <div
                  className="group rounded-2xl border border-[#E5E7EB] bg-[#1A1A1A] p-7 shadow-sm hover:border-primary-400 hover:shadow-[0_0_24px_rgba(79,243,255,0.25)] transition-all duration-300 hover:-translate-y-1"
                >
                  <p className="font-mono text-2xl text-primary-400">{f.series}</p>
                  <p className="mt-2 text-sm text-[#C8C8C8]">{f.blurb}</p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {f.variants.map((v) => (
                      <span key={v} className="font-mono text-xs px-2.5 py-1 rounded-md bg-white/10 text-[#E5E7EB] border border-white/10">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 3 · FEATURE HIGHLIGHTS — Slate background ═══ */}
      <section id="features" className="mx-2 sm:mx-4 rounded-[2rem] overflow-hidden bg-[#334155] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <h2 className="font-display font-bold text-3xl sm:text-4xl tracking-tight text-center">
              Built in two geometric parts.
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-8 md:grid-cols-2 max-w-3xl mx-auto">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 100}>
                <div className="group text-center md:text-left">
                  <div className="mx-auto md:mx-0 w-14 h-14 rounded-xl border border-white/20 bg-white/5 flex items-center justify-center transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_8px_24px_rgba(79,243,255,0.15)]">
                    <f.icon className="w-7 h-7 text-primary-400 group-hover:scale-110 transition-transform" strokeWidth={1.5} />
                  </div>
                  <h3 className="mt-5 font-display font-semibold text-xl">{f.title}</h3>
                  <p className="mt-2 text-[#E5E7EB]/90 leading-relaxed">{f.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 4 · MODEL CARDS — Charcoal background ═══ */}
      <section id="catalog" className="mx-2 sm:mx-4 rounded-[2rem] overflow-hidden bg-[#0F172A] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <p className="font-mono text-sm tracking-widest uppercase text-[#4FF3FF] text-center">The Catalog</p>
            <h2 className="mt-3 font-display font-bold text-3xl sm:text-4xl tracking-tight text-center">
              Choose your model.
            </h2>
          </Reveal>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {CATALOG.map((m, i) => (
              <Reveal key={m.name} delay={i * 80}>
                <div
                  className="group rounded-2xl border border-white/10 bg-[#1A1A1A] overflow-hidden hover:border-primary-400/50 hover:shadow-[0_0_28px_rgba(79,243,255,0.18)] transition-all duration-300 hover:-translate-y-1"
                >
                  <div className="h-1 bg-gradient-to-r from-primary-400 to-transparent transition-all duration-300 group-hover:from-primary-400 group-hover:to-primary-400" />
                  <div className="p-6">
                    <p className="font-mono text-[#4FF3FF]">{m.name}</p>
                    <p className="mt-1 font-mono text-[10px] tracking-widest uppercase text-[#A78BFA]">{m.tag}</p>
                    <p className="mt-3 text-sm text-[#C8C8C8]">{m.blurb}</p>
                    <ul className="mt-4 space-y-2">
                      {m.caps.map((c) => (
                        <li key={c} className="flex items-start gap-2 text-sm text-[#E5E7EB]">
                          <Check className="w-4 h-4 mt-0.5 text-primary-400 shrink-0" />
                          {c}
                        </li>
                      ))}
                    </ul>
                    <Link
                      to="/models"
                      className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-primary-400 hover:text-primary-300 transition-colors group-hover:gap-2.5"
                    >
                      View Model Card <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </Link>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 5 · API DOCUMENTATION PREVIEW — White section, dark code block ═══ */}
      <section id="api" className="mx-2 sm:mx-4 rounded-[2rem] overflow-hidden bg-[#FFFFFF] text-[#0F172A] py-20">
        <div className="mx-auto max-w-6xl px-6 grid gap-12 lg:grid-cols-2 items-center">
          <Reveal>
            <p className="font-mono text-sm tracking-widest uppercase text-[#3B82F6]">HexaAPI</p>
            <h2 className="mt-3 font-display font-bold text-3xl sm:text-4xl tracking-tight">
              Three lines to your first completion.
            </h2>
            <p className="mt-4 text-[#334155] leading-relaxed">
              Every hex model speaks the OpenAI-compatible protocol. Swap the base URL, drop in your API
              key, and the full catalog is yours — from <span className="font-mono text-sm">hex-4.2-turbo</span>{' '}
              chat to <span className="font-mono text-sm">hex-6.0-reason</span> deep thinking.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-[#334155]">
              {[
                'OpenAI-compatible — use your existing tooling',
                'Runs on your own GPU, behind your own tunnel',
                'Per-model streaming, tool calls and vision support',
              ].map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <Check className="w-4 h-4 mt-0.5 text-[#4FF3FF] shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
            <Link
              to="/register"
              className="mt-8 inline-flex items-center gap-2 px-6 py-3 rounded-lg font-semibold bg-[#3B82F6] text-white hover:bg-[#60a5fa] transition-all hover:-translate-y-0.5 active:scale-95"
            >
              Get an API key <ArrowRight className="w-4 h-4" />
            </Link>
          </Reveal>

          <Reveal delay={140}>
            <div className="rounded-2xl bg-[#0D0D0D] shadow-2xl overflow-hidden">
              <div className="flex items-center gap-1 px-4 py-3 border-b border-white/10">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`font-mono text-xs px-3 py-1.5 rounded-md transition-colors ${
                      tab === t.id
                        ? 'bg-white/10 text-[#4FF3FF]'
                        : 'text-[#C8C8C8] hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#A78BFA]/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6]/60" />
                </div>
              </div>
              <pre className="p-5 font-mono text-[13px] leading-7 overflow-x-auto fade-in" key={tab}>
                {API_SAMPLES[tab].map((line, i) => highlight(line, i))}
              </pre>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══ 6 · FOOTER — Hex Black ═══ */}
      <footer className="mx-2 sm:mx-4 rounded-[2rem] overflow-hidden bg-[#0D0D0D] border border-white/5">
        <div className="mx-auto max-w-6xl px-6 py-14 flex flex-col md:flex-row items-center justify-between gap-8">
          <Reveal><Logo /></Reveal>
          <Reveal delay={80}>
            <nav className="flex flex-wrap items-center justify-center gap-6 text-sm text-[#C8C8C8]">
              <a href="#api" className="hover:text-primary-400 transition-colors">Docs</a>
              <a href="#families" className="hover:text-primary-400 transition-colors">Models</a>
              <a href="#api" className="hover:text-primary-400 transition-colors">API</a>
              <a href="https://github.com/HexaLLM" className="hover:text-primary-400 transition-colors">GitHub</a>
            </nav>
          </Reveal>
          <Reveal delay={160}>
            <div className="flex items-center gap-4 text-[#C8C8C8]">
              <a href="https://github.com/HexaLLM" aria-label="GitHub" className="hover:text-primary-400 transition-colors">
                <Github className="w-5 h-5" />
              </a>
              <a href="https://x.com/hexallm" aria-label="Twitter" className="hover:text-primary-400 transition-colors">
                <Twitter className="w-5 h-5" />
              </a>
            </div>
          </Reveal>
        </div>
        <div className="border-t border-white/5">
          <p className="mx-auto max-w-6xl px-6 py-5 text-xs text-[#C8C8C8]/70 text-center">
            © {new Date().getFullYear()} HexaLLM — Frontier Intelligence. Minimal Design.
          </p>
        </div>
      </footer>
    </div>
  )
}