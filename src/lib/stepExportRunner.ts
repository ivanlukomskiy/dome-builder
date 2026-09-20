import JSZip from 'jszip'
import type { FlangeShapeParams } from './flangeGeometry'
import { computePreviewBuildInputs, type PreviewBuildInputParams, type StrutGeometryEntry } from './previewBuildInputs'
import type { VertexEdgesInfo } from './edgesInfo'
import { pairBracePoints, type BraceBody, type BracePoints } from './braceSolid'
import type {
  StepExportPhase,
  StepExportPiece,
  StepExportRequest,
  StepExportWorkerMessage,
} from '../workers/stepExportWorker'

// Same per-worker item cap as DomeMesh.tsx's live Preview build, and for the same reason: no
// single opencascade instance should have to hold more than one batch's worth of accumulated
// geometry before its heap gets reclaimed by tearing the worker down.
const BATCH_SIZE = 12

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

export interface StepExportProgress {
  phase: StepExportPhase | 'zipping'
  done: number
  total: number
}

export interface RunStepExportParams extends PreviewBuildInputParams {
  flangeParams: FlangeShapeParams
  // Uniform scale factor (1 = no change) applied to every exported solid - see
  // buildStrutStepFromDrawing in replicadCad.ts.
  scale: number
}

// Runs one batch (a handful of struts, or of flange vertices - never both) in its own fresh
// worker, terminated the moment its result comes back - see stepExportWorker.ts and DomeMesh.tsx's
// own runBatch for why.
function runBatch(
  strutJobs: StrutGeometryEntry[],
  vertices: VertexEdgesInfo[],
  braceBodies: BraceBody[],
  shared: Omit<StepExportRequest, 'requestId' | 'strutJobs' | 'vertices' | 'braceBodies'>,
  requestId: number,
  phase: StepExportPhase,
  doneBefore: number,
  total: number,
  onProgress: (progress: StepExportProgress) => void,
): Promise<{ pieces: StepExportPiece[]; bracePoints: BracePoints[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/stepExportWorker.ts', import.meta.url), {
      type: 'module',
    })

    const settle = (fn: () => void) => {
      worker.terminate()
      fn()
    }

    worker.onmessage = (event: MessageEvent<StepExportWorkerMessage>) => {
      const msg = event.data
      if (msg.requestId !== requestId) return

      if (msg.type === 'progress') {
        onProgress({ phase, done: doneBefore + msg.done, total })
      } else if (msg.type === 'result') {
        settle(() => resolve({ pieces: msg.pieces, bracePoints: msg.bracePoints }))
      } else if (msg.type === 'error') {
        settle(() => reject(new Error(msg.message)))
      }
    }
    worker.onerror = (event) => {
      settle(() => reject(new Error(event.message)))
    }

    const request: StepExportRequest = { ...shared, requestId, strutJobs, vertices, braceBodies }
    worker.postMessage(request)
  })
}

// Builds a STEP file for every visible strut and flange plate (see stepExportWorker.ts) and zips
// them into a single archive, reporting progress as it goes. `isCancelled` is polled between
// batches so a caller can abandon an in-flight export (e.g. the user navigated away) without
// waiting for it to finish - the batch already in flight still runs to completion in its own
// worker, but its result is discarded and no further batches start.
export async function runStepExport(
  params: RunStepExportParams,
  onProgress: (progress: StepExportProgress | null) => void,
  isCancelled: () => boolean,
): Promise<Blob | null> {
  const { strutEntries, vertices, halfWidth } = computePreviewBuildInputs(params)

  const shared: Omit<StepExportRequest, 'requestId' | 'strutJobs' | 'vertices' | 'braceBodies'> = {
    centerY: params.centerY,
    cornerLength: params.cornerLength,
    halfWidth,
    endGrooveLengthPercent: params.endGrooveLengthPercent,
    midGrooveLengthPercent: params.midGrooveLengthPercent,
    grooveDepth: params.grooveDepth,
    millingDiameter: params.millingDiameter,
    chamferLength: params.chamferLength,
    flangeParams: params.flangeParams,
    scale: params.scale,
  }

  let nextRequestId = 0
  const allPieces: StepExportPiece[] = []
  // Every strut's brace plate end points, across batches - a brace's two struts can land in
  // different batches, so the bodies are only built once all of them are in.
  const allBracePoints: BracePoints[] = []

  onProgress({ phase: 'struts', done: 0, total: strutEntries.length })
  const strutBatches = chunk(strutEntries, BATCH_SIZE)
  for (let i = 0; i < strutBatches.length; i++) {
    if (isCancelled()) return null
    const batch = strutBatches[i]
    try {
      const { pieces, bracePoints } = await runBatch(
        batch,
        [],
        [],
        shared,
        ++nextRequestId,
        'struts',
        i * BATCH_SIZE,
        strutEntries.length,
        onProgress,
      )
      allPieces.push(...pieces)
      allBracePoints.push(...bracePoints)
    } catch (err) {
      console.error(`Failed to export struts ${batch.map((job) => job.index).join(', ')}`, err)
    }
  }

  onProgress({ phase: 'flanges', done: 0, total: vertices.length })
  const vertexBatches = chunk(vertices, BATCH_SIZE)
  for (let i = 0; i < vertexBatches.length; i++) {
    if (isCancelled()) return null
    const batch = vertexBatches[i]
    try {
      const { pieces } = await runBatch(
        [],
        batch,
        [],
        shared,
        ++nextRequestId,
        'flanges',
        i * BATCH_SIZE,
        vertices.length,
        onProgress,
      )
      allPieces.push(...pieces)
    } catch (err) {
      console.error(`Failed to export flanges for vertices ${batch.map((v) => v.vertexId).join(', ')}`, err)
    }
  }

  const braceBodies = pairBracePoints(allBracePoints)
  onProgress({ phase: 'braces', done: 0, total: braceBodies.length })
  const braceBatches = chunk(braceBodies, BATCH_SIZE)
  for (let i = 0; i < braceBatches.length; i++) {
    if (isCancelled()) return null
    const batch = braceBatches[i]
    try {
      const { pieces } = await runBatch(
        [],
        [],
        batch,
        shared,
        ++nextRequestId,
        'braces',
        i * BATCH_SIZE,
        braceBodies.length,
        onProgress,
      )
      allPieces.push(...pieces)
    } catch (err) {
      console.error(`Failed to export braces ${batch.map((b) => b.braceId).join(', ')}`, err)
    }
  }

  if (isCancelled()) return null

  onProgress({ phase: 'zipping', done: 0, total: allPieces.length })
  const zip = new JSZip()
  for (const piece of allPieces) zip.file(piece.name, piece.blob)
  const zipBlob = await zip.generateAsync({ type: 'blob' })

  return isCancelled() ? null : zipBlob
}
