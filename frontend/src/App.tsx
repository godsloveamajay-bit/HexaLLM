import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './store/auth'
import Layout from './components/layout/Layout'
import MobileLayout from './components/layout/MobileLayout'
import { isCapacitor } from './lib/platform'
import LoginPage from './pages/Login'
import RegisterPage from './pages/Register'
import DashboardPage from './pages/Dashboard'
import ChatPage from './pages/Chat'
import AgentsPage from './pages/Agents'
import ModelsPage from './pages/Models'
import TrainPage from './pages/Train'
import AnalyticsPage from './pages/Analytics'
import LogsPage from './pages/Logs'
import ApiKeysPage from './pages/ApiKeys'
import SettingsPage from './pages/Settings'
import KnowledgePage from './pages/Knowledge'
import PrivacyPolicyPage from './pages/PrivacyPolicy'
import ImageGenPage from './pages/ImageGen'
import SharePage from './pages/Share'
import MemoryPage from './pages/Memory'
import PersonasPage from './pages/Personas'
import WorkflowsPage from './pages/Workflows'
import MCPServersPage from './pages/MCPServers'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  return user?.is_admin ? <>{children}</> : <Navigate to="/chat" replace />
}

// Use mobile bottom-nav layout on Capacitor native apps
const AppLayout = isCapacitor() ? MobileLayout : Layout

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/privacy" element={<PrivacyPolicyPage />} />
      <Route path="/share/:token" element={<SharePage />} />
      <Route
        element={
          <PrivateRoute>
            <AppLayout />
          </PrivateRoute>
        }
      >
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/dashboard" element={<AdminRoute><DashboardPage /></AdminRoute>} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/image" element={<ImageGenPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/train" element={<TrainPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/personas" element={<PersonasPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/mcp" element={<MCPServersPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
