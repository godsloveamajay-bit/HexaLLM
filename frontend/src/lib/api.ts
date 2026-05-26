import axios from 'axios'

// In Tauri production builds set VITE_API_URL to your hosted backend, e.g.:
//   VITE_API_URL=https://api.yourserver.com/api/v1
// In web dev the Vite proxy rewrites /api → localhost:8000, so no env var is needed.
export const baseURL = import.meta.env.VITE_API_URL || '/api/v1'

export const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (error) => {
    const url = error.config?.url ?? ''
    const isAuthEndpoint = url.includes('/auth/')
    if (error.response?.status === 401 && !isAuthEndpoint) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
