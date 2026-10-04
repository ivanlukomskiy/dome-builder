import type { RunStepExportParams } from './stepExportRunner'
import type { StrutGeometryEntry } from './previewBuildInputs'
import type { VertexEdgesInfo } from './edgesInfo'
import { computeBraceEndpoints } from './braces'
import { bracePlateNameKey, createPartNameMaps, type PartNameMaps } from './partNames'

type Tuple3 = [number, number, number]

function add(a: Tuple3, b: Tuple3): Tuple3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function sub(a: Tuple3, b: Tuple3): Tuple3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(v: Tuple3, s: number): Tuple3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}

function length(v: Tuple3): number {
  return Math.hypot(v[0], v[1], v[2])
}

function normalize(v: Tuple3): Tuple3 {
  const len = length(v)
  return len > 0 ? scale(v, 1 / len) : [0, 0, 0]
}

function midpoint(a: Tuple3, b: Tuple3): Tuple3 {
  return scale(add(a, b), 0.5)
}

function footPartCenter(vertex: VertexEdgesInfo): Tuple3 | null {
  const foot = vertex.foot
  if (!foot) return null
  const e1 = normalize(vertex.tangentPlane.e1)
  const e2 = normalize(vertex.tangentPlane.e2)
  const angle = (foot.projectedAngleDeg * Math.PI) / 180
  const axis = normalize(add(scale(e1, Math.cos(angle)), scale(e2, Math.sin(angle))))
  if (length(axis) < 1e-12) return null
  return add(vertex.position, scale(axis, foot.holeOffset + foot.thickness / 2))
}

export function buildExportPartNames(
  params: RunStepExportParams,
  strutEntries: StrutGeometryEntry[],
  vertices: VertexEdgesInfo[],
  halfWidth: number,
): PartNameMaps {
  const flangeSpan = halfWidth - params.grooveDepth / 2
  const flanges = vertices.flatMap((vertex) => {
    const normal = normalize(vertex.tangentPlane.normal)
    return [
      { vertexId: vertex.vertexId, side: 'outer' as const, center: add(vertex.position, scale(normal, flangeSpan)) },
      { vertexId: vertex.vertexId, side: 'inner' as const, center: add(vertex.position, scale(normal, -flangeSpan)) },
    ]
  })

  const feet = vertices.flatMap((vertex) => {
    const center = footPartCenter(vertex)
    return center ? [{ id: vertex.vertexId, center }] : []
  })

  const bracePlates = strutEntries.flatMap((job) => {
    const posA = job.posA
    const posB = job.posB
    const axisAB = normalize(sub(posB, posA))
    return [
      ...job.braces.a.slice(0, 1).map((brace) => ({
        id: bracePlateNameKey(brace.braceId, job.index, 'A'),
        center: add(posA, scale(axisAB, brace.distanceFromVertex)),
      })),
      ...job.braces.b.slice(0, 1).map((brace) => ({
        id: bracePlateNameKey(brace.braceId, job.index, 'B'),
        center: add(posB, scale(axisAB, -brace.distanceFromVertex)),
      })),
    ]
  })

  const braces = Array.from(params.data.braces.entries()).flatMap(([braceId, brace]) => {
    const endpoints = computeBraceEndpoints(brace, params.data.edges, (vertexId) => params.transformedVertices.get(vertexId)!)
    if (!endpoints) return []
    const a = endpoints[0].toArray() as Tuple3
    const b = endpoints[1].toArray() as Tuple3
    return [{ id: braceId, center: midpoint(a, b) }]
  })

  return createPartNameMaps(
    {
      struts: strutEntries.map((job) => ({ id: job.index, center: midpoint(job.posA, job.posB) })),
      flanges,
      feet,
      bracePlates,
      braces,
    },
  )
}

