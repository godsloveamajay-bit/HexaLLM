import { create } from 'zustand'
import api from '../lib/api'

export interface Session {
  id: number
  title: string
  model_name: string
  updated_at: string
}

interface SessionsState {
  sessions: Session[]
  activeId: number | null
  loaded: boolean
  fetch: () => Promise<void>
  create: (model: string, systemPrompt?: string | null) => Promise<Session>
  remove: (id: number) => Promise<void>
  setActive: (id: number | null) => void
  update: (id: number, patch: Partial<Session>) => void
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,
  loaded: false,

  fetch: async () => {
    try {
      const { data } = await api.get('/chat/sessions')
      set({ sessions: data, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  create: async (model, systemPrompt) => {
    const { data } = await api.post('/chat/sessions', { model_name: model, title: 'New Chat', system_prompt: systemPrompt || null })
    set((s) => ({ sessions: [data, ...s.sessions], activeId: data.id }))
    return data
  },

  remove: async (id) => {
    await api.delete(`/chat/sessions/${id}`)
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      activeId: s.activeId === id ? null : s.activeId,
    }))
  },

  setActive: (id) => set({ activeId: id }),

  update: (id, patch) =>
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
}))

export function activeSessionOf(state: { sessions: Session[]; activeId: number | null }): Session | null {
  return state.sessions.find((s) => s.id === state.activeId) ?? null
}