import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { EdgeSketchDebug } from './debug/EdgeSketchDebug.tsx'

// No router dependency for one standalone debug page - a plain path check, read once at load.
// Navigation is a normal <a href> (full page load), so this also has to work on a fresh visit.
const isEdgeSketchDebug = window.location.pathname.replace(/\/+$/, '') === `${import.meta.env.BASE_URL}edge-sketch`.replace(/\/+$/, '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isEdgeSketchDebug ? <EdgeSketchDebug /> : <App />}</StrictMode>,
)
