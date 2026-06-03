import { create } from 'zustand'
import api from '../lib/api'

interface User {
  id: number
  email: string
  username: string
  full_name?: string
  avatar_url?: string
  bio?: string
  is_admin: boolean
  created_at: string
  // AI preferences (Settings → AI Assistant)
  ai_instructions?: string | null
  ai_default_model?: string | null
  ai_temperature?: number | null
  ai_max_tokens?: number | null
  ai_default_kb_id?: number | null
  ai_reasoning?: boolean | null
}

interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: { email: string; username: string; password: string; full_name?: string }) => Promise<void>
  loginWithToken: (token: string) => Promise<void>
  logout: () => void
  fetchMe: () => Promise<void>
}

export const useAuth = create<AuthState>((set) => ({
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  token: localStorage.getItem('token'),
  loading: false,

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('user', JSON.stringify(data.user))
    set({ user: data.user, token: data.access_token })
  },

  register: async (formData) => {
    const { data } = await api.post('/auth/register', formData)
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('user', JSON.stringify(data.user))
    set({ user: data.user, token: data.access_token })
  },

  loginWithToken: async (token) => {
    localStorage.setItem('token', token)
    const { data } = await api.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    localStorage.setItem('user', JSON.stringify(data))
    set({ user: data, token })
  },

  logout: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    set({ user: null, token: null })
  },

  fetchMe: async () => {
    try {
      const { data } = await api.get('/auth/me')
      localStorage.setItem('user', JSON.stringify(data))
      set({ user: data })
    } catch {
      set({ user: null, token: null })
    }
  },
}))
