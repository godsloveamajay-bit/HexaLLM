import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2, ExternalLink, Zap, ChevronDown } from 'lucide-react'
import api from '../lib/api'
import { useAuth } from '../store/auth'
import toast from 'react-hot-toast'
import { clsx } from 'clsx'

interface Plan {
  id: number
  name: string
  slug: string
  description?: string
  price_monthly: number
  price_yearly: number
  currency: string
  features: string[]
  limits: Record<string, number | boolean>
  sort_order: number
}

const CURRENCIES: Record<string, { label: string; symbol: string; rate: number }> = {
  USD: { label: 'US Dollar', symbol: '$', rate: 1 },
  EUR: { label: 'Euro', symbol: '€', rate: 0.92 },
  GBP: { label: 'British Pound', symbol: '£', rate: 0.79 },
  CAD: { label: 'Canadian Dollar', symbol: 'CA$', rate: 1.36 },
  AUD: { label: 'Australian Dollar', symbol: 'A$', rate: 1.53 },
  JPY: { label: 'Japanese Yen', symbol: '¥', rate: 149 },
}

const STORAGE_KEY = 'hexallm_currency'

function getSavedCurrency(): string {
  try { return localStorage.getItem(STORAGE_KEY) || 'USD' } catch { return 'USD' }
}

function saveCurrency(c: string) {
  try { localStorage.setItem(STORAGE_KEY, c) } catch {}
}

function formatPrice(usd: number, currency: string): string {
  const info = CURRENCIES[currency]
  if (!info) return `$${usd.toFixed(2)}`
  const converted = usd * info.rate
  if (currency === 'JPY') return `${info.symbol}${Math.round(converted).toLocaleString()}`
  return `${info.symbol}${converted.toFixed(2)}`
}

export default function PricingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [yearly, setYearly] = useState(false)
  const [currency, setCurrency] = useState(getSavedCurrency)
  const [showCurrencyMenu, setShowCurrencyMenu] = useState(false)

  useEffect(() => {
    api.get('/billing/plans').then(({ data }) => {
      setPlans(data)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [])

  async function handleSubscribe(planSlug: string) {
    if (!user) {
      navigate('/register')
      return
    }
    setSubscribing(planSlug)
    try {
      const { data } = await api.post('/billing/subscribe', {
        plan_slug: planSlug,
        interval: yearly ? 'year' : 'month',
      })
      window.location.href = data.approval_url
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Subscription failed')
    } finally {
      setSubscribing(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    )
  }

  const freePlan = plans.find(p => p.price_monthly === 0)
  const paidPlans = plans.filter(p => p.price_monthly > 0)

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="text-center mb-12">
        <h1 className="text-3xl font-bold text-foreground mb-3">Choose Your Plan</h1>
        <p className="text-secondary max-w-xl mx-auto">
          Unlock more features as your needs grow. All plans include access to HexaLLM AI's core models.
        </p>
      </div>

      <div className="flex items-center justify-center gap-6 mb-10 flex-wrap">
        <div className="flex items-center gap-3">
          <span className={clsx('text-sm font-medium', !yearly && 'text-foreground', yearly && 'text-secondary')}>
            Monthly
          </span>
          <button
            onClick={() => setYearly(!yearly)}
            className={clsx(
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
              yearly ? 'bg-primary-600' : 'bg-neutral-600',
            )}
          >
            <span className={clsx(
              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
              yearly ? 'translate-x-6' : 'translate-x-1',
            )} />
          </button>
          <span className={clsx('text-sm font-medium', yearly && 'text-foreground', !yearly && 'text-secondary')}>
            Yearly <span className="text-xs text-green-500">Save 17%</span>
          </span>
        </div>

        <div className="relative">
          <button
            onClick={() => setShowCurrencyMenu(!showCurrencyMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-600 text-sm text-secondary hover:text-foreground hover:border-neutral-500 transition-colors"
          >
            {CURRENCIES[currency]?.symbol || '$'} {currency}
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          {showCurrencyMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowCurrencyMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 min-w-[140px]">
                {Object.entries(CURRENCIES).map(([code, info]) => (
                  <button
                    key={code}
                    onClick={() => { setCurrency(code); saveCurrency(code); setShowCurrencyMenu(false) }}
                    className={clsx(
                      'w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2',
                      code === currency ? 'text-primary-400 bg-primary-900/20' : 'text-secondary hover:text-foreground hover:bg-neutral-700/50'
                    )}
                  >
                    {info.symbol} {code} — {info.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {freePlan && (
          <div className="border border-neutral-700 rounded-xl p-6 flex flex-col">
            <h2 className="text-xl font-semibold mb-1">{freePlan.name}</h2>
            <p className="text-sm text-secondary mb-4">{freePlan.description}</p>
          <div className="mb-6">
            <span className="text-3xl font-bold">{formatPrice(0, currency)}</span>
            <span className="text-secondary ml-1">/mo</span>
          </div>
            <ul className="space-y-3 mb-8 flex-1">
              {freePlan.features.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 mt-0.5 text-green-500 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => navigate(user ? '/chat' : '/register')}
              className="w-full py-2.5 rounded-lg border border-neutral-600 text-sm font-medium hover:bg-neutral-800 transition-colors"
            >
              {user ? 'Start Chatting' : 'Get Started'}
            </button>
          </div>
        )}

        {paidPlans.map(plan => {
          const price = yearly ? plan.price_yearly / 12 : plan.price_monthly
          const isPopular = plan.slug === 'hyper'
          return (
            <div
              key={plan.id}
              className={clsx(
                'border rounded-xl p-6 flex flex-col relative',
                isPopular ? 'border-primary-500 ring-1 ring-primary-500' : 'border-neutral-700',
              )}
            >
              {isPopular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary-600 text-xs font-semibold px-3 py-1 rounded-full">
                  Most Popular
                </span>
              )}
              <h2 className="text-xl font-semibold mb-1">{plan.name}</h2>
              <p className="text-sm text-secondary mb-4">{plan.description}</p>
              <div className="mb-6">
                <span className="text-3xl font-bold">{formatPrice(price, currency)}</span>
                <span className="text-secondary ml-1">/mo</span>
                {yearly && (
                  <div className="text-xs text-secondary mt-1">{formatPrice(plan.price_yearly, currency)} billed yearly</div>
                )}
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 mt-0.5 text-green-500 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleSubscribe(plan.slug)}
                disabled={subscribing === plan.slug}
                className={clsx(
                  'w-full py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2',
                  isPopular
                    ? 'bg-primary-600 hover:bg-primary-700 text-white'
                    : 'border border-neutral-600 hover:bg-neutral-800',
                )}
              >
                {subscribing === plan.slug ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <><Zap className="w-4 h-4" /> Subscribe with PayPal</>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
