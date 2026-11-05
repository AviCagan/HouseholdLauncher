import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// First, before anything that can pull in its own stylesheet. Vite emits CSS
// in import order, and cascade layers take their precedence from the order
// they are first seen: an app stylesheet bundled ahead of this one declared
// `components` as the lowest layer, and Tailwind's preflight in `base` then
// stripped the borders off every input in Meals.
import './styles/index.css'
import App from './App.tsx'
import { setupServiceWorker } from './lib/serviceWorker'
import { installSafeArea } from './lib/safeArea'
import { startAppUpdates } from './lib/appUpdate'

// Registers on the web, tears down on native — see the module for why the APK
// must not have one.
setupServiceWorker()

// The Android app's over-the-air updates. First thing on native, because it
// also confirms to the updater that this bundle started — without that within
// a few seconds it puts the previous bundle back. Does nothing on the web,
// which the service worker already keeps current.
startAppUpdates()

// Before the first render: every header's top padding is derived from these,
// so resolving them afterwards would show one frame of content tucked under
// the status bar on exactly the devices this exists to fix.
installSafeArea()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
