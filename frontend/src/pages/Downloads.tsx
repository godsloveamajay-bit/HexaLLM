import { useState, useEffect } from 'react'
import {
  Download, Terminal, Monitor, Smartphone, Package,
  Copy, Check, ChevronRight, Cpu, Apple, Globe, Tag,
} from 'lucide-react'
import { baseURL } from '../lib/api'

const GITHUB_REPO = 'godsloveamajay-bit/nebulaxai'
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
            <li>Run <code className="text-emerald-400 font-mono">nebula daemon</code> to let the NebulaX web UI send tasks to your machine</li>
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
      icon: <Monitor className="w-4 h-4 text-orange-400" />,
      installHint: 'Debian / Ubuntu x86_64. Run: sudo dpkg -i *.deb',
      assetPattern: /amd64\.deb$/i,
    },
    {
      label: 'Windows',
      badge: '.exe',
      icon: <Monitor className="w-4 h-4 text-blue-400" />,
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
            <h2 className="text-base font-semibold text-gray-100">NebulaX Desktop</h2>
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
        <div className="w-12 h-12 rounded-xl bg-purple-900/30 border border-purple-700/40 flex items-center justify-center flex-shrink-0">
          <Smartphone className="w-6 h-6 text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-gray-100">NebulaX Mobile</h2>
            <span className="badge bg-purple-900/30 text-purple-400 border border-purple-800/40">v{version}</span>
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

  const version = release?.tag_name?.replace(/^v/, '') ?? '0.6.0'
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
            Install NebulaX apps and tools on your devices.
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
    </div>
  )
}
