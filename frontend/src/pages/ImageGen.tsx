import { useState } from 'react'
import { ImageIcon, Sparkles, Download, RefreshCw, Loader2, X, Wand2, Zap } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'

interface GeneratedImage {
  url: string
  prompt: string
  enhancedPrompt?: string
  seed: number
}

const SIZES = [
  { label: 'Square (1024×1024)', w: 1024, h: 1024 },
  { label: 'Landscape (1280×720)', w: 1280, h: 720 },
  { label: 'Portrait (720×1280)', w: 720, h: 1280 },
  { label: 'Wide (1920×1080)', w: 1920, h: 1080 },
]

const MODELS = [
  { id: 'flux-realism', label: 'FLUX Realism', desc: 'Best for realistic photos' },
  { id: 'flux-anime', label: 'FLUX Anime', desc: 'Anime & manga style' },
  { id: 'flux-3d', label: 'FLUX 3D', desc: '3D renders & CGI' },
  { id: 'flux', label: 'FLUX', desc: 'Balanced general use' },
  { id: 'turbo', label: 'Turbo', desc: 'Fastest generation' },
]

const STYLE_PRESETS = [
  { label: 'Cinematic', prefix: 'cinematic shot, dramatic lighting, 35mm film, depth of field, ' },
  { label: 'Photorealistic', prefix: 'photorealistic, 8k, DSLR, sharp focus, professional photography, ' },
  { label: 'Anime', prefix: 'anime style, vibrant colors, detailed illustration, Studio Ghibli inspired, ' },
  { label: 'Oil Painting', prefix: 'oil painting, classical realism, impasto texture, rich tones, ' },
  { label: 'Watercolor', prefix: 'watercolor painting, soft washes, artistic, delicate colors, ' },
  { label: 'Sketch', prefix: 'pencil sketch, fine line art, cross-hatching, black and white, ' },
  { label: 'Neon', prefix: 'neon lights, cyberpunk, glowing, dark background, futuristic, ' },
  { label: 'Fantasy', prefix: 'fantasy art, epic, magical, highly detailed, concept art, ' },
]

export default function ImageGenPage() {
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [size, setSize] = useState(SIZES[0])
  const [model, setModel] = useState('flux-realism')
  const [enhancePrompt, setEnhancePrompt] = useState(false)
  const [pollinationsEnhance, setPollinationsEnhance] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [enhancing, setEnhancing] = useState(false)
  const [current, setCurrent] = useState<GeneratedImage | null>(null)
  const [history, setHistory] = useState<GeneratedImage[]>([])

  const applyPreset = (prefix: string) => {
    setPrompt((p) => {
      const stripped = p.replace(/^(cinematic shot.*?|photorealistic.*?|anime style.*?|oil painting.*?|watercolor.*?|pencil sketch.*?|neon lights.*?|fantasy art.*?),\s*/i, '')
      return prefix + stripped
    })
  }

  const doGenerate = async (opts: {
    prompt: string
    negativePrompt?: string
    enhance?: boolean
  }) => {
    setGenerating(true)
    if (opts.enhance) setEnhancing(true)
    try {
      const { data } = await api.post('/image/generate', {
        prompt: opts.prompt.trim(),
        negative_prompt: (opts.negativePrompt ?? '').trim(),
        width: size.w,
        height: size.h,
        model,
        enhance_prompt: enhancePrompt,
        pollinations_enhance: pollinationsEnhance,
      })
      setEnhancing(false)
      const img: GeneratedImage = {
        url: data.url,
        prompt: data.prompt,
        enhancedPrompt: data.enhanced_prompt ?? undefined,
        seed: data.seed,
      }
      setCurrent(img)
      setHistory((h) => [img, ...h].slice(0, 12))
    } catch {
      toast.error('Image generation failed')
    } finally {
      setGenerating(false)
      setEnhancing(false)
    }
  }

  const generate = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!prompt.trim()) return
    doGenerate({ prompt, negativePrompt, enhance: enhancePrompt })
  }

  const regenerate = (img: GeneratedImage) => {
    setPrompt(img.prompt)
    doGenerate({ prompt: img.prompt, enhance: enhancePrompt })
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

          {/* Style presets */}
          <div>
            <label className="label mb-1">Style Preset</label>
            <div className="flex flex-wrap gap-2">
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => applyPreset(s.prefix)}
                  className="px-3 py-1 rounded-full text-xs font-medium bg-gray-800 hover:bg-primary-700 text-gray-300 hover:text-white border border-gray-700 hover:border-primary-600 transition-colors"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Prompt</label>
            <textarea
              className="input resize-none"
              rows={3}
              placeholder="A serene mountain lake at sunset, misty atmosphere…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label">
              Negative Prompt <span className="text-gray-600 font-normal">(optional)</span>
            </label>
            <input
              className="input"
              placeholder="blurry, watermark, low quality, deformed…"
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

            <div className="flex-1 min-w-[180px]">
              <label className="label">Model</label>
              <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label} — {m.desc}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Enhancement toggles */}
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div
                onClick={() => setEnhancePrompt((v) => !v)}
                className={clsx(
                  'relative w-10 h-5 rounded-full transition-colors',
                  enhancePrompt ? 'bg-primary-600' : 'bg-gray-700'
                )}
              >
                <span className={clsx(
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                  enhancePrompt && 'translate-x-5'
                )} />
              </div>
              <Wand2 className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-300">
                AI Prompt Enhance
                <span className="ml-1.5 text-xs text-gray-500">(rewrites with more detail)</span>
              </span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div
                onClick={() => setPollinationsEnhance((v) => !v)}
                className={clsx(
                  'relative w-10 h-5 rounded-full transition-colors',
                  pollinationsEnhance ? 'bg-primary-600' : 'bg-gray-700'
                )}
              >
                <span className={clsx(
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                  pollinationsEnhance && 'translate-x-5'
                )} />
              </div>
              <Zap className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-300">
                Quality Boost
                <span className="ml-1.5 text-xs text-gray-500">(recommended)</span>
              </span>
            </label>

            <div className="flex items-center ml-auto">
              <button type="submit" disabled={generating || !prompt.trim()} className="btn-primary">
                {generating
                  ? <><Loader2 className="w-4 h-4 animate-spin" />{enhancing ? 'Enhancing…' : 'Generating…'}</>
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
              <p className="text-sm">{enhancing ? 'Rewriting prompt with AI…' : 'Generating your image…'}</p>
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

              {/* Enhanced prompt reveal */}
              {current.enhancedPrompt && (
                <div className="mt-3 px-3 py-2 rounded-md bg-primary-950/50 border border-primary-800/40">
                  <p className="text-xs font-medium text-primary-400 mb-0.5 flex items-center gap-1">
                    <Wand2 className="w-3 h-3" /> AI enhanced prompt
                  </p>
                  <p className="text-xs text-gray-400 leading-relaxed">{current.enhancedPrompt}</p>
                </div>
              )}

              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-300 line-clamp-2">{current.prompt}</p>
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
                className="group relative rounded-lg overflow-hidden cursor-pointer border border-gray-800 hover:border-primary-600 transition-colors"
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
