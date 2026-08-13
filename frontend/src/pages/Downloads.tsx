import { useState, useEffect } from 'react'
import {
  Download, Terminal, Monitor, Smartphone, Package,
  Copy, Check, ChevronRight, Cpu, Apple, Globe, Tag,
  ScrollText, Plus, Wrench, Bug,
} from 'lucide-react'
import { baseURL } from '../lib/api'

const GITHUB_REPO = 'godsloveamajay-bit/hexallm'
const GITHUB_RELEASE_URL = `https://github.com/${GITHUB_REPO}/releases`
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

// ── Types ───────────────────────────────────────────────────────────────────

interface LocalItem {
  filename: string
  name: string
  version: string
  description: string
  platform: string
  type: string
  install_cmd: string
  run_cmd: string
  size_bytes: number
}

interface GHAsset {
  name: string
  browser_download_url: string
  size: number
}

interface GHRelease {
  tag_name: string
  assets: GHAsset[]
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button onClick={copy} className="p-1.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0">
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

function CodeLine({ code, label }: { code: string; label?: string }) {
  return (
    <div className="space-y-1">
      {label && <p className="text-xs text-gray-500">{label}</p>}
      <div className="flex items-center gap-2 bg-gray-950 border border-gray-800 rounded-lg px-3 py-2">
        <span className="text-emerald-400 font-mono text-xs flex-1 break-all">{code}</span>
        <CopyButton text={code} />
      </div>
    </div>
  )
}

function DownloadBtn({ href, size, disabled, children }: {
  href?: string; size?: number; disabled?: boolean; children: React.ReactNode
}) {
  if (disabled || !href) {
    return (
      <button disabled className="btn-secondary w-full justify-center text-xs py-1.5 opacity-40 cursor-not-allowed inline-flex gap-1.5">
        {children}
      </button>
    )
  }
  return (
    <a href={href} download className="btn-primary w-full justify-center text-xs py-1.5 inline-flex gap-1.5">
      {children}
      {size !== undefined && <span className="text-primary-300 text-xs opacity-80">({fmtSize(size)})</span>}
    </a>
  )
}

// ── CLI card ─────────────────────────────────────────────────────────────────

function CliCard({ item }: { item: LocalItem }) {
  return (
    <div className="card space-y-5">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-emerald-900/30 border border-emerald-700/40 flex items-center justify-center flex-shrink-0">
          <Terminal className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-gray-100">{item.name}</h2>
            <span className="badge bg-emerald-900/30 text-emerald-400 border border-emerald-800/40">v{item.version}</span>
            <span className="badge bg-gray-800 text-gray-400">Python wheel</span>
          </div>
          <p className="text-sm text-gray-400 mt-1">{item.description}</p>
        </div>
        <a
          href={`${baseURL}/downloads/${encodeURIComponent(item.filename)}`}
          download={item.filename}
          className="btn-primary gap-2 flex-shrink-0 text-sm"
        >
          <Download className="w-4 h-4" />
          Download
          <span className="text-primary-300 text-xs">({fmtSize(item.size_bytes)})</span>
        </a>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Installation</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-2 bg-gray-900/50 rounded-xl p-3 border border-gray-800">
            <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-primary-400" />From PyPI
              <span className="ml-auto text-xs text-gray-500">v{item.version}</span>
            </p>
            <CodeLine code={`pip install hexallm==${item.version}`} />
            <p className="text-xs text-gray-600">Already installed? <span className="font-mono text-gray-500">pip install --force-reinstall hexallm=={item.version}</span></p>
          </div>
          <div className="space-y-2 bg-gray-900/50 rounded-xl p-3 border border-gray-800">
            <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5 text-emerald-400" />From downloaded file
            </p>
            <CodeLine code={`pip install ${item.filename}`} />
          </div>
        </div>

        {/* Windows PATH note */}
        <details className="group">
          <summary className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors list-none select-none">
            <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform" />
            Windows: <code className="font-mono ml-1">hexallm</code> not found after install?
          </summary>
          <div className="mt-2 space-y-2 pl-5">
            <p className="text-xs text-gray-400">
              pip installs the <code className="font-mono text-gray-300">hexallm</code> command to your user Scripts folder
              (<code className="font-mono text-gray-300">%APPDATA%\Python\Python3XX\Scripts</code>), which isn't on PATH by default.
              Run this once in PowerShell to fix it permanently:
            </p>
            <CodeLine code={`$s = python -c "import sysconfig; print(sysconfig.get_path('scripts', 'nt_user'))"\n[Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";$s", "User")\n$env:PATH += ";$s"`} />
            <p className="text-xs text-gray-500">Open a new PowerShell window and run <code className="font-mono text-emerald-400">hexallm</code>.</p>
          </div>
        </details>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-1">Quick start</p>
          <CodeLine code="hexallm login https://ai.hexallm.co.uk --google" label="1a. Connect with Google (opens browser)" />
          <CodeLine code="hexallm login https://ai.hexallm.co.uk" label="1b. Connect with email + password" />
          <CodeLine code="hexallm" label="2. Start the interactive coding session" />
          <CodeLine code="hexallm daemon" label="3. (Optional) Run as a remote-control daemon" />
        </div>
        <details className="group">
          <summary className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors list-none select-none mt-1">
            <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform" />
            What can HexaLLM do?
          </summary>
          <ul className="mt-2 pl-5 space-y-1 text-xs text-gray-400 list-disc">
            <li>ReAct agent loop — reasons and acts step-by-step to complete tasks</li>
            <li>
              <span className="text-gray-300">File tools:</span>{' '}
              {['read_file','write_file','patch_file','list_files','search_files'].map(t => (
                <code key={t} className="text-emerald-400 font-mono mr-1">{t}</code>
              ))}
            </li>
            <li>
              <span className="text-gray-300">Shell &amp; git:</span>{' '}
              {['run_command','git_run'].map(t => (
                <code key={t} className="text-emerald-400 font-mono mr-1">{t}</code>
              ))}
            </li>
            <li>
              <span className="text-gray-300">Web &amp; network:</span>{' '}
              {['web_search','fetch_url','ssh_run'].map(t => (
                <code key={t} className="text-emerald-400 font-mono mr-1">{t}</code>
              ))}
            </li>
            <li>Works out of the box in the cloud — no setup, no API key needed</li>
            <li>Optionally run fully local on your own machine, or connect to your <strong>HexaLLM</strong> instance</li>
            <li>Multi-turn memory — remembers context across your session</li>
            <li>Run <code className="text-emerald-400 font-mono">hexallm daemon</code> to let the HexaLLM web UI send tasks to your machine</li>
          </ul>
        </details>
      </div>
    </div>
  )
}

// ── Desktop card ─────────────────────────────────────────────────────────────

interface PlatformEntry {
  label: string
  badge: string
  icon: React.ReactNode
  installHint: string
  assetPattern: RegExp
}

function DesktopCard({ assets, version }: { assets: GHAsset[]; version: string }) {
  const platforms: PlatformEntry[] = [
    {
      label: 'Linux',
      badge: '.deb',
      icon: <Monitor className="w-4 h-4 text-energy-400" />,
      installHint: 'Debian / Ubuntu x86_64. Run: sudo dpkg -i *.deb',
      assetPattern: /amd64\.deb$/i,
    },
    {
      label: 'Windows',
      badge: '.exe',
      icon: <Monitor className="w-4 h-4 text-secondary-400" />,
      installHint: 'Windows 10 / 11 x64 NSIS installer.',
      assetPattern: /x64-setup\.exe$/i,
    },
    {
      label: 'macOS',
      badge: '.dmg',
      icon: <Apple className="w-4 h-4 text-gray-300" />,
      installHint: 'macOS 11+ universal (Intel + Apple Silicon). Drag to Applications.',
      assetPattern: /universal\.dmg$/i,
    },
  ]

  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary-900/30 border border-primary-700/40 flex items-center justify-center flex-shrink-0">
          <Monitor className="w-6 h-6 text-primary-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-gray-100">HexaLLM Desktop</h2>
            <span className="badge bg-primary-900/30 text-primary-400 border border-primary-800/40">v{version}</span>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Native app for macOS, Windows, and Linux — offline model management, local inference.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {platforms.map(p => {
          const asset = assets.find(a => p.assetPattern.test(a.name))
          return (
            <div key={p.label} className="bg-gray-900/50 rounded-xl p-3 border border-gray-800 space-y-3">
              <div className="flex items-center gap-2">
                {p.icon}
                <span className="text-sm font-medium text-gray-200">{p.label}</span>
                <span className="badge bg-gray-800 text-gray-500 text-xs ml-auto">{p.badge}</span>
              </div>
              <p className="text-xs text-gray-500">{p.installHint}</p>
              <DownloadBtn href={asset?.browser_download_url} size={asset?.size} disabled={!asset}>
                <Download className="w-3.5 h-3.5" />
                {asset ? 'Download' : 'Building…'}
              </DownloadBtn>
            </div>
          )
        })}
      </div>

      {/* macOS first-open guidance — the app isn't notarized yet, so Gatekeeper
          blocks it with "can't be checked for malicious software". */}
      <div className="flex items-start gap-2.5 rounded-xl border border-energy-700/40 bg-energy-900/10 px-3.5 py-3">
        <Apple className="w-4 h-4 text-energy-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-gray-300 space-y-1.5">
          <p className="font-medium text-energy-300">macOS: “can’t be opened / can’t scan for viruses”?</p>
          <p className="text-gray-400">
            The app isn’t Apple-notarized yet, so macOS blocks it on first launch. To open it:
          </p>
          <ul className="list-disc ml-4 space-y-1 text-gray-400">
            <li>Drag <span className="text-gray-200">HexaLLM</span> to Applications, then <span className="text-gray-200">right-click it → Open → Open</span> (only needed once), or</li>
            <li>run this once in Terminal:
              <code className="block mt-1 bg-gray-900 border border-gray-700/60 rounded-lg px-2 py-1 font-mono text-emerald-400 select-all">
                xattr -dr com.apple.quarantine "/Applications/HexaLLM.app"
              </code>
            </li>
          </ul>
          <p className="text-gray-500">It’s safe — this just clears the “downloaded from the internet” quarantine flag.</p>
        </div>
      </div>

      <details className="group">
        <summary className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors list-none select-none">
          <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform" />
          All release assets on GitHub
        </summary>
        <div className="mt-2 pl-5">
          <a href={GITHUB_RELEASE_URL} target="_blank" rel="noopener noreferrer"
            className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1.5">
            <Globe className="w-3 h-3" />{GITHUB_RELEASE_URL}
          </a>
        </div>
      </details>
    </div>
  )
}

