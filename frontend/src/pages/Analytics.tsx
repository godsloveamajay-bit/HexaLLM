import { useEffect, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from 'recharts'
import { TrendingUp, Zap, Clock, AlertTriangle } from 'lucide-react'
import api from '../lib/api'

const COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444']

export default function AnalyticsPage() {
  const [daily, setDaily] = useState<any[]>([])
  const [modelUsage, setModelUsage] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/analytics/requests/daily?days=30'),
      api.get('/analytics/models/usage'),
    ]).then(([d, m]) => {
      setDaily(d.data)
      setModelUsage(m.data)
    }).finally(() => setLoading(false))
  }, [])

  const totalTokens = daily.reduce((s, d) => s + (d.tokens || 0), 0)
  const totalRequests = daily.reduce((s, d) => s + (d.requests || 0), 0)
  const totalErrors = daily.reduce((s, d) => s + (d.errors || 0), 0)
  const errorRate = totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(1) : '0'

  const ChartCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-100 mb-4">{title}</h2>
      {children}
    </div>
  )

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Analytics</h1>
        <p className="text-gray-400 mt-1">Usage statistics for the last 30 days</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { icon: TrendingUp, label: 'Total Requests', value: totalRequests.toLocaleString(), color: 'bg-primary-600' },
          { icon: Zap, label: 'Total Tokens', value: totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : totalTokens.toString(), color: 'bg-energy-600' },
          { icon: AlertTriangle, label: 'Error Rate', value: `${errorRate}%`, color: 'bg-rose-600' },
          { icon: Clock, label: 'Active Days', value: daily.filter((d) => d.requests > 0).length.toString(), color: 'bg-secondary-600' },
        ].map(({ icon: Icon, label, value, color }) => (
          <div key={label} className="card flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center flex-shrink-0`}>
              <Icon className="w-4 h-4 text-gray-100" />
            </div>
            <div>
              <p className="text-xs text-gray-400">{label}</p>
              <p className="text-xl font-bold text-gray-100">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartCard title="Daily Requests (30 days)">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={daily}>
              <defs>
                <linearGradient id="gr1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false}
                tickFormatter={(d) => d.slice(5)} interval={4} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: 12 }} />
              <Area type="monotone" dataKey="requests" stroke="#6366f1" fill="url(#gr1)" strokeWidth={2} name="Requests" />
              <Area type="monotone" dataKey="errors" stroke="#ef4444" fill="transparent" strokeWidth={1.5} strokeDasharray="4" name="Errors" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Token Usage (30 days)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={daily.slice(-14)}>
              <XAxis dataKey="date" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false}
                tickFormatter={(d) => d.slice(5)} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: 12 }} />
              <Bar dataKey="tokens" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Tokens" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Requests by Model">
          {modelUsage.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data yet</div>
          ) : (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={modelUsage} dataKey="requests" nameKey="model" cx="50%" cy="50%" outerRadius={70} strokeWidth={0}>
                    {modelUsage.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-2">
                {modelUsage.slice(0, 5).map((m, i) => (
                  <div key={m.model} className="flex items-center gap-2 text-sm">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-gray-400 truncate flex-1">{m.model}</span>
                    <span className="text-gray-300 font-medium">{m.requests}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Model Performance">
          {modelUsage.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-600 text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={modelUsage} layout="vertical">
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="model" tick={{ fill: '#9ca3af', fontSize: 10 }} tickLine={false} axisLine={false} width={90} />
                <Tooltip contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', fontSize: 12 }} />
                <Bar dataKey="avg_latency_ms" fill="#06b6d4" radius={[0, 4, 4, 0]} name="Avg Latency (ms)" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  )
}
