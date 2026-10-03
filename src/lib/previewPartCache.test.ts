import { afterEach, describe, expect, it } from 'vitest'
import type { VertexEdgesInfo } from './edgesInfo'
import { DEFAULT_FOOT_PARAMS } from './flangeGeometry'
import type { BraceBody } from './braceSolid'
import type { StrutBuildJob } from '../workers/previewBuilder.worker'
import { bracePreviewKey, footPreviewKey, previewPartCache, strutPreviewKey } from './previewPartCache'

const settings = {
  halfWidth: 60,
  endGrooveLengthPercent: 20,
  midGrooveLengthPercent: 30,
  grooveDepth: 5,
  millingDiameter: 6,
  chamferLength: 2,
  roundStrutBridge: true,
}

const strut: StrutBuildJob = {
  index: 1, vertexA: 1, vertexB: 2,
  posA: [0, 0, 0], posB: [100, 0, 0],
  offsetA: 10, offsetB: 10, cornerLengthA: 20, cornerLengthB: 20,
  beamThickness: 40, thicknessOverride: undefined,
  braces: { a: [], b: [] }, color: [0.1, 0.2, 0.3],
}

const foot = {
  vertexId: 4,
  position: [0, 100, 0],
  tangentPlane: { origin: [0, 100, 0], normal: [0, 1, 0], e1: [1, 0, 0], e2: [0, 0, 1] },
  foot: { ...DEFAULT_FOOT_PARAMS, projectedAngleDeg: 90 },
  edges: [],
} satisfies VertexEdgesInfo

afterEach(() => previewPartCache.clear())

describe('preview part cache keys', () => {
  it('reuses an unchanged strut and invalidates changed geometry or color', () => {
    const key = strutPreviewKey(strut, settings)
    expect(strutPreviewKey({ ...strut }, { ...settings })).toBe(key)
    expect(strutPreviewKey({ ...strut, offsetA: 11 }, settings)).not.toBe(key)
    expect(strutPreviewKey({ ...strut, color: [0.2, 0.2, 0.3] }, settings)).not.toBe(key)
    expect(strutPreviewKey(strut, { ...settings, grooveDepth: 6 })).not.toBe(key)
    const part = { pieces: [], bracePoints: [] }
    previewPartCache.set(key, part)
    expect(previewPartCache.get(key)).toBe(part)
  })

  it('keys a foot by its shape and placement, not unrelated vertex edge data', () => {
    const key = footPreviewKey(foot, 60, 5)
    expect(footPreviewKey({ ...foot, edges: [{ edgeId: 99 }] } as VertexEdgesInfo, 60, 5)).toBe(key)
    expect(footPreviewKey({ ...foot, position: [0, 101, 0] }, 60, 5)).not.toBe(key)
    expect(footPreviewKey({ ...foot, foot: { ...foot.foot!, length: 101 } }, 60, 5)).not.toBe(key)
    expect(footPreviewKey(foot, 61, 5)).not.toBe(key)
  })

  it('invalidates a brace when either endpoint or thickness changes', () => {
    const body: BraceBody = {
      braceId: 3, edgeIdA: 1, edgeIdB: 2, thickness: 12,
      a: [[0, 0, 0], [0, 1, 0]],
      b: [[10, 0, 0], [10, 1, 0]],
    }
    const key = bracePreviewKey(body)
    expect(bracePreviewKey({ ...body })).toBe(key)
    expect(bracePreviewKey({ ...body, thickness: 13 })).not.toBe(key)
    expect(bracePreviewKey({ ...body, b: [[11, 0, 0], [10, 1, 0]] })).not.toBe(key)
  })
})
