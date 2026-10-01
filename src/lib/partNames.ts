type Vec3 = [number, number, number]

export type FlangeNameSide = 'inner' | 'outer'

export interface NamedCenter<Id extends string | number> {
  id: Id
  center: Vec3
}

export interface FlangeNameInput {
  vertexId: number
  side: FlangeNameSide
  center: Vec3
}

export interface PartNameInput {
  struts: NamedCenter<number>[]
  flanges: FlangeNameInput[]
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

function assignNumericNames<Id extends string | number>(
  items: NamedCenter<Id>[],
): Record<Id, string> {
  const sorted = [...items].sort((a, b) => {
    const elevationDelta = elevationOf(b.center) - elevationOf(a.center)
    if (Math.abs(elevationDelta) > ELEVATION_EPSILON) return elevationDelta
    return compareClockwise(a, b)
  })
  const result = {} as Record<Id, string>
  let nextId = 1
  let groupElevation = Infinity
  let inGroup: NamedCenter<Id>[] = []

  const flush = () => {
    if (inGroup.length === 0) return
    inGroup.sort(compareClockwise).forEach((item) => {
      result[item.id] = String(nextId++)
    })
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

// Every physical part kind has its own continuous sequence, highest elevation first.
export function createPartNameMaps(input: PartNameInput): PartNameMaps {
  return {
    struts: assignNumericNames(input.struts),
    flanges: assignNumericNames(input.flanges.map((flange) => ({
      id: flangeNameKey(flange.vertexId, flange.side),
      center: flange.center,
    }))),
    feet: assignNumericNames(input.feet),
    bracePlates: assignNumericNames(input.bracePlates),
    braces: assignNumericNames(input.braces),
  }
}
