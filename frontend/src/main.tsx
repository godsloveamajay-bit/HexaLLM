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
          duration: 3000,
          className: 'dark:bg-gray-800 dark:text-gray-100 bg-white text-gray-900',
          // Errors borrow the silent-hint language: tiny, muted, unobtrusive.
          error: {
            duration: 4000,
            style: {
              background: 'transparent',
              boxShadow: 'none',
              border: 'none',
              padding: 0,
              fontSize: '11px',
              color: 'rgba(248,113,113,0.85)',
              maxWidth: '300px',
            },
          },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>
)
