import { useState, useEffect } from 'react'
import {
  Download, Terminal, Monitor, Smartphone, Package,
  Copy, Check, ChevronRight, Cpu, Apple, Globe,
} from 'lucide-react'
import { baseURL } from '../lib/api'

const VERSION = '0.6.0'

interface DownloadItem {
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

// ── NebulaCode CLI card ─────────────────────────────────────────────────────

function CliCard({ item }: { item: DownloadItem }) {
  const dlUrl = `${baseURL}/downloads/${item.filename}`

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = dlUrl; a.download = item.filename; a.click()
  }

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
        <button onClick={handleDownload} className="btn-primary gap-2 flex-shrink-0 text-sm">
          <Download className="w-4 h-4" />
          Download
          <span className="text-primary-300 text-xs">({fmtSize(item.size_bytes)})</span>
        </button>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Installation</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-2 bg-gray-900/50 rounded-xl p-3 border border-gray-800">
            <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-primary-400" />From PyPI
            </p>
            <CodeLine code="pip install nebulacode" />
          </div>
          <div className="space-y-2 bg-gray-900/50 rounded-xl p-3 border border-gray-800">
            <p className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5 text-emerald-400" />From downloaded file
            </p>
            <CodeLine code={`pip install ${item.filename}`} />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-1">Quick start</p>
          <CodeLine code="nebula login https://your-nebulax-server" label="1. Connect to your NebulaX instance" />
          <CodeLine code="nebula" label="2. Start the interactive coding session" />
          <CodeLine code="nebula daemon" label="3. (Optional) Run as a remote-control daemon" />
        </div>

        <details className="group">
          <summary className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors list-none select-none mt-1">
            <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform" />
            What can NebulaCode do?
          </summary>
          <ul className="mt-2 pl-5 space-y-1 text-xs text-gray-400 list-disc">
            <li>ReAct agent loop — reasons and acts step-by-step to complete coding tasks</li>
            <li>Tools: <code className="text-emerald-400 font-mono">read_file</code>, <code className="text-emerald-400 font-mono">write_file</code>, <code className="text-emerald-400 font-mono">patch_file</code>, <code className="text-emerald-400 font-mono">run_command</code>, <code className="text-emerald-400 font-mono">search_files</code>, <code className="text-emerald-400 font-mono">list_files</code></li>
            <li>Uses your local Ollama or your NebulaX instance as the LLM backend</li>
            <li>Multi-turn memory — remembers context across your session</li>
            <li>Search your NebulaX knowledge bases from the terminal (<code className="text-emerald-400 font-mono">/kb</code>)</li>
            <li>Sync runs to the NebulaX web history automatically</li>
            <li>Run <code className="text-emerald-400 font-mono">nebula daemon</code> to let the NebulaX web UI send tasks to your machine</li>
          </ul>
        </details>
      </div>
    </div>
  )
}

// ── Desktop platform card ───────────────────────────────────────────────────

interface DesktopPlatform {
  key: string
  label: string
  icon: React.ReactNode
  badge: string
  installHint: string
  item?: DownloadItem
}

function DesktopCard({ platforms }: { platforms: DesktopPlatform[] }) {
  const available = platforms.filter(p => p.item)

  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-primary-900/30 border border-primary-700/40 flex items-center justify-center flex-shrink-0">
          <Monitor className="w-6 h-6 text-primary-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-gray-100">NebulaX Desktop</h2>
            <span className="badge bg-primary-900/30 text-primary-400 border border-primary-800/40">v{VERSION}</span>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Native app for macOS, Windows, and Linux — offline model management, local inference.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {platforms.map(p => (
          <div key={p.key} className="bg-gray-900/50 rounded-xl p-3 border border-gray-800 space-y-3">
            <div className="flex items-center gap-2">
              {p.icon}
              <span className="text-sm font-medium text-gray-200">{p.label}</span>
              <span className="badge bg-gray-800 text-gray-500 text-xs ml-auto">{p.badge}</span>
            </div>
            {p.item ? (
              <>
                <p className="text-xs text-gray-500">{p.installHint}</p>
                <a
                  href={`${baseURL}/downloads/${encodeURIComponent(p.item.filename)}`}
                  download={p.item.filename}
                  className="btn-primary w-full justify-center text-xs py-1.5 inline-flex"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download ({fmtSize(p.item.size_bytes)})
                </a>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-600">{p.installHint}</p>
                <a
                  href="https://github.com/godsloveamajay-bit/nebulaxai/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary w-full justify-center text-xs py-1.5 inline-flex gap-1.5 opacity-60"
                >
                  <Globe className="w-3.5 h-3.5" />GitHub Releases
                </a>
              </>
            )}
          </div>
        ))}
      </div>

      {available.length > 0 && (
        <details className="group">
          <summary className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-300 transition-colors list-none select-none">
            <ChevronRight className="w-3.5 h-3.5 group-open:rotate-90 transition-transform" />
            Installation notes
          </summary>
          <ul className="mt-2 pl-5 space-y-1 text-xs text-gray-400 list-disc">
            <li><span className="text-gray-300">Linux .deb:</span> <code className="text-emerald-400 font-mono">sudo dpkg -i 'NebulaX AI_0.6.0_amd64.deb'</code></li>
            <li><span className="text-gray-300">macOS:</span> open the .dmg and drag NebulaX AI to Applications</li>
            <li><span className="text-gray-300">Windows:</span> run the setup .exe and follow the installer</li>
          </ul>
        </details>
      )}
    </div>
  )
}

