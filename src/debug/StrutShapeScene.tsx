import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import type { StrutMesh } from '../lib/replicadCad'

export interface StrutShapeViewport {
  target: [number, number, number]
  distance: number
}

const FILL_COLOR = '#5b9bd5'
const WIREFRAME_COLOR = '#2dd4bf'

function meshToGeometry(mesh: StrutMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3))
  geometry.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1))
  return geometry
}

function extendBoundingBox(mesh: StrutMesh, box: { minX: number; maxX: number; minY: number; maxY: number }) {
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i]
    const y = mesh.positions[i + 1]
    box.minX = Math.min(box.minX, x)
    box.maxX = Math.max(box.maxX, x)
    box.minY = Math.min(box.minY, y)
    box.maxY = Math.max(box.maxY, y)
  }
}

interface HelperMesh {
  mesh: StrutMesh
  color: string
  name: string
}

interface StrutShapeSceneProps {
  main: StrutMesh | null
  helpers: HelperMesh[]
  // Camera state (pan target + zoom distance) to start from instead of fitting to the shape's
  // bounding box - lets the caller restore whatever view the user left the page on. Only read on
  // mount (see `useInitialCameraFit`); pass a new `key` on the component to force a re-fit.
  initialViewport?: StrutShapeViewport | null
  // Fires (debounced) whenever the user pans or zooms, so the caller can persist the result.
  onViewportChange?: (viewport: StrutShapeViewport) => void
}

function boundingBoxOf({ main, helpers }: StrutShapeSceneProps) {
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  if (main) extendBoundingBox(main, box)
  for (const helper of helpers) extendBoundingBox(helper.mesh, box)
  if (!Number.isFinite(box.minX)) return { minX: -50, maxX: 50, minY: -50, maxY: 50 }
  return box
}

// A fixed, orientation-locked camera (no rotation - this renders a flat 2D shape from directly
// above) that the user can still pan and zoom, same as the main dome viewport and the edge-sketch
// debug view. Fit once to the shapes present on mount (main plus every helper, so a reference
// line reaching further out than `main` still stays in frame); later updates (from editing
// strutGeometryManual.ts and tweaking params) reshape the geometry without yanking the camera
// around.
function useInitialCameraFit(props: StrutShapeSceneProps) {
  const [fit] = useState(() => {
    const fov = 45
    if (props.initialViewport) return { ...props.initialViewport, fov }

    const { minX, maxX, minY, maxY } = boundingBoxOf(props)
    const width = maxX - minX
    const height = maxY - minY
    const maxDim = Math.max(width, height, 10)
    const distance = (maxDim / 2 / Math.tan((fov * Math.PI) / 360)) * 1.7
    const target: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, 0]
    return { target, distance, fov }
  })
  return fit
}

// Debounces OrbitControls' `change` events (which fire continuously mid-drag) down to one
// `onViewportChange` call ~300ms after the user stops panning/zooming - cheap enough to persist
// on every call without janking the interaction itself.
function useViewportChangeHandler(onViewportChange?: (viewport: StrutShapeViewport) => void) {
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  return (event?: { target?: { target: THREE.Vector3; object: THREE.Camera } }) => {
    if (!onViewportChange) return
    const controls = event?.target
    if (!controls) return

    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => {
      const t = controls.target
      const distance = controls.object.position.distanceTo(t)
      onViewportChange({ target: [t.x, t.y, t.z], distance })
    }, 300)
  }
}

function MainShape({ mesh }: { mesh: StrutMesh }) {
  const geometry = useMemo(() => meshToGeometry(mesh), [mesh])
  // Plain `wireframe` draws every triangle edge, including the internal diagonals the mesher
  // adds to triangulate an otherwise-flat face - which is what read as stray "lighter lines"
  // across the shape. EdgesGeometry keeps only edges where adjacent faces meet at an angle (the
  // real boundary/cut outlines), dropping the coplanar triangulation edges, so this draws a
  // clean thin border instead.
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry])
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={FILL_COLOR} side={THREE.DoubleSide} roughness={0.6} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={WIREFRAME_COLOR} />
      </lineSegments>
    </group>
  )
}

function HelperShape({
  mesh,
  color,
  name,
  onHover,
  onSelect,
}: HelperMesh & { onHover: (name: string | null) => void; onSelect: (name: string) => void }) {
  const geometry = useMemo(() => meshToGeometry(mesh), [mesh])
  return (
    <mesh
      geometry={geometry}
      position={[0, 0, 0.5]}
      onPointerOver={(e) => {
        e.stopPropagation()
        onHover(name)
      }}
      onPointerOut={(e) => {
        e.stopPropagation()
        onHover(null)
      }}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(name)
      }}
    >
      <meshBasicMaterial color={color} side={THREE.DoubleSide} />
    </mesh>
  )
}

function SceneContents({
  main,
  helpers,
  onHoverHelper,
  onSelectHelper,
}: StrutShapeSceneProps & { onHoverHelper: (name: string | null) => void; onSelectHelper: (name: string) => void }) {
  return (
    <group>
      {main && <MainShape mesh={main} />}
      {helpers.map((helper, i) => (
        <HelperShape
          key={i}
          mesh={helper.mesh}
          color={helper.color}
          name={helper.name}
          onHover={onHoverHelper}
          onSelect={onSelectHelper}
        />
      ))}
    </group>
  )
}

// Hovering a helper shape shows its `name` (set in strutGeometryManual.ts) in a small tooltip
// that follows the cursor - lets you point at a marker in the viewport and immediately see which
// computed point/line it is, instead of matching colors against the source by eye. Clicking one
// copies that name to the clipboard, so you can paste it straight into a console.log or the
// source itself.
export function StrutShapeScene(props: StrutShapeSceneProps) {
  const { target, distance, fov } = useInitialCameraFit(props)
  const handleControlsChange = useViewportChangeHandler(props.onViewportChange)
  const [hoveredName, setHoveredName] = useState<string | null>(null)
  const [copiedName, setCopiedName] = useState<string | null>(null)
  const [pointer, setPointer] = useState({ x: 0, y: 0 })
  const copyResetRef = useRef<number | null>(null)

  const handleSelect = (name: string) => {
    void navigator.clipboard.writeText(name).then(() => {
      setCopiedName(name)
      if (copyResetRef.current) window.clearTimeout(copyResetRef.current)
      copyResetRef.current = window.setTimeout(() => setCopiedName(null), 1200)
    })
  }

  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onPointerMove={(e) => setPointer({ x: e.clientX, y: e.clientY })}
    >
      <Canvas>
        <color attach="background" args={['#12141a']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[0, 0, distance]} intensity={1.2} />
        <PerspectiveCamera
          makeDefault
          position={[target[0], target[1], target[2] + distance]}
          up={[0, 1, 0]}
          fov={fov}
          near={1}
          far={distance * 100}
        />
        <OrbitControls
          makeDefault
          enableRotate={false}
          target={target}
          enableDamping
          dampingFactor={0.08}
          mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
          touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }}
          onChange={handleControlsChange}
        />
        <SceneContents {...props} onHoverHelper={setHoveredName} onSelectHelper={handleSelect} />
      </Canvas>
      {hoveredName && (
        <div
          style={{
            position: 'fixed',
            left: pointer.x + 14,
            top: pointer.y + 14,
            pointerEvents: 'none',
            background: 'rgba(18, 20, 26, 0.9)',
            color: '#fff',
            padding: '3px 8px',
            borderRadius: 4,
            fontSize: 12,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          {copiedName === hoveredName ? `${hoveredName} ✓ copied` : hoveredName}
        </div>
      )}
    </div>
  )
}
