import { create } from 'zustand'

export interface WorkspaceItem {
  id: number
  workspace_id: number
  kind: 'playground' | 'request'
  name: string
  payload: Record<string, unknown>
  created_at: string
}

export interface Workspace {
  id: number
  name: string
  description?: string | null
  item_count: number
  key_count: number
  created_at: string
}

export interface WorkspaceKey {
  id: number
  name: string
  key: string
  is_active: boolean
  workspace_id?: number | null
  persona_id?: number | null
  persona_name?: string | null
  model_name?: string | null
  request_count: number
  prompt_tokens: number
  completion_tokens: number
  created_at: string
}

interface DevStore {
  activeWorkspaceId: number | null
  setActiveWorkspace: (id: number | null) => void
  pendingPreset: WorkspaceItem | null
  pendingRequest: WorkspaceItem | null
  loadPreset: (item: WorkspaceItem | null) => void
  loadRequest: (item: WorkspaceItem | null) => void
}

export const useDevStore = create<DevStore>((set) => ({
  activeWorkspaceId: Number(localStorage.getItem('activeWorkspaceId') || null),
  setActiveWorkspace: (id) => {
    localStorage.setItem('activeWorkspaceId', String(id ?? ''))
    set({ activeWorkspaceId: id })
  },
  pendingPreset: null,
  pendingRequest: null,
  loadPreset: (item) => set({ pendingPreset: item }),
  loadRequest: (item) => set({ pendingRequest: item }),
}))