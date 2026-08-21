import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export const isTauri = () => {
  try {
    return typeof (window as any).__TAURI_INTERNALS__ !== 'undefined'
  } catch {
    return false
  }
}

export const native = {
  shell: {
    exec: (cmd: string, args: string[]) => invoke('shell_exec', { cmd, args }),
    execStream: async (cmd: string, args: string[], onStdout: (line: string) => void, onStderr: (line: string) => void, onExit: (code: number) => void) => {
      const unsub1 = await listen('shell://stdout', (e: any) => onStdout(e.payload as string))
      const unsub2 = await listen('shell://stderr', (e: any) => onStderr(e.payload as string))
      const unsub3 = await listen('shell://exit', (e: any) => onExit(e.payload as number))
      try {
        await invoke('shell_exec_stream', { cmd, args })
      } finally {
        unsub1()
        unsub2()
        unsub3()
      }
    }
  },
  fs: {
    read: (path: string) => invoke('fs_read', { path }),
    write: (path: string, content: string) => invoke('fs_write', { path, content }),
    append: (path: string, content: string) => invoke('fs_append', { path, content }),
    list: (path: string) => invoke('fs_list', { path }),
    mkdir: (path: string) => invoke('fs_mkdir', { path }),
    remove: (path: string, recursive: boolean) => invoke('fs_remove', { path, recursive }),
    exists: (path: string) => invoke('fs_exists', { path }),
  },
  git: {
    exec: (repo: string, args: string[]) => invoke('git_exec', { repo, args }),
    status: (repo: string) => invoke('git_status', { repo }),
    diff: (repo: string, staged: boolean) => invoke('git_diff', { repo, staged }),
    log: (repo: string, limit: number) => invoke('git_log', { repo, limit }),
    branch: (repo: string) => invoke('git_branch', { repo }),
    commit: (repo: string, message: string, addAll: boolean) => invoke('git_commit', { repo, message, addAll }),
    push: (repo: string, remote: string, branch: string) => invoke('git_push', { repo, remote, branch }),
    pull: (repo: string, remote: string, branch: string) => invoke('git_pull', { repo, remote, branch }),
  },
  browser: {
    open: (url: string, label?: string) => invoke('browser_open', { url, window_label: label }),
    close: (label: string) => invoke('browser_close', { window_label: label }),
    executeScript: (label: string, script: string) => invoke('browser_execute_script', { window_label: label, script }),
    navigate: (label: string, url: string) => invoke('browser_navigate', { window_label: label, url }),
    executeActions: (label: string, actions: BrowserAction[]) => invoke('browser_execute_actions', { window_label: label, actions }),
    getContent: (label: string, selector?: string) => invoke('browser_get_content', { window_label: label, selector }),
  },
  backend: {
    start: () => invoke('backend_start'),
    stop: () => invoke('backend_stop'),
    status: () => invoke('backend_status'),
    health: (port: number) => invoke('backend_health', { port }),
  },
}

export interface BrowserAction {
  type: string
  selector?: string
  value?: string
  url?: string
  script?: string
  wait_ms?: number
}

export interface BrowserResult {
  success: boolean
  data?: string
  error?: string
}

export interface BackendStatus {
  running: boolean
  port?: number
  url?: string
}

export const onBackendReady = (callback: (port: number) => void) => {
  return listen('backend:ready', (e: any) => callback(e.payload as number))
}
