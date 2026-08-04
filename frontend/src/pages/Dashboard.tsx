import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageSquare, Cpu, Bot, Zap, TrendingUp, Clock, Activity, ArrowRight } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../lib/api'
import { useAuth } from '../store/auth'
import { formatDistanceToNow } from 'date-fns'

interface Overview {
  total_requests: number
  requests_30d: number
  total_tokens: number
  total_models: number
  total_chats: number
  total_agent_runs: number
  avg_latency_ms: number
}

function StatCard({ icon: Icon, label, value, sub, color }: any) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center flex-shrink-0`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-gray-400 text-sm">{label}</p>
        <p className="text-2xl font-bold text-gray-100 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [dailyData, setDailyData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/analytics/overview'),
      api.get('/analytics/requests/daily?days=14'),
    ]).then(([ov, daily]) => {
      setOverview(ov.data)
      setDailyData(daily.data)
    }).finally(() => setLoading(false))
  }, [])

  const greet = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-100">{greet()}, {user?.username} 👋</h1>
        <p className="text-gray-400 mt-1">Here's what's happening on your AI platform today.</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Activity} label="Total Requests" value={overview?.total_requests?.toLocaleString() ?? '—'} sub="All time" color="bg-primary-600" />
        <StatCard icon={MessageSquare} label="Chat Sessions" value={overview?.total_chats?.toLocaleString() ?? '—'} sub="All time" color="bg-secondary-600" />
        <StatCard icon={Cpu} label="Your Models" value={overview?.total_models?.toLocaleString() ?? '—'} sub="Created" color="bg-primary-600" />
        <StatCard icon={Bot} label="Agent Runs" value={overview?.total_agent_runs?.toLocaleString() ?? '—'} sub="All time" color="bg-green-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <StatCard icon={Zap} label="Tokens Used" value={(overview?.total_tokens ?? 0) > 1000 ? `${((overview?.total_tokens ?? 0) / 1000).toFixed(1)}K` : overview?.total_tokens?.toString() ?? '—'} color="bg-energy-600" />
        <StatCard icon={TrendingUp} label="Requests (30d)" value={overview?.requests_30d?.toLocaleString() ?? '—'} color="bg-energy-600" />
        <StatCard icon={Clock} label="Avg Latency" value={overview?.avg_latency_ms ? `${overview.avg_latency_ms}ms` : '—'} sub="Per request" color="bg-rose-600" />
      </div>

      {/* Chart */}
      <div className="card mb-8">
        <h2 className="text-base font-semibold text-gray-100 mb-4">Request Activity (14 days)</h2>
        {dailyData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#A78BFA" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#A78BFA" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false}
                tickFormatter={(d) => d.slice(5)} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px' }}
                labelStyle={{ color: '#e5e7eb' }} itemStyle={{ color: '#818cf8' }} />
              <Area type="monotone" dataKey="requests" stroke="#A78BFA" fill="url(#grad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-48 flex items-center justify-center text-gray-600">
            {loading ? 'Loading...' : 'No data yet — start chatting!'}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { to: '/chat', icon: MessageSquare, title: 'Start a Chat', desc: 'Talk to any Ollama model', color: 'from-secondary-600 to-primary-600' },
          { to: '/models', icon: Cpu, title: 'Browse Models', desc: 'Discover & share models', color: 'from-primary-600 to-energy-600' },
          { to: '/agents', icon: Bot, title: 'Run an Agent', desc: 'Automate tasks with AI', color: 'from-energy-600 to-secondary-600' },
        ].map(({ to, icon: Icon, title, desc, color }) => (
          <Link key={to} to={to} className="card group hover:border-gray-700 transition-all flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
              <Icon className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-100">{title}</p>
              <p className="text-sm text-gray-500">{desc}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors flex-shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  )
}
