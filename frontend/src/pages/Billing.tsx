import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { CreditCard, Loader2, CheckCircle, XCircle, ExternalLink, ArrowLeft, Zap } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'

interface PlanBrief {
  id: number; name: string; slug: string
}

interface SubscriptionInfo {
  id: number
  plan?: PlanBrief
  status: string
  interval: string
  current_period_end?: string
  cancel_at_period_end: boolean
}

interface PaymentInfo {
  id: number; amount: number; currency: string; status: string; paid_at: string
}

interface BillingState {
  plan?: { id: number; name: string; slug: string; description?: string; price_monthly: number; features: string[] }
  subscription?: SubscriptionInfo
  payments: PaymentInfo[]
}

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-green-500/20 text-green-400',
  pending: 'bg-yellow-500/20 text-yellow-400',
  cancelled: 'bg-red-500/20 text-red-400',
  expired: 'bg-neutral-500/20 text-neutral-400',
  suspended: 'bg-orange-500/20 text-orange-400',
}

export default function BillingPage() {
  const { user, fetchMe } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [state, setState] = useState<BillingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (params.get('success') === 'true') {
      toast.success('Subscription activated!')
      fetchMe()
    }
    if (params.get('cancelled') === 'true') {
      toast('Subscription setup was cancelled')
    }
  }, [])

  useEffect(() => {
    api.get('/billing/my').then(({ data }) => {
      setState(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function handleCancel() {
    if (!confirm('Are you sure you want to cancel your subscription? You will lose access to premium features at the end of the billing period.')) return
    setCancelling(true)
    try {
      await api.post('/billing/cancel')
      toast.success('Subscription cancelled')
      const { data } = await api.get('/billing/my')
      setState(data)
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Failed to cancel')
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    )
  }

  const sub = state?.subscription
  const currentPlan = state?.plan

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <button onClick={() => navigate('/settings')} className="flex items-center gap-1.5 text-sm text-secondary hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Settings
      </button>

      <div className="flex items-center gap-3 mb-8">
        <CreditCard className="w-6 h-6 text-primary-500" />
        <h1 className="text-2xl font-bold">Billing & Plan</h1>
      </div>

      {!sub || sub.status === 'cancelled' || sub.status === 'expired' ? (
        <div className="border border-neutral-700 rounded-xl p-8 text-center">
          <Zap className="w-12 h-12 text-primary-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">You're on the Free Plan</h2>
          <p className="text-secondary mb-6 max-w-md mx-auto">
            Upgrade to Hyper for unlimited access, priority features, and API rate boosts.
          </p>
          <button
            onClick={() => navigate('/pricing')}
            className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            <Zap className="w-4 h-4" /> View Plans
          </button>
        </div>
      ) : (
        <>
          <div className="border border-neutral-700 rounded-xl p-6 mb-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">{currentPlan?.name || 'Unknown'} Plan</h2>
                <p className="text-sm text-secondary">
                  {sub.interval === 'month' ? 'Monthly' : 'Yearly'} subscription
                  {sub.cancel_at_period_end && ' — cancels at period end'}
                </p>
              </div>
              <span className={clsx('text-xs font-medium px-2.5 py-1 rounded-full', STATUS_BADGE[sub.status] || '')}>
                {sub.status}
              </span>
            </div>
            {sub.current_period_end && (
              <div className="text-sm text-secondary">
                Current period ends: {new Date(sub.current_period_end).toLocaleDateString()}
              </div>
            )}
          </div>

          {sub.status === 'active' && !sub.cancel_at_period_end && (
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
              Cancel Subscription
            </button>
          )}

          {state!.payments.length > 0 && (
            <div className="mt-10">
              <h3 className="text-sm font-semibold text-secondary uppercase tracking-wider mb-3">Recent Payments</h3>
              <div className="space-y-2">
                {state!.payments.map(p => (
                  <div key={p.id} className="flex items-center justify-between border border-neutral-700 rounded-lg px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      <span>{p.currency} {p.amount.toFixed(2)}</span>
                    </div>
                    <span className="text-secondary">{new Date(p.paid_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}


