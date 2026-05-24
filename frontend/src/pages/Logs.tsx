import { useEffect, useState } from 'react'
import { FileText, RefreshCw, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import api from '../lib/api'
import { clsx } from 'clsx'
import { format } from 'date-fns'

interface Log {
  id: number; endpoint: string; method: string; status_code: number;
  model?: string; prompt_tokens: number; completion_tokens: number;
  latency_ms?: number; created_at: string;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [modelFilter, setModelFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const limit = 25

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) })
      if (modelFilter) params.set('model', modelFilter)
      const { data } = await api.get(`/analytics/logs?${params}`)
      setLogs(data.logs)
      setTotal(data.total)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [page, modelFilter])

  const statusColor = (code: number) => {
    if (code < 300) return 'text-green-400'
    if (code < 400) return 'text-yellow-400'
    return 'text-red-400'
  }

  const methodColor = (m: string) => {
    if (m === 'GET') return 'bg-blue-900/40 text-blue-300'
    if (m === 'POST') return 'bg-green-900/40 text-green-300'
    if (m === 'DELETE') return 'bg-red-900/40 text-red-300'
    return 'bg-gray-800 text-gray-400'
  }

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Request Logs</h1>
          <p className="text-gray-400 mt-1">{total.toLocaleString()} total requests</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              value={modelFilter}
              onChange={(e) => { setModelFilter(e.target.value); setPage(0) }}
              placeholder="Filter by model"
              className="input pl-9 w-40"
            />
          </div>
          <button onClick={load} className="btn-ghost p-2"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/50">
                {['Time', 'Method', 'Endpoint', 'Status', 'Model', 'Tokens', 'Latency'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-600">Loading...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16 text-center text-gray-600">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  No logs yet
                </td></tr>
              ) : logs.map((log) => (
                <tr key={log.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap font-mono text-xs">
                    {format(new Date(log.created_at), 'MM-dd HH:mm:ss')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('badge', methodColor(log.method))}>{log.method}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-300 font-mono text-xs max-w-xs truncate">{log.endpoint}</td>
                  <td className="px-4 py-3">
                    <span className={clsx('font-mono font-medium', statusColor(log.status_code))}>{log.status_code}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{log.model || '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                    {log.prompt_tokens + log.completion_tokens > 0
                      ? `${log.prompt_tokens + log.completion_tokens}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs font-mono">
                    {log.latency_ms ? `${log.latency_ms}ms` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <p className="text-sm text-gray-500">
              Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="btn-ghost p-1.5">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-gray-400">{page + 1} / {totalPages}</span>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="btn-ghost p-1.5">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
