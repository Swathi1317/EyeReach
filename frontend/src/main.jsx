import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'

// Production Backend API URL Configuration
// If VITE_API_BASE_URL is provided (e.g. Render production URL on Vercel),
// configure Axios globally. If not set (local dev), leave empty to use Vite dev proxy.
const apiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
if (apiBase) {
  axios.defaults.baseURL = apiBase
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
