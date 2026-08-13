import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App'
import { useAuth } from './store/auth'
import './index.css'

// One account everywhere: when there's no local Bearer token, the backend
// may still have our shared session cookie (ai.hexallm.co.uk ↔ dev.hexallm.co.uk).
// Probe /auth/me so the cookie session restores the signed-in state.
const { token: bootToken, fetchMe } = useAuth.getState()
if (!bootToken) fetchMe()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          className: 'dark:bg-gray-800 dark:text-gray-100 bg-white text-gray-900',
          duration: 3000,
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
)