// ── Mobile card ─────────────────────────────────────────────────────────────

interface MobilePlatform {
  key: string
  label: string
  icon: React.ReactNode
  badge: string
  hint: string
  item?: DownloadItem
}

function MobileCard({ platforms }: { platforms: MobilePlatform[] }) {
  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-purple-900/30 border border-purple-700/40 flex items-center justify-center flex-shrink-0">
          <Smartphone className="w-6 h-6 text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-gray-100">NebulaX Mobile</h2>
            <span className="badge bg-purple-900/30 text-purple-400 border border-purple-800/40">v{VERSION}</span>
          </div>
          <p className="text-sm text-gray-400 mt-1">
            Chat with your models on the go. Available on iOS and Android.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {platforms.map(p => (
          <div key={p.key} className="bg-gray-900/50 rounded-xl p-3 border border-gray-800 space-y-3">
            <div className="flex items-center gap-2">
              {p.icon}
              <span className="text-sm font-medium text-gray-200">{p.label}</span>
              <span className="badge bg-gray-800 text-gray-500 text-xs ml-auto">{p.badge}</span>
            </div>
            {p.item ? (
              <>
                <p className="text-xs text-gray-500">{p.hint}</p>
                <a
                  href={`${baseURL}/downloads/${encodeURIComponent(p.item.filename)}`}
                  download={p.item.filename}
                  className="btn-primary w-full justify-center text-xs py-1.5 inline-flex"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download ({fmtSize(p.item.size_bytes)})
                </a>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-600">{p.hint}</p>
                <button disabled className="btn-secondary w-full justify-center text-xs py-1.5 opacity-40 cursor-not-allowed inline-flex gap-1.5">
                  <Download className="w-3.5 h-3.5" />Coming soon
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function DownloadsPage() {
  const [items, setItems] = useState<DownloadItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${baseURL}/downloads`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    })
      .then(r => r.json())
      .then(data => { setItems(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const byFilename = Object.fromEntries(items.map(i => [i.filename, i]))

  const cliItems = items.filter(i => i.type === 'python-wheel')

  const desktopPlatforms: DesktopPlatform[] = [
    {
      key: 'linux',
      label: 'Linux',
      badge: '.deb',
      icon: <Monitor className="w-4 h-4 text-orange-400" />,
      installHint: 'Debian/Ubuntu x86_64. Run: sudo dpkg -i *.deb',
      item: byFilename["NebulaX AI_0.6.0_amd64.deb"],
    },
    {
      key: 'windows',
      label: 'Windows',
      badge: '.exe',
      icon: <Monitor className="w-4 h-4 text-blue-400" />,
      installHint: 'Windows 10 / 11 installer (x64). Build on Windows via GitHub Actions.',
      item: byFilename['NebulaX-AI_0.6.0_x64-setup.exe'],
    },
    {
      key: 'macos',
      label: 'macOS',
      badge: '.dmg',
      icon: <Apple className="w-4 h-4 text-gray-300" />,
      installHint: 'macOS 11+ universal build. Build on macOS via GitHub Actions.',
      item: byFilename['NebulaX-AI_0.6.0_x64.dmg'],
    },
  ]

  const mobilePlatforms: MobilePlatform[] = [
    {
      key: 'android',
      label: 'Android',
      badge: '.apk',
      icon: <Smartphone className="w-4 h-4 text-green-400" />,
      hint: 'Requires Android 7.0+. Enable "Install unknown apps" in settings.',
      item: byFilename['nebulax-ai-0.6.0.apk'],
    },
    {
      key: 'ios',
      label: 'iOS',
      badge: 'App Store',
      icon: <Apple className="w-4 h-4 text-gray-300" />,
      hint: 'Requires iOS 14+. Submit via Xcode on a Mac with Apple Developer account.',
      item: undefined,
    },
  ]

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
          <Download className="w-6 h-6 text-primary-400" />Downloads
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          NebulaX v{VERSION} — install apps and tools on your devices.
        </p>
      </div>

      {/* CLI */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5" />Terminal
        </h2>
        {loading ? (
          <div className="card flex items-center gap-3 text-gray-500">
            <Cpu className="w-4 h-4 animate-spin" />Fetching packages…
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
        <DesktopCard platforms={desktopPlatforms} />
      </section>

      {/* Mobile */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
          <Smartphone className="w-3.5 h-3.5" />Mobile
        </h2>
        <MobileCard platforms={mobilePlatforms} />
      </section>
    </div>
  )
}
