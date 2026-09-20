import { computePreviewBuildInputs, type StrutGeometryEntry } from './previewBuildInputs'
import type { VertexEdgesInfo } from './edgesInfo'
import type { RunStepExportParams } from './stepExportRunner'
import { braceQuadFrame, braceQuadPoints2D, pairBracePoints, projectToFrame2D, type BracePoints } from './braceSolid'
import { layoutDxfParts, writeDxf, type DxfHelperText, type DxfPart } from './dxf'
import type { Vec3 } from './braceSolid'
import type { DxfExportPhase, DxfExportRequest, DxfExportWorkerMessage } from '../workers/dxfExportWorker'

// Same per-worker item cap as the STEP export and the live Preview build, for the same reason.
const BATCH_SIZE = 12

// Height (mm at scale 1) of the green strut labels on braces.
const BRACE_HELPER_HEIGHT = 5

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

export interface DxfExportProgress {
  phase: DxfExportPhase | 'writing'
  done: number
  total: number
}

type Shared = Omit<DxfExportRequest, 'requestId' | 'strutJobs' | 'vertices'>

function runBatch(
  strutJobs: StrutGeometryEntry[],
  vertices: VertexEdgesInfo[],
  shared: Shared,
  requestId: number,
  phase: DxfExportPhase,
  doneBefore: number,
  total: number,
  onProgress: (progress: DxfExportProgress) => void,
): Promise<{ parts: DxfPart[]; bracePoints: BracePoints[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/dxfExportWorker.ts', import.meta.url), { type: 'module' })
    const settle = (fn: () => void) => {
      worker.terminate()
      fn()
    }
    worker.onmessage = (event: MessageEvent<DxfExportWorkerMessage>) => {
      const msg = event.data
      if (msg.requestId !== requestId) return
      if (msg.type === 'progress') onProgress({ phase, done: doneBefore + msg.done, total })
      else if (msg.type === 'result') settle(() => resolve({ parts: msg.parts, bracePoints: msg.bracePoints }))
      else if (msg.type === 'error') settle(() => reject(new Error(msg.message)))
    }
    worker.onerror = (event) => settle(() => reject(new Error(event.message)))
    worker.postMessage({ ...shared, requestId, strutJobs, vertices } satisfies DxfExportRequest)
  })
}

// Builds a single DXF sheet with the flat 2D outline of every visible strut, flange plate, brace
// plate and brace (each with its ID as a label in its own color - see dxf.ts), scaled by
// `params.scale`. `isCancelled` is polled between batches. Returns null if cancelled.
export async function runDxfExport(
  params: RunStepExportParams,
  onProgress: (progress: DxfExportProgress | null) => void,
  isCancelled: () => boolean,
): Promise<Blob | null> {
  const { strutEntries, vertices, halfWidth } = computePreviewBuildInputs(params)

  const shared: Shared = {
    centerY: params.centerY,
    halfWidth,
    endGrooveLengthPercent: params.endGrooveLengthPercent,
    midGrooveLengthPercent: params.midGrooveLengthPercent,
    grooveDepth: params.grooveDepth,
    millingDiameter: params.millingDiameter,
    chamferLength: params.chamferLength,
    flangeParams: params.flangeParams,
  }

  let nextRequestId = 0
  const parts: DxfPart[] = []
  const bracePoints: BracePoints[] = []

  onProgress({ phase: 'struts', done: 0, total: strutEntries.length })
  const strutBatches = chunk(strutEntries, BATCH_SIZE)
  for (let i = 0; i < strutBatches.length; i++) {
    if (isCancelled()) return null
    const batch = strutBatches[i]
    try {
      const result = await runBatch(batch, [], shared, ++nextRequestId, 'struts', i * BATCH_SIZE, strutEntries.length, onProgress)
      parts.push(...result.parts)
      bracePoints.push(...result.bracePoints)
    } catch (err) {
      console.error(`Failed to build DXF outlines for struts ${batch.map((job) => job.index).join(', ')}`, err)
    }
  }

  onProgress({ phase: 'flanges', done: 0, total: vertices.length })
  const vertexBatches = chunk(vertices, BATCH_SIZE)
  for (let i = 0; i < vertexBatches.length; i++) {
    if (isCancelled()) return null
    const batch = vertexBatches[i]
    try {
      const result = await runBatch([], batch, shared, ++nextRequestId, 'flanges', i * BATCH_SIZE, vertices.length, onProgress)
      parts.push(...result.parts)
    } catch (err) {
      console.error(`Failed to build DXF outlines for flanges of vertices ${batch.map((v) => v.vertexId).join(', ')}`, err)
    }
  }

  if (isCancelled()) return null
  onProgress({ phase: 'writing', done: 0, total: parts.length })

  // A brace's body is the flat quad through its four plate end points - no WASM needed for that.
  for (const body of pairBracePoints(bracePoints)) {
    const frame = braceQuadFrame(body.a, body.b)
    if (!frame) continue
    // Green: the strut each end of the brace goes into, written along the brace just inside
    // the end (the middle of that strut's two plate end points).
    const height = BRACE_HELPER_HEIGHT
    const mid = (pts: [Vec3, Vec3]): [number, number] => {
      const [p, q] = pts.map((pt) => projectToFrame2D(frame, pt))
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    }
    const ends: [string, [number, number]][] = [
      [`S${body.edgeIdA}`, mid(body.a)],
      [`S${body.edgeIdB}`, mid(body.b)],
    ]
    const dir: [number, number] = [ends[1][1][0] - ends[0][1][0], ends[1][1][1] - ends[0][1][1]]
    const len = Math.hypot(dir[0], dir[1]) || 1
    const unit: [number, number] = [dir[0] / len, dir[1] / len]
    const helpers: DxfHelperText[] = ends.map(([text, at], i) => {
      // Moved inward, along the brace, by half the text's length plus a little.
      const inset = (text.length * height * 0.8) / 2 + 2
      const sign = i === 0 ? 1 : -1
      return {
        text,
        x: at[0] + sign * unit[0] * inset,
        y: at[1] + sign * unit[1] * inset,
        angleDeg: (Math.atan2(unit[1], unit[0]) * 180) / Math.PI,
        height,
      }
    })
    parts.push({
      name: `brace-${body.braceId}`,
      kind: 'brace',
      loops: [{ closed: true, vertices: braceQuadPoints2D(frame).map(([x, y]) => ({ x, y, bulge: 0 })) }],
      helpers,
    })
  }

  const placed = layoutDxfParts(parts, { scale: params.scale })
  return new Blob([writeDxf(placed)], { type: 'application/dxf' })
}
