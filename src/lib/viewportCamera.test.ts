import { describe, expect, it } from 'vitest'
import { fitCameraDistance, viewportFrame, viewportGridStep } from './viewportCamera'

describe('viewport camera sizing', () => {
  const bounds = { minX: -100, maxX: 100, minY: 20, maxY: 220, minZ: -50, maxZ: 50 }

  it('centers the model and includes room for protruding parts', () => {
    const frame = viewportFrame(bounds, 200, 30)
    expect(frame.center).toEqual([0, 120, 0])
    expect(frame.radius).toBeCloseTo(180)
    expect(frame.groundY).toBeLessThan(bounds.minY)
  })

  it('fits a narrow viewport by using its horizontal field of view', () => {
    const radius = 200
    const narrowDistance = fitCameraDistance(radius, 0.5)
    expect(narrowDistance).toBeGreaterThan(fitCameraDistance(radius, 2))
    const halfHorizontalFov = Math.atan(Math.tan(Math.PI / 8) * 0.5)
    expect(Math.asin(radius / narrowDistance)).toBeLessThan(halfHorizontalFov)
  })

  it('keeps tiny and empty models navigable', () => {
    expect(viewportFrame(null, 0, 0).radius).toBe(1)
    expect(viewportGridStep(1)).toBeGreaterThan(0)
    expect(viewportGridStep(1000)).toBeGreaterThan(viewportGridStep(10))
  })
})
