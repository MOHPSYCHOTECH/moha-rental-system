import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const nativeRoleRoute: Record<string, string> = {
  landlord: '/landlord',
  caretaker: '/caretaker',
  tenant: '/tenant',
}
const nativeStartPath = nativeRoleRoute[import.meta.env.VITE_NATIVE_APP_ROLE ?? '']
if (nativeStartPath && (window.location.pathname === '/' || window.location.pathname === '/index.html')) {
  window.history.replaceState(null, '', nativeStartPath)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
