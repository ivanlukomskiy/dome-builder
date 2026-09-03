import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Lazy so neither debug page's dependencies (replicad, for the strut-shape one) end up in the
// main app's bundle for everyone else.
const EdgeSketchDebug = lazy(() => import('./debug/EdgeSketchDebug.tsx').then((m) => ({ default: m.EdgeSketchDebug })))
const StrutShapeDebug = lazy(() => import('./debug/StrutShapeDebug.tsx').then((m) => ({ default: m.StrutShapeDebug })))
const FlangeShapeDebug = lazy(() => import('./debug/FlangeShapeDebug.tsx').then((m) => ({ default: m.FlangeShapeDebug })))

// No router dependency for a couple of standalone debug pages - a plain path check, read once at
// load. Navigation is a normal <a href> (full page load), so this also has to work on a fresh
// visit, e.g. `npm run strut-shape-debug` opening straight to its route.
const base = import.meta.env.BASE_URL.replace(/\/+$/, '')
const path = window.location.pathname.replace(/\/+$/, '')

function Page() {
  if (path === `${base}/edge-sketch`) return <EdgeSketchDebug />
  if (path === `${base}/strut-shape-debug`) return <StrutShapeDebug />
  if (path === `${base}/flange-shape-debug`) return <FlangeShapeDebug />
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
)
