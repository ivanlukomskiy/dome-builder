import { useMemo, useState } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import type { StrutMesh } from '../lib/replicadCad'

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
}

interface StrutShapeSceneProps {
  main: StrutMesh | null
  helpers: HelperMesh[]
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
    const { minX, maxX, minY, maxY } = boundingBoxOf(props)
    const width = maxX - minX
    const height = maxY - minY
    const maxDim = Math.max(width, height, 10)
    const fov = 45
    const distance = (maxDim / 2 / Math.tan((fov * Math.PI) / 360)) * 1.7
    const target: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, 0]
    return { target, distance, fov }
  })
  return fit
}

function MainShape({ mesh }: { mesh: StrutMesh }) {
  const geometry = useMemo(() => meshToGeometry(mesh), [mesh])
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={FILL_COLOR} side={THREE.DoubleSide} roughness={0.6} />
      </mesh>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={WIREFRAME_COLOR} wireframe side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function HelperShape({ mesh, color }: HelperMesh) {
  const geometry = useMemo(() => meshToGeometry(mesh), [mesh])
  return (
    <mesh geometry={geometry} position={[0, 0, 0.5]}>
      <meshBasicMaterial color={color} side={THREE.DoubleSide} />
    </mesh>
  )
}

function SceneContents({ main, helpers }: StrutShapeSceneProps) {
  return (
    <group>
      {main && <MainShape mesh={main} />}
      {helpers.map((helper, i) => (
        <HelperShape key={i} mesh={helper.mesh} color={helper.color} />
      ))}
    </group>
  )
}

export function StrutShapeScene(props: StrutShapeSceneProps) {
  const { target, distance, fov } = useInitialCameraFit(props)

  return (
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
      />
      <SceneContents {...props} />
    </Canvas>
  )
}
