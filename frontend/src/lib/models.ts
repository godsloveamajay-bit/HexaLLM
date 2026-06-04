// Helpers for choosing models that can actually drive an agent / workflow.
//
// Not every model Ollama lists can hold a chat conversation: embedding models
// (e.g. nomic-embed-text) only produce vectors, and vision models are tuned for
// images rather than the JSON tool-calling protocol the agent loop relies on.
// Picking one of those by default is why agent runs used to "do nothing".

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
