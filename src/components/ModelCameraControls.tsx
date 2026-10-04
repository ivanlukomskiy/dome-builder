import { useLayoutEffect, useRef, type ComponentRef } from 'react'
import { useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { fitCameraDistance, type ViewportFrame } from '../lib/viewportCamera'
import type { ViewMode } from '../App'

interface Props {
  frame: ViewportFrame
  diameter: number
  mode: ViewMode
  topologyKey: string
  fitRequest: number
}

const VIEW_DIRECTION = new THREE.Vector3(0.875, 0.7, 1).normalize()

export function ModelCameraControls({ frame, diameter, mode, topologyKey, fitRequest }: Props) {
  const { camera, size } = useThree()
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const previous = useRef<{ frame: ViewportFrame; diameter: number; mode: ViewMode; topologyKey: string; fitRequest: number } | null>(null)

  useLayoutEffect(() => {
    const controls = controlsRef.current
    if (!controls || !(camera instanceof THREE.PerspectiveCamera)) return

    const center = new THREE.Vector3(...frame.center)
    const minDistance = frame.radius * 0.03
    const maxDistance = frame.radius * 40
    controls.minDistance = minDistance
    controls.maxDistance = maxDistance
    camera.near = Math.max(frame.radius / 1000, 0.001)
    camera.far = frame.radius * 100
    camera.updateProjectionMatrix()

    const last = previous.current
    const fit = !last || fitRequest !== last.fitRequest ||
      (mode === 'new' && (last.mode !== 'new' || topologyKey !== last.topologyKey))
    if (fit) {
      const distance = Math.min(fitCameraDistance(frame.radius, size.width / Math.max(size.height, 1)), maxDistance)
      controls.target.copy(center)
      camera.position.copy(center).addScaledVector(VIEW_DIRECTION, distance)
    } else if (diameter !== last.diameter && last.diameter > 0) {
      // A diameter edit should preserve the orbit angle, pan, and relative zoom.
      const ratio = frame.radius / last.frame.radius
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(ratio)
      controls.target.sub(new THREE.Vector3(...last.frame.center)).multiplyScalar(ratio).add(center)
      camera.position.copy(controls.target).add(offset)
    }

    // A resized model can put the old camera outside the new zoom range.
    const offset = camera.position.clone().sub(controls.target)
    const distance = offset.length()
    if (distance > 0) camera.position.copy(controls.target).addScaledVector(offset, THREE.MathUtils.clamp(distance, minDistance, maxDistance) / distance)
    controls.update()
    previous.current = { frame, diameter, mode, topologyKey, fitRequest }
  }, [camera, diameter, fitRequest, frame, mode, size.height, size.width, topologyKey])

  return <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} />
}
