import { useEffect, useRef, useState } from 'react'
import {
  Plus, X, Loader2, BookOpen, FileText, Upload, Trash2, Search,
  CheckCircle2, AlertCircle, Clock, Globe,
} from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface KnowledgeBase {
  id: number
  name: string
  description?: string
  embedding_model: string
  chunk_size: number
  chunk_overlap: number
  document_count: number
  chunk_count: number
  created_at: string
  updated_at: string
}

interface KBDocument {
  id: number
  kb_id: number
  filename: string
  mime_type?: string
  size_bytes: number
  status: 'pending' | 'processing' | 'ready' | 'failed'
  error?: string
  chunks_count: number
  created_at: string
}

interface KBHit {
  chunk_id: number
  document_id: number
  document_filename: string
  score: number
  content: string
  order_idx: number
}

const POPULAR_EMBED = ['nomic-embed-text', 'mxbai-embed-large', 'all-minilm', 'snowflake-arctic-embed']

function statusBadge(s: KBDocument['status']) {
  const map: Record<KBDocument['status'], { cls: string; icon: any; label: string }> = {
    pending: { cls: 'bg-gray-800 text-gray-400', icon: Clock, label: 'Pending' },
    processing: { cls: 'bg-secondary-900/40 text-secondary-300', icon: Loader2, label: 'Processing' },
    ready: { cls: 'bg-green-900/40 text-green-300', icon: CheckCircle2, label: 'Ready' },
    failed: { cls: 'bg-red-900/40 text-red-300', icon: AlertCircle, label: 'Failed' },
  }
  const { cls, icon: Icon, label } = map[s]
  return (
    <span className={clsx('badge', cls)}>
      <Icon className={clsx('w-3 h-3 mr-1', s === 'processing' && 'animate-spin')} />
      {label}
    </span>
  )
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', description: '', embedding_model: POPULAR_EMBED[0],
    chunk_size: 500, chunk_overlap: 50,
  })
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      await api.post('/knowledge', form)
      toast.success('Knowledge base created')
      onCreated()
      onClose()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to create')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-100">New Knowledge Base</h2>
          <button onClick={onClose} className="btn-ghost p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Name *</label>
            <input className="input" value={form.name} required
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input resize-none" rows={2} value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div>
            <label className="label">Embedding Model</label>
            <select className="input" value={form.embedding_model}
              onChange={(e) => setForm((f) => ({ ...f, embedding_model: e.target.value }))}>
              {POPULAR_EMBED.map((m) => <option key={m}>{m}</option>)}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Pull the model in Ollama first: <code className="text-gray-400">ollama pull {form.embedding_model}</code>
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Chunk Size (words)</label>
              <input type="number" className="input" min={50} max={4000} value={form.chunk_size}
                onChange={(e) => setForm((f) => ({ ...f, chunk_size: parseInt(e.target.value || '500') }))} />
            </div>
            <div>
              <label className="label">Chunk Overlap</label>
              <input type="number" className="input" min={0} max={500} value={form.chunk_overlap}
                onChange={(e) => setForm((f) => ({ ...f, chunk_overlap: parseInt(e.target.value || '50') }))} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1 justify-center">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function KBDetail({ kb, onChanged, onDelete }: {
  kb: KnowledgeBase
  onChanged: () => void
  onDelete: () => void
}) {
  const [docs, setDocs] = useState<KBDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [crawlUrl, setCrawlUrl] = useState('')
  const [crawling, setCrawling] = useState(false)
  const [showCrawl, setShowCrawl] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [hits, setHits] = useState<KBHit[]>([])

  const loadDocs = async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/knowledge/${kb.id}/documents`)
      setDocs(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDocs() }, [kb.id])

  // Poll while any doc is pending/processing
  useEffect(() => {
    if (!docs.some((d) => d.status === 'pending' || d.status === 'processing')) return
    const id = setInterval(loadDocs, 2000)
    return () => clearInterval(id)
  }, [docs])

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', f)
        try {
          await api.post(`/knowledge/${kb.id}/documents`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          toast.success(`Uploaded ${f.name}`)
        } catch (err: any) {
          toast.error(`${f.name}: ${err.response?.data?.detail || 'failed'}`)
        }
      }
      loadDocs()
      onChanged()
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const crawlWebsite = async () => {
    if (!crawlUrl.trim()) return
    setCrawling(true)
    try {
      await api.post(`/knowledge/${kb.id}/crawl`, { url: crawlUrl.trim() })
      toast.success('URL added — processing in background')
      setCrawlUrl('')
      setShowCrawl(false)
      setTimeout(loadDocs, 1500)
      onChanged()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Crawl failed')
    } finally { setCrawling(false) }
  }

  const deleteDoc = async (docId: number) => {
    if (!confirm('Delete this document and its chunks?')) return
    await api.delete(`/knowledge/${kb.id}/documents/${docId}`)
    toast.success('Deleted')
    setDocs((d) => d.filter((x) => x.id !== docId))
    onChanged()
  }

  const runQuery = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    try {
      const { data } = await api.post(`/knowledge/${kb.id}/query`, { query, top_k: 5 })
      setHits(data.hits)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Query failed')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">{kb.name}</h2>
            {kb.description && <p className="text-sm text-gray-400 mt-1">{kb.description}</p>}
            <div className="flex flex-wrap gap-2 mt-3 text-xs">
              <span className="badge bg-gray-800 text-gray-400">{kb.embedding_model}</span>
              <span className="badge bg-gray-800 text-gray-400">{kb.chunk_size}w chunks</span>
              <span className="badge bg-gray-800 text-gray-400">{kb.chunk_overlap}w overlap</span>
              <span className="badge bg-primary-900/30 text-primary-400">
                {kb.document_count} docs / {kb.chunk_count} chunks
              </span>
            </div>
          </div>
          <button onClick={onDelete} className="text-gray-600 hover:text-red-400 transition-colors p-1">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-100">Documents</h3>
          <div className="flex gap-2">
            <button onClick={() => setShowCrawl((v) => !v)} className="btn-secondary gap-1.5">
              <Globe className="w-4 h-4" /> Add URL
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.txt,.md,.markdown,.csv,.json,.html,.htm,.rst,.log"
              onChange={(e) => upload(e.target.files)}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-primary"
            >
              {uploading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</>
                : <><Upload className="w-4 h-4" /> Upload Files</>}
            </button>
          </div>
        </div>

        {showCrawl && (
          <div className="mb-4 flex gap-2">
            <input
              className="input flex-1"
              value={crawlUrl}
              onChange={(e) => setCrawlUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && crawlWebsite()}
              placeholder="https://docs.example.com/page"
            />
            <button onClick={crawlWebsite} disabled={crawling || !crawlUrl.trim()} className="btn-primary flex-shrink-0">
              {crawling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
              Crawl
            </button>
          </div>
        )}

        {loading ? (
          <div className="py-10 flex justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : docs.length === 0 ? (
          <div className="py-10 text-center text-gray-600">
            <FileText className="w-10 h-10 mx-auto mb-2" />
            <p>No documents yet — upload PDFs, Markdown, text, or CSV files to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {docs.map((d) => (
              <div key={d.id} className="py-3 flex items-center gap-3">
                <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-100 truncate">{d.filename}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {humanBytes(d.size_bytes)} · {d.chunks_count} chunks · {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
                  </p>
                  {d.status === 'failed' && d.error && (
                    <p className="text-xs text-red-400 mt-1 truncate">{d.error}</p>
                  )}
                </div>
                {statusBadge(d.status)}
                <button onClick={() => deleteDoc(d.id)} className="text-gray-600 hover:text-red-400 p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="text-base font-semibold text-gray-100 mb-3">Test Retrieval</h3>
        <form onSubmit={runQuery} className="flex gap-2 mb-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question about your documents..."
            className="input flex-1"
          />
          <button type="submit" disabled={searching || !query.trim()} className="btn-primary">
            {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Search className="w-4 h-4" /> Search</>}
          </button>
        </form>
        {hits.length > 0 && (
          <div className="space-y-2">
            {hits.map((h, i) => (
              <div key={h.chunk_id} className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span className="text-primary-400 font-medium">[{i + 1}] {h.document_filename}</span>
                  <span>score: {h.score.toFixed(4)}</span>
                </div>
                <p className="text-sm text-gray-300 whitespace-pre-wrap line-clamp-6">{h.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function KnowledgePage() {
  const [kbs, setKbs] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<KnowledgeBase | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/knowledge')
      setKbs(data)
      if (!selected && data.length > 0) setSelected(data[0])
      // refresh the selected KB so its counts stay current
      if (selected) {
        const updated = data.find((k: KnowledgeBase) => k.id === selected.id)
        if (updated) setSelected(updated)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const deleteKB = async (kb: KnowledgeBase) => {
    if (!confirm(`Delete "${kb.name}" and all its documents?`)) return
    await api.delete(`/knowledge/${kb.id}`)
    toast.success('Deleted')
    setSelected(null)
    load()
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-100">Knowledge Bases</h1>
          <p className="text-gray-400 mt-1">Upload documents and ground your chats in your own data (RAG).</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary self-start sm:self-auto">
          <Plus className="w-4 h-4" /> New KB
        </button>
      </div>

      {loading && kbs.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
        </div>
      ) : kbs.length === 0 ? (
        <div className="text-center py-20 text-gray-600">
          <BookOpen className="w-12 h-12 mx-auto mb-3" />
          <p className="text-lg font-medium">No knowledge bases yet</p>
          <p className="text-sm mt-1">Create one to upload documents and use them in chat.</p>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-4 space-y-2">
            {kbs.map((kb) => (
              <button
                key={kb.id}
                onClick={() => setSelected(kb)}
                className={clsx(
                  'w-full text-left card hover:border-gray-700 transition-all',
                  selected?.id === kb.id && 'border-primary-700 bg-primary-950/20',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary-600 to-secondary-600 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-100 truncate">{kb.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {kb.document_count} docs · {kb.chunk_count} chunks
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="col-span-12 lg:col-span-8">
            {selected
              ? <KBDetail kb={selected} onChanged={load} onDelete={() => deleteKB(selected)} />
              : <div className="card text-center py-10 text-gray-600">Select a knowledge base to view its documents.</div>}
          </div>
        </div>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={load} />}
    </div>
  )
}