// ── Mobile card ───────────────────────────────────────────────────────────────

function MobileCard({ assets, version }: { assets: GHAsset[]; version: string }) {
  const androidAsset = assets.find(a => /android\.apk$/i.test(a.name))

  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary-900/30 border border-primary-700/40 flex items-center justify-center flex-shrink-0">
          <Smartphone className="w-6 h-6 text-primary-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-gray-100">HexaLLM Mobile</h2>
            <span className="badge bg-primary-900/30 text-primary-400 border border-primary-800/40">v{version}</span>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Chat with your models on the go. Available on iOS and Android.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="bg-gray-900/50 rounded-xl p-3 border border-gray-800 space-y-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-green-400" />
            <span className="text-sm font-medium text-gray-200">Android</span>
            <span className="badge bg-gray-800 text-gray-500 text-xs ml-auto">.apk</span>
          </div>
          <p className="text-xs text-gray-500">Requires Android 7.0+. Enable "Install unknown apps" first.</p>
          <DownloadBtn href={androidAsset?.browser_download_url} size={androidAsset?.size} disabled={!androidAsset}>
            <Download className="w-3.5 h-3.5" />
            {androidAsset ? 'Download APK' : 'Building…'}
          </DownloadBtn>
        </div>
        <div className="bg-gray-900/50 rounded-xl p-3 border border-gray-800 space-y-3">
          <div className="flex items-center gap-2">
            <Apple className="w-4 h-4 text-gray-300" />
            <span className="text-sm font-medium text-gray-200">iOS</span>
            <span className="badge bg-gray-800 text-gray-500 text-xs ml-auto">App Store</span>
          </div>
          <p className="text-xs text-gray-600">Requires iOS 14+. Submit via Xcode with Apple Developer account.</p>
          <DownloadBtn disabled>
            <Download className="w-3.5 h-3.5" />Coming soon
          </DownloadBtn>
        </div>
      </div>
    </div>
  )
}

