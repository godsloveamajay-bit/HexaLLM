// Helpers for choosing models that can actually drive an agent / workflow.
//
// Not every model Ollama lists can hold a chat conversation: embedding models
// (e.g. nomic-embed-text) only produce vectors, and vision models are tuned for
// images rather than the JSON tool-calling protocol the agent loop relies on.
// Picking one of those by default is why agent runs used to "do nothing".

import api from './api'

export interface ModelOption { value: string; label: string; group: string }

// Static fallback labels so we can pretty-print a HexaLLM variant id even on
// pages that don't fetch the variant list. Kept in sync with the backend.
export const VARIANT_LABELS: Record<string, string> = {
  'hex-4.2-code': 'HexaLLM Code',
  'hex-4.2-turbo': 'HexaLLM Turbo',
  'hex-4.3-write': 'HexaLLM Write',
  'hex-6.0-reason': 'HexaLLM Reason',
  'hex-5.1-prime': 'HexaLLM Prime',
  'hex-4.2-custom': 'HexaLLM Custom',
  'hex-4.1-vision': 'HexaLLM Vision',
  'hex-4.2-math': 'HexaLLM Math',
}

/** Human label for a model value. Variants → branded label; raw ids unchanged. */
export function prettyModel(value?: string | null): string {
  if (!value) return ''
  return VARIANT_LABELS[value] || value
}

/** Selectable models for the current user.
 *  Everyone gets the HexaLLM variants; admins and Hyper+ users additionally
 *  get the raw Ollama models. Variants always come first. */
export async function loadModelOptions(isAdmin: boolean, hasRawAccess?: boolean): Promise<ModelOption[]> {
  const opts: ModelOption[] = []
  try {
    const { data } = await api.get('/models/hexallm/variants')
    for (const v of (data.variants || [])) {
      if (v.ready === false) continue
      opts.push({ value: v.id, label: v.label, group: 'HexaLLM' })
    }
  } catch {}
  if (isAdmin || hasRawAccess) {
    try {
      const { data } = await api.get('/models/ollama/list')
      for (const m of chatCapableModels((data.models || []).map((x: any) => x.name))) {
        opts.push({ value: m, label: m, group: 'Models' })
      }
    } catch {}
  }
  return opts
}

/** Sensible default selection: HexaLLM Prime if available, else first. */
export function defaultModelValue(opts: ModelOption[]): string {
  return opts.find((o) => o.value === 'hex-5.1-prime')?.value || opts[0]?.value || 'hex-5.1-prime'
}

/** Render <option>s for a ModelOption[] grouped by their `group`. */
export function groupedOptions(opts: ModelOption[]) {
  const groups: Record<string, ModelOption[]> = {}
  for (const o of opts) (groups[o.group] ||= []).push(o)
  return groups
}

const EMBED_RE = /embed|bge|gte|minilm/i
const VISION_RE = /vision|llava|moondream/i

// Models that follow instructions / the JSON ReAct protocol well, best first.
const PREFERRED_RE = /qwen2\.5(?!-?coder)|llama3\.1|llama3:8b|openchat|mistral|qwen2\.5-coder|coder/i

/** Drop models that can't chat at all (embeddings). Keeps original order. */
export function chatCapableModels(names: string[]): string[] {
  return names.filter((n) => !EMBED_RE.test(n))
}

/** Pick a sensible default agent model: a capable instruct model if present,
 *  otherwise the first non-vision chat model, otherwise the first chat model. */
export function defaultAgentModel(names: string[]): string {
  const chat = chatCapableModels(names)
  if (chat.length === 0) return names[0] || ''
  const preferred = chat.find((n) => PREFERRED_RE.test(n))
  if (preferred) return preferred
  const nonVision = chat.find((n) => !VISION_RE.test(n))
  return nonVision || chat[0]
}
