import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Same order rule as src/main.tsx: the global stylesheet first, so cascade
// layers are declared before any app stylesheet can declare them differently.
import '../styles/index.css'
import './desktop.css'
import { DesktopApp } from './DesktopApp'
import { setSurface } from '@/lib/surface'
import { setupServiceWorker } from '@/lib/serviceWorker'
import { syncRouteWithHash } from './route'
import { rememberLayout } from '@/lib/layoutChoice'

// Before anything renders: every Sheet asks this to decide how to draw itself.
setSurface('desktop')
rememberLayout('desktop')

// The same worker as the phone page — one scope covers both — which is what
// makes Web Push work in a desktop browser as well.
setupServiceWorker()

// `#/meals` in the address bar opens Meals, and back/forward move between apps.
syncRouteWithHash()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopApp />
  </StrictMode>,
)
