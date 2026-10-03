import type { VertexEdgesInfo } from './edgesInfo'
import type { BraceBody, BracePoints } from './braceSolid'
import type { PreviewPiece, StrutBuildJob } from '../workers/previewBuilder.worker'

export interface CachedPreviewPart {
  pieces: PreviewPiece[]
  bracePoints: BracePoints[]
}

// Use the resolved worker inputs rather than the UI settings. A change to an unrelated
// setting then leaves this part's key untouched, while changes to a neighbor-derived offset
// or brace layout invalidate the affected strut.
export function strutPreviewKey(job: StrutBuildJob, settings: {
  halfWidth: number
  endGrooveLengthPercent: number
  midGrooveLengthPercent: number
  grooveDepth: number
  millingDiameter: number
  chamferLength: number
  roundStrutBridge: boolean
}): string {
  return JSON.stringify(['strut', job, settings])
}

export function footPreviewKey(vertex: VertexEdgesInfo, halfWidth: number, grooveDepth: number): string {
  return JSON.stringify([
    'foot', vertex.vertexId, vertex.position, vertex.tangentPlane, vertex.foot,
    halfWidth, grooveDepth,
  ])
}

export function bracePreviewKey(body: BraceBody): string {
  return JSON.stringify(['brace', body])
}

function partBytes(part: CachedPreviewPart): number {
  return part.pieces.reduce((sum, piece) =>
    sum + piece.positions.byteLength + piece.normals.byteLength + piece.indices.byteLength, 0)
}

// Mesh buffers are kept on the main thread; workers can still be terminated to free their
// OpenCascade heaps. Bound the retained buffers so editing many different domes does not grow
// memory indefinitely. An oversized single part simply isn't cached.
const MAX_BYTES = 128 * 1024 * 1024
const MAX_ENTRIES = 1000
const entries = new Map<string, { part: CachedPreviewPart; bytes: number }>()
let usedBytes = 0

export const previewPartCache = {
  get(key: string): CachedPreviewPart | undefined {
    const entry = entries.get(key)
    if (!entry) return undefined
    entries.delete(key)
    entries.set(key, entry)
    return entry.part
  },
  set(key: string, part: CachedPreviewPart): void {
    const bytes = partBytes(part)
    if (bytes > MAX_BYTES) return
    const old = entries.get(key)
    if (old) usedBytes -= old.bytes
    entries.delete(key)
    entries.set(key, { part, bytes })
    usedBytes += bytes
    while (usedBytes > MAX_BYTES || entries.size > MAX_ENTRIES) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      usedBytes -= entries.get(oldest)!.bytes
      entries.delete(oldest)
    }
  },
  clear(): void {
    entries.clear()
    usedBytes = 0
  },
}

if (import.meta.hot) import.meta.hot.on('vite:beforeUpdate', () => previewPartCache.clear())
