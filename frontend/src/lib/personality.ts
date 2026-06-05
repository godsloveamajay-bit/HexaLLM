// Model Personality Engine — shared trait metadata + a client-side mirror of the
// backend sampling mapping (backend/app/core/personality.py) so the UI can show
// the derived temperature/top_p/length live as the user drags the sliders.

export type TraitKey = 'creativity' | 'formality' | 'risk' | 'verbosity' | 'empathy' | 'logic'

export interface TraitMeta {
  key: TraitKey
  label: string
  low: string   // 0-end label
  high: string  // 100-end label
  icon: string  // lucide icon name
  hint: string
}

export const TRAITS: TraitMeta[] = [
  { key: 'creativity', label: 'Creativity',         low: 'Practical',  high: 'Imaginative', icon: 'Sparkles',  hint: 'Drives temperature — higher = more novel, surprising answers.' },
  { key: 'formality',  label: 'Formality',          low: 'Casual',     high: 'Formal',      icon: 'Briefcase', hint: 'Tone, from chatting-with-a-friend to polished and professional.' },
  { key: 'risk',       label: 'Risk tolerance',     low: 'Cautious',   high: 'Bold',        icon: 'Flame',     hint: 'Higher = decisive opinions & wider sampling; lower = hedged & careful.' },
  { key: 'verbosity',  label: 'Verbosity',          low: 'Concise',    high: 'Thorough',    icon: 'AlignLeft', hint: 'Response length — terse one-liners vs deep, example-rich answers.' },
  { key: 'empathy',    label: 'Empathy',            low: 'Objective',  high: 'Warm',        icon: 'Heart',     hint: 'Emotional attunement vs matter-of-fact focus on the facts.' },
  { key: 'logic',      label: 'Logic vs intuition', low: 'Intuition',  high: 'Logic',       icon: 'Scale',     hint: 'Holistic, gut-feel reasoning vs step-by-step analytical rigour.' },
]

export const DEFAULT_TRAITS: Record<TraitKey, number> = {
  creativity: 50, formality: 50, risk: 50, verbosity: 50, empathy: 50, logic: 50,
}

const DEADZONE = 8

export function normalizeTraits(t?: Partial<Record<TraitKey, number>> | null): Record<TraitKey, number> {
  const out = { ...DEFAULT_TRAITS }
  if (t) for (const { key } of TRAITS) {
    const v = Number((t as any)[key])
    if (!Number.isNaN(v)) out[key] = Math.max(0, Math.min(100, Math.round(v)))
  }
  return out
}

export function isActive(t?: Partial<Record<TraitKey, number>> | null): boolean {
  const n = normalizeTraits(t)
  return TRAITS.some(({ key }) => Math.abs(n[key] - 50) >= DEADZONE)
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Mirror of personality.compose() sampling — for live display only.
export function derive(t?: Partial<Record<TraitKey, number>> | null) {
  const n = normalizeTraits(t)
  if (!isActive(n)) return { active: false, temperature: null as number | null, top_p: null as number | null, max_tokens: null as number | null }
  const temperature = Math.round((clamp(0.15 + (n.creativity / 100) * 1.0 + (n.risk - 50) / 250, 0.05, 1.3)) * 100) / 100
  const top_p = Math.round((clamp(0.55 + (n.risk / 100) * 0.45, 0.5, 1.0)) * 100) / 100
  let max_tokens: number | null = null
  if (n.verbosity < 40) max_tokens = Math.round(150 + n.verbosity * 5)
  else if (n.verbosity > 70) max_tokens = Math.round(800 + (n.verbosity - 70) * 40)
  return { active: true, temperature, top_p, max_tokens }
}

// A few ready-made personalities for one-click presets.
export const PRESETS: { name: string; emoji: string; traits: Record<TraitKey, number> }[] = [
  { name: 'Balanced',     emoji: '⚖️', traits: { ...DEFAULT_TRAITS } },
  { name: 'Professional', emoji: '💼', traits: { creativity: 35, formality: 90, risk: 35, verbosity: 60, empathy: 45, logic: 80 } },
  { name: 'Creative',     emoji: '🎨', traits: { creativity: 95, formality: 30, risk: 80, verbosity: 65, empathy: 60, logic: 25 } },
  { name: 'Concise',      emoji: '⚡', traits: { creativity: 40, formality: 55, risk: 60, verbosity: 10, empathy: 30, logic: 75 } },
  { name: 'Supportive',   emoji: '🤗', traits: { creativity: 55, formality: 30, risk: 35, verbosity: 65, empathy: 95, logic: 40 } },
  { name: 'Analyst',      emoji: '🔬', traits: { creativity: 30, formality: 70, risk: 30, verbosity: 70, empathy: 25, logic: 95 } },
]