// ── Changelog ─────────────────────────────────────────────────────────────────

type ChangeType = 'new' | 'improved' | 'fixed'

interface ChangeEntry {
  type: ChangeType
  text: string
}

interface Release {
  version: string
  date: string
  summary: string
  changes: ChangeEntry[]
}

const CHANGELOG: Release[] = [
  {
    version: '14.0.2',
    date: '2026-06-06',
    summary: 'Web search is dramatically faster and shows live progress instead of looking stuck.',
    changes: [
      { type: 'fixed',    text: 'Web search no longer appears to hang — answers come back ~3× faster and a live “Searching the web → Reading sources (m:ss)” timer shows it’s working' },
      { type: 'improved', text: 'Web-grounded answers are routed to a fast model and use fewer, tighter sources, so the first words arrive much sooner' },
    ],
  },
  {
    version: '0.13.2',
    date: '2026-06-05',
    summary: 'Web search actually grounds answers now, and reasoning models get room to think.',
    changes: [
      { type: 'fixed',    text: 'With web search on, models no longer insist they “can’t browse” or cite a 2023 cutoff — they now use the live results (with today’s date) and cite sources' },
      { type: 'improved', text: 'Bigger context window for chat (reasoning models get extra room and a higher output cap) so long chains of thought aren’t cut off mid-reasoning' },
    ],
  },
  {
    version: '0.13.1',
    date: '2026-06-05',
    summary: 'Stability fix for custom configuration.',
    changes: [
      { type: 'fixed', text: 'No longer fails to start when the configuration contains a setting it doesn’t recognise' },
    ],
  },
  {
    version: '0.13.0',
    date: '2026-06-05',
    summary: 'Web search in chat — answers grounded in live sources — plus a livelier “thinking” status.',
    changes: [
      { type: 'new',      text: 'Web search: toggle “Web” in a chat to ground answers in live results, with clickable source citations' },
      { type: 'new',      text: 'A status label next to the assistant cycles playful verbs (Thinking, Pondering, Reasoning, Cooking…) and shows “Searching the web” while it searches' },
      { type: 'improved', text: 'The thinking indicator now appears on every turn, including with reasoning models' },
    ],
  },
  {
    version: '0.12.1',
    date: '2026-06-05',
    summary: 'Chat quality-of-life fixes — scroll, stop, regenerate — plus persona duplication.',
    changes: [
      { type: 'fixed',    text: 'Chat no longer yanks you back to the bottom while you scroll up to read earlier messages during a reply' },
      { type: 'new',      text: '“Jump to latest” button appears when you’ve scrolled up during a streaming reply' },
      { type: 'new',      text: 'Press Esc to stop a generation in progress' },
      { type: 'fixed',    text: 'Regenerating an answer no longer duplicates the turn in your saved chat history' },
      { type: 'new',      text: 'Duplicate any of your own personas to tweak a copy (with its personality and settings)' },
    ],
  },
  {
    version: '0.12.0',
    date: '2026-06-05',
    summary: 'A personality engine for your models, a visual knowledge graph, AI-written tools, and a one-click OpenAI-compatible API — plus daemon-chat fixes.',
    changes: [
      { type: 'new',      text: 'Model Personality Engine: six sliders (creativity, formality, risk, verbosity, empathy, logic vs intuition) that shape the model’s voice and sampling — in chat, personas, and your exposed API' },
      { type: 'new',      text: 'Knowledge Graph: an interactive force-directed view of how the AI stores and connects knowledge — bases, documents, chunks and memories, linked by meaning' },
      { type: 'new',      text: 'AI Tools: the AI writes its own tools (you review, test and approve them); approved tools run sandboxed and are selectable in Agents' },
      { type: 'new',      text: 'Expose as API: turn any model or persona into an OpenAI-compatible endpoint with a dedicated key and per-key usage metering, on a clean /v1 base URL' },
      { type: 'fixed',    text: 'Chatting with a connected HexaLLM daemon no longer hangs on “Agent Thinking…” — the stream stays alive and reasoning models parse their tool calls' },
      { type: 'fixed',    text: 'The thinking indicator now shows on every turn, not just the first' },
      { type: 'improved', text: 'Docker code sandbox fixed (workspaces moved off the service’s private /tmp), which also repaired agent code execution' },
    ],
  },
  {
    version: '0.11.0',
    date: '2026-06-04',
    summary: 'Agents & workflows actually run now — plus a visual flow debugger that shows every step, its token cost, and exactly where a run broke.',
    changes: [
      { type: 'fixed',    text: 'Agents and workflows were producing no output — runs now complete and always return an answer' },
      { type: 'new',      text: 'Agent Flow Debugger: a visual trace of each run (reasoning → tool → result) with per-step token cost, timing, and the failing step highlighted' },
      { type: 'improved', text: 'Reasoning models and chat models that reply in prose now work as agents instead of stalling' },
      { type: 'improved', text: 'Agent runs that hit the step limit now synthesise a best-effort answer instead of finishing empty' },
      { type: 'improved', text: 'The agent/workflow model picker hides models that can’t chat and defaults to a capable one' },
      { type: 'improved', text: 'Agent & workflow token usage now rolls up into your Analytics totals' },
    ],
  },
  {
    version: '0.10.2',
    date: '2026-06-03',
    summary: 'The new app icon now ships on Android too.',
    changes: [
      { type: 'fixed', text: 'Android app icon now shows the new sparkle — the APK was still bundling the old blue mark' },
    ],
  },
  {
    version: '0.10.1',
    date: '2026-06-03',
    summary: 'A fresh app icon that matches the cosy HexaLLM look.',
    changes: [
      { type: 'improved', text: 'New app icon — the warm sparkle from the app, across desktop, mobile, and the browser tab' },
    ],
  },
  {
    version: '0.10.0',
    date: '2026-06-03',
    summary: 'Chat as a guest, a full AI settings panel, on-device voice typing, and smoother streaming.',
    changes: [
      { type: 'new',      text: 'Try the chat without an account — guests get a daily free-token allowance' },
      { type: 'new',      text: 'AI Assistant settings: custom instructions, default model, creativity, max response length, default knowledge base, and a reasoning on/off toggle' },
      { type: 'new',      text: 'Voice input now uses on-device Whisper transcription — reliable, and works in every browser' },
      { type: 'improved', text: 'Smoother, steadier text as replies stream in' },
      { type: 'fixed',    text: 'Sending the first message in a brand-new chat no longer occasionally does nothing' },
    ],
  },
  {
    version: '0.9.1',
    date: '2026-06-02',
    summary: 'Text-to-video in chat, and a fix for collapsed multi-line replies.',
    changes: [
      { type: 'new',   text: 'Generate short videos in any chat — "generate a video of …" or /video' },
      { type: 'fixed', text: 'Streamed replies and the reasoning drawer no longer collapse onto a single line (lost line breaks)' },
    ],
  },
  {
    version: '0.9.0',
    date: '2026-06-02',
    summary: 'Personalise everything — system theme, full-text chat search, and pinned personas.',
    changes: [
      { type: 'new',      text: 'System theme option that follows your OS light/dark setting automatically' },
      { type: 'new',      text: 'Search across the full text of every conversation, with matching snippets' },
      { type: 'new',      text: 'Pin favourite personas to the top and see per-persona usage stats' },
      { type: 'improved', text: 'Appearance settings panel with Light / Dark / System' },
    ],
  },
  {
    version: '0.8.0',
    date: '2026-06-01',
    summary: 'Live streaming, faster replies, and a warm new look across every app.',
    changes: [
      { type: 'new',      text: 'Live token streaming — responses render as they generate' },
      { type: 'new',      text: 'Animated AI sparkle while the assistant is thinking' },
      { type: 'improved', text: 'Direct-prose answers skip the old double-generation pass — much faster first token' },
      { type: 'improved', text: 'Trivial prompts skip the thinking phase entirely' },
      { type: 'improved', text: 'Refreshed warm "sunset" theme with light & dark modes' },
      { type: 'fixed',    text: 'Editable installs no longer run a stale copy — hexallm always uses the installed build' },
      { type: 'fixed',    text: 'Downloads page now always serves the latest CLI wheel' },
    ],
  },
  {
    version: '0.7.0',
    date: '2026-05-26',
    summary: 'Works out of the box — no setup or API key required.',
    changes: [
      { type: 'new',      text: 'Free cloud inference — start chatting with zero setup' },
      { type: 'new',      text: 'Smart routing — your HexaLLM instance or a local runtime when available, otherwise the free cloud' },
      { type: 'new',      text: 'web_search tool — search the web via DuckDuckGo, no API key' },
      { type: 'new',      text: 'fetch_url tool — download and read any URL as plain text' },
      { type: 'new',      text: 'git_run tool — run git commands (status, diff, log, commit…)' },
      { type: 'new',      text: 'ssh_run tool — run commands on remote hosts over SSH' },
      { type: 'improved', text: 'Welcome panel shows where inference is running in a distinct colour' },
      { type: 'improved', text: '/help updated with runtime switching and tool summary' },
      { type: 'improved', text: 'Pin where the CLI runs inference — cloud, local, or auto' },
    ],
  },
  {
    version: '0.6.0',
    date: '2026-05-24',
    summary: 'First public release on PyPI.',
    changes: [
      { type: 'new',      text: 'Published to PyPI — pip install hexallm' },
      { type: 'new',      text: 'Renamed from "Nebula Code" to NebulaCode' },
      { type: 'new',      text: 'ReAct agent loop with multi-turn conversation memory' },
      { type: 'new',      text: 'File tools: read_file, write_file, patch_file, list_files, search_files' },
      { type: 'new',      text: 'run_command — run any shell command locally' },
      { type: 'new',      text: 'hexallm daemon — accept tasks dispatched from the HexaLLM web UI' },
      { type: 'new',      text: 'hexallm login / logout — connect to a HexaLLM instance' },
      { type: 'new',      text: 'Knowledge base search via /use-kb in interactive mode' },
    ],
  },
]

