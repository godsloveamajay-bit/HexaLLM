import { useState, useEffect, useRef } from 'react'
import { Wand2, Upload, Play, RefreshCw, CheckCircle, XCircle, Clock, AlertCircle, Loader2, ChevronDown } from 'lucide-react'
import api from '../lib/api'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'

interface Model { id: number; name: string; base_model: string }
interface TrainingJob {
  id: number; model_id: number; status: string; method: string;
  progress: number; logs: string; error?: string;
  created_at: string; started_at?: string; completed_at?: string;
}

const STATUS_ICONS: Record<string, any> = {
  pending: Clock,
  running: Loader2,
  completed: CheckCircle,
  failed: XCircle,
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-400',
  running: 'text-secondary-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
}

export default function TrainPage() {
  const [models, setModels] = useState<Model[]>([])
  const [selectedModel, setSelectedModel] = useState<number | null>(null)
  const [jobs, setJobs] = useState<TrainingJob[]>([])
  const [selectedJob, setSelectedJob] = useState<TrainingJob | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [config, setConfig] = useState({
    method: 'lora', epochs: 3, learning_rate: 0.0002,
    batch_size: 4, max_seq_length: 512, lora_r: 16, lora_alpha: 32,
  })
  const logsRef = useRef<HTMLPreElement>(null)
  const pollRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    api.get('/models/my').then(({ data }) => {
      setModels(data)
      if (data.length) setSelectedModel(data[0].id)
    })
  }, [])

  useEffect(() => {
    if (!selectedModel) return
    loadJobs()
  }, [selectedModel])

  useEffect(() => {
    if (selectedJob?.status === 'running') {
      pollRef.current = setInterval(pollJob, 3000)
    } else {
      clearInterval(pollRef.current)
    }
    return () => clearInterval(pollRef.current)
  }, [selectedJob?.id, selectedJob?.status])

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight
  }, [selectedJob?.logs])

  const loadJobs = async () => {
    if (!selectedModel) return
    try {
      const { data } = await api.get(`/models/${selectedModel}/jobs`)
      setJobs(data)
      if (data.length && !selectedJob) setSelectedJob(data[0])
    } catch {}
  }

  const pollJob = async () => {
    if (!selectedModel || !selectedJob) return
    try {
      const { data } = await api.get(`/models/${selectedModel}/jobs/${selectedJob.id}`)
      setSelectedJob(data)
      setJobs((j) => j.map((x) => x.id === data.id ? data : x))
    } catch {}
  }

  const uploadDataset = async () => {
    if (!file || !selectedModel) return
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      await api.post(`/models/${selectedModel}/dataset`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success('Dataset uploaded!')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Upload failed')
    } finally { setUploading(false) }
  }

  const startTraining = async () => {
    if (!selectedModel) return
    try {
      const { data } = await api.post(`/models/${selectedModel}/train`, { config })
      toast.success('Training started!')
      setJobs((j) => [data, ...j])
      setSelectedJob(data)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to start training')
    }
  }

  const update = (k: string, v: any) => setConfig((c) => ({ ...c, [k]: v }))

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Model Training</h1>
        <p className="text-gray-400 mt-1">Fine-tune models on your own data using LoRA/QLoRA</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: config */}
        <div className="space-y-4">
          <div className="card">
            <h2 className="font-semibold text-gray-100 mb-4">Training Configuration</h2>

            <div className="space-y-4">
              <div>
                <label className="label">Model to Fine-tune</label>
                <select className="input" value={selectedModel ?? ''} onChange={(e) => setSelectedModel(+e.target.value)}>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.base_model})</option>)}
                </select>
                {models.length === 0 && (
                  <p className="text-xs text-yellow-400 mt-1.5 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Create a model first in Model Hub
                  </p>
                )}
              </div>

              <div>
                <label className="label">Fine-tuning Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {['lora', 'qlora'].map((m) => (
                    <button key={m} onClick={() => update('method', m)}
                      className={clsx('py-2 rounded-lg text-sm font-medium border transition-all',
                        config.method === m
                          ? 'bg-primary-900/40 border-primary-700 text-primary-300'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                      )}>
                      {m.toUpperCase()}
                      <span className="block text-xs font-normal mt-0.5 opacity-70">
                        {m === 'lora' ? 'Faster' : '4-bit quantized'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Epochs</label>
                  <input type="number" className="input" value={config.epochs} min={1} max={20}
                    onChange={(e) => update('epochs', +e.target.value)} />
                </div>
                <div>
                  <label className="label">Batch Size</label>
                  <input type="number" className="input" value={config.batch_size} min={1} max={32}
                    onChange={(e) => update('batch_size', +e.target.value)} />
                </div>
                <div>
                  <label className="label">Learning Rate</label>
                  <input type="number" className="input" value={config.learning_rate} step={0.00001}
                    onChange={(e) => update('learning_rate', +e.target.value)} />
                </div>
                <div>
                  <label className="label">Max Seq Length</label>
                  <input type="number" className="input" value={config.max_seq_length} min={128} max={4096} step={128}
                    onChange={(e) => update('max_seq_length', +e.target.value)} />
                </div>
                <div>
                  <label className="label">LoRA Rank (r)</label>
                  <input type="number" className="input" value={config.lora_r} min={4} max={64}
                    onChange={(e) => update('lora_r', +e.target.value)} />
                </div>
                <div>
                  <label className="label">LoRA Alpha</label>
                  <input type="number" className="input" value={config.lora_alpha} min={8} max={128}
                    onChange={(e) => update('lora_alpha', +e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          {/* Dataset upload */}
          <div className="card">
            <h2 className="font-semibold text-gray-100 mb-3">Upload Dataset</h2>
            <p className="text-xs text-gray-500 mb-3">Supports JSONL (recommended), CSV, or plain text. JSONL format: {"{"}"text": "..."{"}"} or {"{"}"instruction": "...", "output": "..."{"}"}</p>

            <div
              className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center cursor-pointer hover:border-primary-700 transition-colors"
              onClick={() => document.getElementById('file-input')?.click()}
            >
              <Upload className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              {file ? (
                <p className="text-sm text-primary-400">{file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)</p>
              ) : (
                <p className="text-sm text-gray-500">Click to select a file</p>
              )}
              <input id="file-input" type="file" accept=".jsonl,.json,.csv,.txt" className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>

            <button onClick={uploadDataset} disabled={!file || !selectedModel || uploading}
              className="btn-secondary w-full justify-center mt-3">
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading...</> : <><Upload className="w-4 h-4" /> Upload Dataset</>}
            </button>
          </div>

          <button onClick={startTraining} disabled={!selectedModel} className="btn-primary w-full justify-center py-3">
            <Wand2 className="w-4 h-4" /> Start Fine-tuning
          </button>
        </div>

        {/* Right: jobs */}
        <div className="space-y-4">
          {jobs.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-100">Training Jobs</h2>
                <button onClick={loadJobs} className="btn-ghost p-1.5"><RefreshCw className="w-4 h-4" /></button>
              </div>
              <div className="space-y-2">
                {jobs.map((job) => {
                  const StatusIcon = STATUS_ICONS[job.status] || Clock
                  return (
                    <div key={job.id} onClick={() => setSelectedJob(job)}
                      className={clsx('flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all',
                        selectedJob?.id === job.id ? 'bg-gray-800' : 'hover:bg-gray-800/50'
                      )}>
                      <StatusIcon className={clsx('w-4 h-4 flex-shrink-0', STATUS_COLORS[job.status],
                        job.status === 'running' && 'animate-spin')} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-200">Job #{job.id}</span>
                          <span className="badge bg-gray-800 text-gray-400">{job.method}</span>
                        </div>
                        {job.status === 'running' && (
                          <div className="mt-1.5 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${job.progress}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-gray-600 flex-shrink-0">
                        {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {selectedJob && (
            <div className="card">
              <h2 className="font-semibold text-gray-100 mb-3">Training Logs</h2>
              <div className={clsx('mb-3 flex items-center gap-2 text-sm', STATUS_COLORS[selectedJob.status])}>
                {(() => { const I = STATUS_ICONS[selectedJob.status] || Clock; return <I className={clsx('w-4 h-4', selectedJob.status === 'running' && 'animate-spin')} /> })()}
                Status: <span className="font-medium">{selectedJob.status}</span>
                {selectedJob.status === 'running' && <span className="ml-auto text-gray-400">{selectedJob.progress.toFixed(1)}%</span>}
              </div>
              {selectedJob.error && (
                <div className="mb-3 p-3 bg-red-900/20 border border-red-800 rounded-lg text-sm text-red-300">
                  {selectedJob.error}
                </div>
              )}
              <pre ref={logsRef} className="bg-gray-950 rounded-lg p-3 text-xs text-gray-400 font-mono overflow-y-auto max-h-64 whitespace-pre-wrap">
                {selectedJob.logs || 'Waiting for logs...'}
              </pre>
            </div>
          )}

          {jobs.length === 0 && !selectedJob && (
            <div className="card flex flex-col items-center justify-center py-16 text-gray-600">
              <Wand2 className="w-12 h-12 mb-3" />
              <p className="font-medium">No training jobs yet</p>
              <p className="text-sm mt-1">Configure and start a training run</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
