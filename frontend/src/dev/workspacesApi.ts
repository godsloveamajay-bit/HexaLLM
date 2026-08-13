import { api } from '../lib/api'
import type { Workspace, WorkspaceItem, WorkspaceKey } from './devStore'

export const fetchWorkspaces = async (): Promise<Workspace[]> =>
  (await api.get('/workspaces')).data

export const createWorkspace = async (name: string, description?: string): Promise<Workspace> =>
  (await api.post('/workspaces', { name, description: description || null })).data

export const renameWorkspace = async (id: number, name: string): Promise<Workspace> =>
  (await api.patch(`/workspaces/${id}`, { name })).data

export const deleteWorkspace = async (id: number): Promise<void> => {
  await api.delete(`/workspaces/${id}`)
}

export const fetchItems = async (workspaceId: number, kind?: string): Promise<WorkspaceItem[]> =>
  (await api.get(`/workspaces/${workspaceId}/items`, { params: kind ? { kind } : {} })).data

export const saveItem = async (
  workspaceId: number,
  kind: 'playground' | 'request',
  name: string,
  payload: Record<string, unknown>
): Promise<WorkspaceItem> =>
  (await api.post(`/workspaces/${workspaceId}/items`, { kind, name, payload })).data

export const renameItem = async (workspaceId: number, itemId: number, name: string): Promise<WorkspaceItem> =>
  (await api.patch(`/workspaces/${workspaceId}/items/${itemId}`, { name })).data

export const deleteItem = async (workspaceId: number, itemId: number): Promise<void> => {
  await api.delete(`/workspaces/${workspaceId}/items/${itemId}`)
}

export const fetchKeys = async (workspaceId: number): Promise<WorkspaceKey[]> =>
  (await api.get(`/workspaces/${workspaceId}/keys`)).data

export const createKey = async (
  workspaceId: number,
  name: string,
  model?: string
): Promise<WorkspaceKey> =>
  (await api.post(`/workspaces/${workspaceId}/keys`, { name, model: model || null })).data

export const revokeKey = async (keyId: number): Promise<void> => {
  await api.delete(`/api-keys/${keyId}`)
}