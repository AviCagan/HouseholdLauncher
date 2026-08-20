import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { setupServiceWorker } from './lib/serviceWorker'
import './styles/index.css'

// Registers on the web, tears down on native — see the module for why the APK
// must not have one.
setupServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
