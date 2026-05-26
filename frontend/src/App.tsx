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
const LoginPage    = lazy(() => import('./pages/Login'))
const RegisterPage = lazy(() => import('./pages/Register'))
const PrivacyPage  = lazy(() => import('./pages/PrivacyPolicy'))
const ForgotPage   = lazy(() => import('./pages/ForgotPassword'))
const ResetPage    = lazy(() => import('./pages/ResetPassword'))
const SharePage    = lazy(() => import('./pages/Share'))

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

          <Route element={<PrivateRoute><AppLayout /></PrivateRoute>}>
            <Route path="/"           element={<Navigate to="/chat" replace />} />
            <Route path="/dashboard"  element={<AdminRoute><DashboardPage /></AdminRoute>} />
            <Route path="/chat"       element={<ChatPage />} />
            <Route path="/image"      element={<ImageGenPage />} />
            <Route path="/agents"     element={<AgentsPage />} />
            <Route path="/models"     element={<ModelsPage />} />
            <Route path="/train"      element={<TrainPage />} />
            <Route path="/knowledge"  element={<KnowledgePage />} />
            <Route path="/memory"     element={<MemoryPage />} />
            <Route path="/personas"   element={<PersonasPage />} />
            <Route path="/workflows"  element={<WorkflowsPage />} />
            <Route path="/mcp"        element={<MCPServersPage />} />
            <Route path="/remote-cli" element={<RemoteCLIPage />} />
            <Route path="/downloads"  element={<DownloadsPage />} />
            <Route path="/analytics"  element={<AnalyticsPage />} />
            <Route path="/logs"       element={<LogsPage />} />
            <Route path="/api-keys"   element={<ApiKeysPage />} />
            <Route path="/settings"   element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  )
}
