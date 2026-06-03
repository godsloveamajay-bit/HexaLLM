import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './store/auth'
import { isCapacitor } from './lib/platform'
import Layout from './components/layout/Layout'
import MobileLayout from './components/layout/MobileLayout'
import CommandPalette from './components/ui/CommandPalette'

function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-full min-h-[60vh]">
      <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

// Public pages
const LoginPage        = lazy(() => import('./pages/Login'))
const RegisterPage     = lazy(() => import('./pages/Register'))
const PrivacyPage      = lazy(() => import('./pages/PrivacyPolicy'))
const ForgotPage       = lazy(() => import('./pages/ForgotPassword'))
const ResetPage        = lazy(() => import('./pages/ResetPassword'))
const SharePage        = lazy(() => import('./pages/Share'))
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallback'))

// Authenticated pages — all lazy-loaded so the initial bundle stays tiny
const ChatPage       = lazy(() => import('./pages/Chat'))
const DashboardPage  = lazy(() => import('./pages/Dashboard'))
const AgentsPage     = lazy(() => import('./pages/Agents'))
const ModelsPage     = lazy(() => import('./pages/Models'))
const TrainPage      = lazy(() => import('./pages/Train'))
const AnalyticsPage  = lazy(() => import('./pages/Analytics'))
const LogsPage       = lazy(() => import('./pages/Logs'))
const ApiKeysPage    = lazy(() => import('./pages/ApiKeys'))
const SettingsPage   = lazy(() => import('./pages/Settings'))
const KnowledgePage  = lazy(() => import('./pages/Knowledge'))
const ImageGenPage   = lazy(() => import('./pages/ImageGen'))
const MemoryPage     = lazy(() => import('./pages/Memory'))
const PersonasPage   = lazy(() => import('./pages/Personas'))
const WorkflowsPage  = lazy(() => import('./pages/Workflows'))
const MCPServersPage = lazy(() => import('./pages/MCPServers'))
const RemoteCLIPage  = lazy(() => import('./pages/RemoteCLI'))
const DownloadsPage  = lazy(() => import('./pages/Downloads'))

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user?.is_admin ? <>{children}</> : <Navigate to="/chat" replace />
}

const AppLayout = isCapacitor() ? MobileLayout : Layout

export default function App() {
  return (
    <>
      <CommandPalette />
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/login"           element={<LoginPage />} />
          <Route path="/register"        element={<RegisterPage />} />
          <Route path="/privacy"         element={<PrivacyPage />} />
          <Route path="/forgot-password" element={<ForgotPage />} />
          <Route path="/reset-password"  element={<ResetPage />} />
          <Route path="/share/:token"    element={<SharePage />} />
          <Route path="/oauth/callback"  element={<OAuthCallbackPage />} />

          {/* One layout for everything. Chat is open to guests (limited);
              every other page is wrapped in PrivateRoute so it stays gated. */}
          <Route element={<AppLayout />}>
            <Route path="/"           element={<Navigate to="/chat" replace />} />
            <Route path="/chat"       element={<ChatPage />} />
            <Route path="/dashboard"  element={<PrivateRoute><AdminRoute><DashboardPage /></AdminRoute></PrivateRoute>} />
            <Route path="/image"      element={<PrivateRoute><ImageGenPage /></PrivateRoute>} />
            <Route path="/agents"     element={<PrivateRoute><AgentsPage /></PrivateRoute>} />
            <Route path="/models"     element={<PrivateRoute><ModelsPage /></PrivateRoute>} />
            <Route path="/train"      element={<PrivateRoute><TrainPage /></PrivateRoute>} />
            <Route path="/knowledge"  element={<PrivateRoute><KnowledgePage /></PrivateRoute>} />
            <Route path="/memory"     element={<PrivateRoute><MemoryPage /></PrivateRoute>} />
            <Route path="/personas"   element={<PrivateRoute><PersonasPage /></PrivateRoute>} />
            <Route path="/workflows"  element={<PrivateRoute><WorkflowsPage /></PrivateRoute>} />
            <Route path="/mcp"        element={<PrivateRoute><MCPServersPage /></PrivateRoute>} />
            <Route path="/remote-cli" element={<PrivateRoute><RemoteCLIPage /></PrivateRoute>} />
            <Route path="/downloads"  element={<PrivateRoute><DownloadsPage /></PrivateRoute>} />
            <Route path="/analytics"  element={<PrivateRoute><AnalyticsPage /></PrivateRoute>} />
            <Route path="/logs"       element={<PrivateRoute><LogsPage /></PrivateRoute>} />
            <Route path="/api-keys"   element={<PrivateRoute><ApiKeysPage /></PrivateRoute>} />
            <Route path="/settings"   element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
          </Route>
        </Routes>
      </Suspense>
    </>
  )
}
