type Vec3 = [number, number, number]

export type FlangeNameSide = 'inner' | 'outer'

export interface NamedCenter<Id extends string | number> {
  id: Id
  center: Vec3
}

export interface PartNameInput {
  struts: NamedCenter<number>[]
  // One center per vertex; each vertex contributes an outer/inner flange pair.
  flanges: NamedCenter<number>[]
  feet: NamedCenter<number>[]
  bracePlates: NamedCenter<string>[]
  braces: NamedCenter<number>[]
}

export interface PartNameMaps {
  struts: Record<number, string>
  flanges: Record<string, string>
  feet: Record<number, string>
  bracePlates: Record<string, string>
  braces: Record<number, string>
}

const ELEVATION_EPSILON = 1e-6

function formatPartId(id: number): string {
  const text = String(id)
  return /^[69]+$/.test(text) ? `${text}.` : text
}

export function flangeNameKey(vertexId: number, side: FlangeNameSide): string {
  return `${vertexId}:${side}`
}

export function bracePlateNameKey(braceId: number, edgeId: number, end: 'A' | 'B'): string {
  return `${braceId}:${edgeId}:${end}`
}

function elevationOf(center: Vec3): number {
  return center[1]
}

// Around the vertical Y axis, starting at +X, increasing clockwise when viewed from above.
function clockwiseAngleAroundY(center: Vec3): number {
  const ccw = Math.atan2(center[2], center[0])
  return (2 * Math.PI - ((ccw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) % (2 * Math.PI)
}

function compareClockwise<T extends NamedCenter<string | number>>(a: T, b: T): number {
  const angleDelta = clockwiseAngleAroundY(a.center) - clockwiseAngleAroundY(b.center)
  if (Math.abs(angleDelta) > 1e-12) return angleDelta
  const elevationDelta = elevationOf(b.center) - elevationOf(a.center)
  if (Math.abs(elevationDelta) > ELEVATION_EPSILON) return elevationDelta
  return String(a.id).localeCompare(String(b.id), 'en', { numeric: true })
}

function sortCenters<Id extends string | number>(
  items: NamedCenter<Id>[],
): NamedCenter<Id>[] {
  const sorted = [...items].sort((a, b) => {
    const elevationDelta = elevationOf(b.center) - elevationOf(a.center)
    if (Math.abs(elevationDelta) > ELEVATION_EPSILON) return elevationDelta
    return compareClockwise(a, b)
  })
  const result: NamedCenter<Id>[] = []
  let groupElevation = Infinity
  let inGroup: NamedCenter<Id>[] = []

  const flush = () => {
    if (inGroup.length === 0) return
    result.push(...inGroup.sort(compareClockwise))
  }

  for (const item of sorted) {
    const elevation = elevationOf(item.center)
    if (Math.abs(elevation - groupElevation) > ELEVATION_EPSILON) {
      flush()
      groupElevation = elevation
      inGroup = []
    }
    inGroup.push(item)
  }
  flush()

  return result
}

function assignNumericNames<Id extends string | number>(items: NamedCenter<Id>[]): Record<Id, string> {
  const result = {} as Record<Id, string>
  sortCenters(items).forEach((item, index) => {
    result[item.id] = formatPartId(index + 1)
  })
  return result
}

function assignFlangeNames(vertices: NamedCenter<number>[]): Record<string, string> {
  const result: Record<string, string> = {}
  sortCenters(vertices).forEach((vertex, index) => {
    result[flangeNameKey(vertex.id, 'outer')] = formatPartId(2 * index + 1)
    result[flangeNameKey(vertex.id, 'inner')] = formatPartId(2 * index + 2)
  })
  return result
}

// Every physical part kind has its own continuous sequence, highest elevation first.
export function createPartNameMaps(input: PartNameInput): PartNameMaps {
  return {
    struts: assignNumericNames(input.struts),
    flanges: assignFlangeNames(input.flanges),
    feet: assignNumericNames(input.feet),
    bracePlates: assignNumericNames(input.bracePlates),
    braces: assignNumericNames(input.braces),
  }
}

// File name of every part in the STEP parts export, keyed by the name the export worker builds
// the part under (stepExportWorker.ts names pieces by vertex/edge/brace index). The file is named
// after the part's ID - the number engraved on it and written on it in the DXF - so the two match.
export function stepPartFileNames(names: PartNameMaps): Map<string, string> {
  // An ID's trailing dot (formatPartId) only tells 6 from 9 on the part itself.
  const file = (kind: string, name: string) => `${kind}-${name.replace(/\.$/, '')}.step`
  const files = new Map<string, string>()
  for (const [id, name] of Object.entries(names.struts)) files.set(`strut-${id}.step`, file('strut', name))
  for (const [key, name] of Object.entries(names.flanges)) files.set(`flange-${key.replace(':', '-')}.step`, file('flange', name))
  for (const [id, name] of Object.entries(names.feet)) files.set(`foot-${id}.step`, file('foot', name))
  for (const [key, name] of Object.entries(names.bracePlates)) {
    const [braceId, edgeId, end] = key.split(':')
    files.set(`brace-plate-${braceId}-strut-${edgeId}-${end}.step`, file('brace-plate', name))
  }
  for (const [id, name] of Object.entries(names.braces)) files.set(`brace-${id}.step`, file('brace', name))
  return files
}
