import type { ModelBounds } from './polyhedra'

export interface ViewportFrame {
  center: [number, number, number]
  radius: number
  groundY: number
}

const MIN_RADIUS = 1
const FOV_DEGREES = 45

// The model is measured in millimetres. Include room for struts and hardware that
// extend beyond the vertex positions, especially on very small domes.
export function viewportFrame(bounds: ModelBounds | null, diameter: number, partMargin: number): ViewportFrame {
  if (!bounds) {
    const radius = Math.max(Math.abs(diameter) / 2, partMargin, MIN_RADIUS)
    return { center: [0, 0, 0], radius, groundY: -radius }
  }
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const depth = bounds.maxZ - bounds.minZ
  const radius = Math.max(Math.hypot(width, height, depth) / 2 + Math.max(partMargin, 0), MIN_RADIUS)
  return {
    center: [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, (bounds.minZ + bounds.maxZ) / 2],
    radius,
    groundY: bounds.minY - radius * 0.02,
  }
}

// Fit the enclosing sphere in the narrower of the canvas's horizontal and
// vertical fields of view. This also works for tall, narrow viewports.
export function fitCameraDistance(radius: number, aspect: number): number {
  const verticalHalfFov = (FOV_DEGREES * Math.PI) / 360
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(aspect, 0.01))
  return radius * 1.25 / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov))
}

export function viewportGridStep(radius: number): number {
  const rough = Math.max(radius / 10, 0.01)
  const power = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / power
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power
}
