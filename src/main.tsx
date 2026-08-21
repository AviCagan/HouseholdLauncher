import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { setupServiceWorker } from './lib/serviceWorker'
import { installSafeArea } from './lib/safeArea'
import './styles/index.css'

// Registers on the web, tears down on native — see the module for why the APK
// must not have one.
setupServiceWorker()

// Before the first render: every header's top padding is derived from these,
// so resolving them afterwards would show one frame of content tucked under
// the status bar on exactly the devices this exists to fix.
installSafeArea()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
