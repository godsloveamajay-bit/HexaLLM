import { useState } from 'react'
import { ImageIcon, Sparkles, Download, RefreshCw, Loader2, X } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'

interface GeneratedImage {
  url: string
  prompt: string
  seed: number
}

const SIZES = [
  { label: 'Square (1024×1024)', w: 1024, h: 1024 },
  { label: 'Landscape (1280×720)', w: 1280, h: 720 },
  { label: 'Portrait (720×1280)', w: 720, h: 1280 },
  { label: 'Wide (1920×1080)', w: 1920, h: 1080 },
]

const MODELS = [
  { id: 'flux', label: 'FLUX (default)' },
  { id: 'turbo', label: 'Turbo (faster)' },
]

export default function ImageGenPage() {
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [size, setSize] = useState(SIZES[0])
  const [model, setModel] = useState('flux')
  const [generating, setGenerating] = useState(false)
  const [current, setCurrent] = useState<GeneratedImage | null>(null)
  const [history, setHistory] = useState<GeneratedImage[]>([])

  const generate = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!prompt.trim()) return
    setGenerating(true)
    try {
      const { data } = await api.post('/image/generate', {
        prompt: prompt.trim(),
        negative_prompt: negativePrompt.trim(),
        width: size.w,
        height: size.h,
        model,
      })
      const img: GeneratedImage = { url: data.url, prompt: data.prompt, seed: data.seed }
      setCurrent(img)
      setHistory((h) => [img, ...h].slice(0, 12))
    } catch {
      toast.error('Image generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const regenerate = async (img: GeneratedImage) => {
    setPrompt(img.prompt)
    setGenerating(true)
    try {
      const { data } = await api.post('/image/generate', {
        prompt: img.prompt,
        width: size.w,
        height: size.h,
        model,
      })
      const next: GeneratedImage = { url: data.url, prompt: data.prompt, seed: data.seed }
      setCurrent(next)
      setHistory((h) => [next, ...h].slice(0, 12))
    } catch {
      toast.error('Image generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const download = async (url: string, prompt: string) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `nebulax-${prompt.slice(0, 40).replace(/\s+/g, '-')}.jpg`
      a.click()
    } catch {
      toast.error('Download failed')
    }
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Image Generation</h1>
        <p className="text-gray-400 mt-1">Generate images from text using FLUX AI</p>
      </div>

      {/* Prompt form */}
      <div className="card mb-6">
        <form onSubmit={generate} className="space-y-4">
          <div>
            <label className="label">Prompt</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="A serene mountain lake at sunset, photorealistic, 8k..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Negative Prompt <span className="text-gray-600 font-normal">(optional)</span></label>
            <input
              className="input"
              placeholder="blurry, watermark, low quality..."
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[180px]">
              <label className="label">Size</label>
              <select
                className="input"
                value={`${size.w}x${size.h}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split('x').map(Number)
                  setSize(SIZES.find((s) => s.w === w && s.h === h) || SIZES[0])
                }}
              >
                {SIZES.map((s) => (
                  <option key={`${s.w}x${s.h}`} value={`${s.w}x${s.h}`}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="label">Model</label>
              <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button type="submit" disabled={generating || !prompt.trim()} className="btn-primary">
                {generating
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</>
                  : <><Sparkles className="w-4 h-4" /> Generate</>}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Current result */}
      {(generating || current) && (
        <div className="card mb-6">
          {generating && !current ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-gray-500">
              <Loader2 className="w-10 h-10 animate-spin text-primary-500" />
              <p className="text-sm">Generating your image…</p>
            </div>
          ) : current ? (
            <div>
              <div className="relative group">
                {generating && (
                  <div className="absolute inset-0 bg-gray-900/60 flex items-center justify-center rounded-lg z-10">
                    <Loader2 className="w-10 h-10 animate-spin text-primary-400" />
                  </div>
                )}
                <img
                  src={current.url}
                  alt={current.prompt}
                  className="w-full rounded-lg object-cover max-h-[600px]"
                />
              </div>
              <div className="mt-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-300 truncate">{current.prompt}</p>
                  <p className="text-xs text-gray-600 mt-0.5">Seed: {current.seed}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => regenerate(current)}
                    disabled={generating}
                    className="btn-secondary"
                    title="Regenerate"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => download(current.url, current.prompt)}
                    className="btn-secondary"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button onClick={() => setCurrent(null)} className="btn-ghost p-2 text-gray-500" title="Dismiss">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* History grid */}
      {history.length > 1 && (
        <div>
          <h2 className="text-sm font-medium text-gray-500 mb-3">Recent</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {history.slice(1).map((img, i) => (
              <div
                key={i}
                className={clsx('group relative rounded-lg overflow-hidden cursor-pointer border border-gray-800 hover:border-primary-600 transition-colors')}
                onClick={() => setCurrent(img)}
              >
                <img src={img.url} alt={img.prompt} className="w-full aspect-square object-cover" />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                  <p className="text-xs text-white line-clamp-2">{img.prompt}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); download(img.url, img.prompt) }}
                  className="absolute top-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
                >
                  <Download className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!generating && !current && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-700">
          <ImageIcon className="w-12 h-12 mb-3" />
          <p className="text-sm">Enter a prompt above and click Generate</p>
        </div>
      )}
    </div>
  )
}
