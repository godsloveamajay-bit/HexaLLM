import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './store/auth'
import { isCapacitor } from './lib/platform'
import { DEV_FEATURES } from './lib/devFeatures'
import { isDevSite } from './dev/isDev'
import Layout from './components/layout/Layout'
import MobileLayout from './components/layout/MobileLayout'
import CommandPalette from './components/ui/CommandPalette'
import DevPortal from './dev/DevPortal'

function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Public pages
const LandingPage     = lazy(() => import('./pages/Landing'))
const LoginPage        = lazy(() => import('./pages/Login'))
const RegisterPage     = lazy(() => import('./pages/Register'))
const PrivacyPage      = lazy(() => import('./pages/PrivacyPolicy'))
const ForgotPage       = lazy(() => import('./pages/ForgotPassword'))
const ResetPage        = lazy(() => import('./pages/ResetPassword'))
const SharePage        = lazy(() => import('./pages/Share'))
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallback'))
const DownloadsPage    = lazy(() => import('./pages/Downloads'))

// Authenticated pages — all lazy-loaded so the initial bundle stays tiny
const ChatPage       = lazy(() => import('./pages/Chat'))
const ModelsPage     = lazy(() => import('./pages/Models'))
const AdminPage      = lazy(() => import('./pages/Admin'))
const SettingsPage   = lazy(() => import('./pages/Settings'))
const PricingPage    = lazy(() => import('./pages/Pricing'))
const BillingPage    = lazy(() => import('./pages/Billing'))
const ImageGenPage   = lazy(() => import('./pages/ImageGen'))
const VideoGenPage   = lazy(() => import('./pages/VideoGen'))
const MemoryPage     = lazy(() => import('./pages/Memory'))
const TrainPage      = lazy(() => import('./pages/Train'))

// Dev-variant pages — only bundled/routed when VITE_DEV_FEATURES=1.
const DevPages: Record<string, React.LazyExoticComponent<() => JSX.Element>> = DEV_FEATURES ? {
  Dashboard: lazy(() => import('./pages/Dashboard')),
  Agents:    lazy(() => import('./pages/Agents')),
  Analytics: lazy(() => import('./pages/Analytics')),
  ApiKeys:   lazy(() => import('./pages/ApiKeys')),
  Knowledge: lazy(() => import('./pages/Knowledge')),
  MemoryGraph: lazy(() => import('./pages/MemoryGraph')),
  Tools:     lazy(() => import('./pages/Tools')),
  Personas:  lazy(() => import('./pages/Personas')),
  Workflows: lazy(() => import('./pages/Workflows')),
  MCPServers: lazy(() => import('./pages/MCPServers')),
  RemoteCLI: lazy(() => import('./pages/RemoteCLI')),
  Logs:      lazy(() => import('./pages/Logs')),
} : {}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user?.is_admin ? <>{children}</> : <Navigate to="/chat" replace />
}

const AppLayout = isCapacitor() ? MobileLayout : Layout

export default function App() {
  // The dev host (dev.hexallm.co.uk / localhost) serves a completely
  // separate developer portal — never the consumer site.
  if (isDevSite()) {
    return (
      <Suspense fallback={<PageSpinner />}>
        <DevPortal />
      </Suspense>
    )
  }
  return (
    <>
      <CommandPalette />
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/"             element={<LandingPage />} />
          <Route path="/login"        element={<LoginPage />} />
          <Route path="/register"        element={<RegisterPage />} />
          <Route path="/privacy"         element={<PrivacyPage />} />
          <Route path="/forgot-password" element={<ForgotPage />} />
          <Route path="/reset-password"  element={<ResetPage />} />
          <Route path="/share/:token"    element={<SharePage />} />
          <Route path="/oauth/callback"  element={<OAuthCallbackPage />} />
          <Route path="/pricing"        element={<PricingPage />} />
          <Route path="/downloads"      element={<DownloadsPage />} />

          {/* One layout for everything. Chat is open to guests (limited);
              every other page is wrapped in PrivateRoute so it stays gated. */}
          <Route element={<AppLayout />}>
            <Route path="/"           element={<Navigate to="/chat" replace />} />
            <Route path="/chat"       element={<ChatPage />} />
            <Route path="/admin"      element={<PrivateRoute><AdminRoute><AdminPage /></AdminRoute></PrivateRoute>} />
            <Route path="/image"      element={<PrivateRoute><ImageGenPage /></PrivateRoute>} />
            <Route path="/video"      element={<PrivateRoute><VideoGenPage /></PrivateRoute>} />
            <Route path="/models"     element={<PrivateRoute><ModelsPage /></PrivateRoute>} />
            <Route path="/train"      element={<PrivateRoute><TrainPage /></PrivateRoute>} />
            <Route path="/memory"     element={<PrivateRoute><MemoryPage /></PrivateRoute>} />
            <Route path="/settings"   element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
            <Route path="/billing"    element={<PrivateRoute><BillingPage /></PrivateRoute>} />

            {DEV_FEATURES && (
              <>
                <Route path="/dashboard"  element={<PrivateRoute><AdminRoute><DevPages.Dashboard /></AdminRoute></PrivateRoute>} />
                <Route path="/agents"     element={<PrivateRoute><DevPages.Agents /></PrivateRoute>} />
                <Route path="/knowledge"  element={<PrivateRoute><DevPages.Knowledge /></PrivateRoute>} />
                <Route path="/memory-graph" element={<PrivateRoute><DevPages.MemoryGraph /></PrivateRoute>} />
                <Route path="/tools"      element={<PrivateRoute><DevPages.Tools /></PrivateRoute>} />
                <Route path="/personas"   element={<PrivateRoute><DevPages.Personas /></PrivateRoute>} />
                <Route path="/workflows"  element={<PrivateRoute><DevPages.Workflows /></PrivateRoute>} />
                <Route path="/mcp"        element={<PrivateRoute><DevPages.MCPServers /></PrivateRoute>} />
                <Route path="/remote-cli" element={<PrivateRoute><DevPages.RemoteCLI /></PrivateRoute>} />
                <Route path="/analytics"  element={<PrivateRoute><DevPages.Analytics /></PrivateRoute>} />
                <Route path="/api-keys"   element={<PrivateRoute><DevPages.ApiKeys /></PrivateRoute>} />
                <Route path="/logs"       element={<PrivateRoute><AdminRoute><DevPages.Logs /></AdminRoute></PrivateRoute>} />
              </>
            )}
          </Route>
        </Routes>
      </Suspense>
    </>
  )
}
