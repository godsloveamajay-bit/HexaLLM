import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../store/auth'
import { postLoginPath } from '../lib/devFeatures'
import { isDevSite } from '../dev/isDev'
import toast from 'react-hot-toast'

export default function OAuthCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { loginWithToken } = useAuth()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true

    const token = params.get('token')
    const state = params.get('state')
    const oauthError = params.get('oauth_error')

    if (oauthError) {
      toast.error(`Sign-in failed: ${oauthError.replace(/_/g, ' ')}`)
      navigate('/login', { replace: true })
      return
    }

    // Verify state matches what we stored before redirecting
    const savedState = sessionStorage.getItem('oauth_state')
    if (state && savedState && state !== savedState) {
      toast.error('Sign-in failed: invalid state. Please try again.')
      navigate('/login', { replace: true })
      return
    }
    sessionStorage.removeItem('oauth_state')

    if (!token) {
      toast.error('Sign-in failed: no token received.')
      navigate('/login', { replace: true })
      return
    }

    loginWithToken(token)
      .then(() => {
        const { user } = useAuth.getState()
        if (isDevSite() && !user?.is_admin) {
          localStorage.removeItem('token')
          localStorage.removeItem('user')
          useAuth.setState({ user: null, token: null })
          toast.error('The dev site is restricted to admin accounts.')
          navigate('/login', { replace: true })
          return
        }
        navigate(postLoginPath(!!user?.is_admin), { replace: true })
      })
      .catch(() => {
        toast.error('Sign-in failed. Please try again.')
        navigate('/login', { replace: true })
      })
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        <p className="text-sm">Completing sign-in…</p>
      </div>
    </div>
  )
}