const CHANGE_META: Record<ChangeType, { label: string; color: string; icon: React.ReactNode }> = {
  new:      { label: 'New',      color: 'text-emerald-400 bg-emerald-900/30 border-emerald-800/40', icon: <Plus className="w-3 h-3" /> },
  improved: { label: 'Improved', color: 'text-primary-400 bg-primary-900/30 border-primary-800/40', icon: <Wrench className="w-3 h-3" /> },
  fixed:    { label: 'Fixed',    color: 'text-yellow-400 bg-yellow-900/30 border-yellow-800/40',    icon: <Bug className="w-3 h-3" /> },
}

function ChangelogSection() {
  const [open, setOpen] = useState<string | null>(CHANGELOG[0].version)

  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <ScrollText className="w-4 h-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-200">Changelog</h2>
        <span className="text-xs text-gray-600 ml-auto">HexaLLM CLI</span>
      </div>

      <div className="space-y-2">
        {CHANGELOG.map((rel) => {
          const isOpen = open === rel.version
          return (
            <div key={rel.version} className="border border-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : rel.version)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/40 transition-colors text-left"
              >
                <ChevronRight className={`w-3.5 h-3.5 text-gray-500 transition-transform flex-shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
                <span className="font-mono text-sm font-semibold text-gray-100">v{rel.version}</span>
                <span className="text-xs text-gray-500">{rel.date}</span>
                {rel.version === CHANGELOG[0].version && (
                  <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-primary-900/40 text-primary-400 border border-primary-800/40">latest</span>
                )}
                <span className="ml-auto text-xs text-gray-500 hidden sm:block truncate max-w-xs">{rel.summary}</span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-1 space-y-2 border-t border-gray-800">
                  <p className="text-xs text-gray-400 mb-3">{rel.summary}</p>
                  <div className="space-y-1.5">
                    {rel.changes.map((c, i) => {
                      const meta = CHANGE_META[c.type]
                      return (
                        <div key={i} className="flex items-start gap-2.5">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs font-medium flex-shrink-0 mt-0.5 ${meta.color}`}>
                            {meta.icon}{meta.label}
                          </span>
                          <span className="text-xs text-gray-300">{c.text}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DownloadsPage() {
  const [localItems, setLocalItems] = useState<LocalItem[]>([])
  const [release, setRelease] = useState<GHRelease | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const localFetch = fetch(`${baseURL}/downloads`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    }).then(r => r.json()).catch(() => [])

    const ghFetch = fetch(GITHUB_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    }).then(r => r.json()).catch(() => null)

    Promise.all([localFetch, ghFetch]).then(([local, gh]) => {
      setLocalItems(Array.isArray(local) ? local : [])
      setRelease(gh?.tag_name ? gh : null)
      setLoading(false)
    })
  }, [])

  const version = release?.tag_name?.replace(/^v/, '') ?? '14.0.2'
  const ghAssets: GHAsset[] = release?.assets ?? []
  const cliItems = localItems.filter(i => i.type === 'python-wheel')

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
            <Download className="w-6 h-6 text-primary-400" />Downloads
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Install HexaLLM apps and tools on your devices.
          </p>
        </div>
        {release && (
          <a href={`${GITHUB_RELEASE_URL}/tag/${release.tag_name}`}
            target="_blank" rel="noopener noreferrer"
            className="badge bg-gray-800 text-gray-400 border border-gray-700 hover:text-gray-200 transition-colors flex items-center gap-1.5 text-xs py-1.5 px-2.5 flex-shrink-0">
            <Tag className="w-3 h-3" />v{version}
          </a>
        )}
      </div>

      {/* CLI */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5" />Terminal
        </h2>
        {loading ? (
          <div className="card flex items-center gap-3 text-gray-500">
            <Cpu className="w-4 h-4 animate-spin" />Loading…
          </div>
        ) : cliItems.length === 0 ? (
          <div className="card text-sm text-gray-500">No CLI packages available yet.</div>
        ) : (
          cliItems.map(item => <CliCard key={item.filename} item={item} />)
        )}
      </section>

      {/* Desktop */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
          <Monitor className="w-3.5 h-3.5" />Desktop
        </h2>
        {loading ? (
          <div className="card flex items-center gap-3 text-gray-500">
            <Cpu className="w-4 h-4 animate-spin" />Loading…
          </div>
        ) : (
          <DesktopCard assets={ghAssets} version={version} />
        )}
      </section>

      {/* Mobile */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
          <Smartphone className="w-3.5 h-3.5" />Mobile
        </h2>
        {loading ? (
          <div className="card flex items-center gap-3 text-gray-500">
            <Cpu className="w-4 h-4 animate-spin" />Loading…
          </div>
        ) : (
          <MobileCard assets={ghAssets} version={version} />
        )}
      </section>

      {/* Changelog */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
          <ScrollText className="w-3.5 h-3.5" />Changelog
        </h2>
        <ChangelogSection />
      </section>
    </div>
  )
}
