import { Sparkles, Briefcase, Flame, AlignLeft, Heart, Scale, RotateCcw } from 'lucide-react'
import { TRAITS, DEFAULT_TRAITS, derive, PRESETS, normalizeTraits, type TraitKey } from '../lib/personality'
import { clsx } from 'clsx'

const ICONS: Record<string, any> = { Sparkles, Briefcase, Flame, AlignLeft, Heart, Scale }

interface Props {
  value?: Partial<Record<TraitKey, number>> | null
  onChange: (traits: Record<TraitKey, number>) => void
  showPresets?: boolean
  showDerived?: boolean
  className?: string
}

/** Reusable Model Personality Engine slider panel — used in Chat and the Persona editor. */
export default function PersonalitySliders({ value, onChange, showPresets = true, showDerived = true, className }: Props) {
  const traits = normalizeTraits(value)
  const d = derive(traits)
  const set = (key: TraitKey, v: number) => onChange({ ...traits, [key]: v })

  return (
    <div className={clsx('space-y-3', className)}>
      {showPresets && (
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" onClick={() => onChange({ ...p.traits })}
              className="badge bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700 cursor-pointer">
              {p.emoji} {p.name}
            </button>
          ))}
          <button type="button" onClick={() => onChange({ ...DEFAULT_TRAITS })}
            title="Reset to neutral"
            className="badge bg-transparent text-gray-500 hover:text-gray-300 border border-gray-800 cursor-pointer inline-flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        </div>
      )}

      <div className="space-y-3">
        {TRAITS.map((t) => {
          const Icon = ICONS[t.icon] || Sparkles
          const v = traits[t.key]
          return (
            <div key={t.key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="flex items-center gap-1.5 text-gray-300" title={t.hint}>
                  <Icon className="w-3.5 h-3.5 text-primary-400" /> {t.label}
                </span>
                <span className="text-gray-500 tabular-nums">{v}</span>
              </div>
              <input type="range" min={0} max={100} value={v}
                onChange={(e) => set(t.key, +e.target.value)}
                className="w-full accent-primary-500" />
              <div className="flex justify-between text-[10px] text-gray-600 mt-0.5">
                <span>{t.low}</span>
                <span>{t.high}</span>
              </div>
            </div>
          )
        })}
      </div>

      {showDerived && (
        <div className="text-[11px] text-gray-500 border-t border-gray-800 pt-2 flex flex-wrap gap-x-3 gap-y-1">
          {d.active ? (
            <>
              <span>temp <b className="text-gray-300">{d.temperature}</b></span>
              <span>top_p <b className="text-gray-300">{d.top_p}</b></span>
              <span>max length <b className="text-gray-300">{d.max_tokens ?? 'model default'}</b></span>
            </>
          ) : (
            <span>Neutral — the model uses its defaults. Move a slider to shape its personality.</span>
          )}
        </div>
      )}
    </div>
  )
}
