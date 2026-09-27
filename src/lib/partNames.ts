import type { Lang } from './i18n'

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
  flangePairs: Record<number, string>
  feet: Record<number, string>
  bracePlates: Record<string, string>
  braces: Record<number, string>
}

const ELEVATION_EPSILON = 1e-6

const PREFIXES: Record<
  Lang,
  {
    innerFlange: string
    outerFlange: string
    strut: string
    foot: string
    bracePlate: string
    brace: string
  }
> = {
  en: {
    innerFlange: 'FI',
    outerFlange: 'FE',
    strut: 'S',
    foot: 'F',
    bracePlate: 'BP',
    brace: 'B',
  },
  ru: {
    innerFlange: 'ФВ',
    outerFlange: 'ФН',
    strut: 'П',
    foot: 'О',
    bracePlate: 'ПР',
    brace: 'Р',
  },
}

const ALPHABETS: Record<Lang, string[]> = {
  en: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ru: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'.split(''),
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

function labelForIndex(index: number, alphabet: string[]): string {
  let n = index
  let label = ''
  do {
    label = alphabet[n % alphabet.length] + label
    n = Math.floor(n / alphabet.length) - 1
  } while (n >= 0)
  return label
}

function compareClockwise<T extends NamedCenter<string | number>>(a: T, b: T): number {
  const angleDelta = clockwiseAngleAroundY(a.center) - clockwiseAngleAroundY(b.center)
  if (Math.abs(angleDelta) > 1e-12) return angleDelta
  const elevationDelta = elevationOf(b.center) - elevationOf(a.center)
  if (Math.abs(elevationDelta) > ELEVATION_EPSILON) return elevationDelta
  return String(a.id).localeCompare(String(b.id), 'en', { numeric: true })
}

function assignElevationNames<Id extends string | number>(
  items: NamedCenter<Id>[],
  prefix: string,
  alphabet: string[],
): Record<Id, string> {
  const sorted = [...items].sort((a, b) => {
    const elevationDelta = elevationOf(b.center) - elevationOf(a.center)
    if (Math.abs(elevationDelta) > ELEVATION_EPSILON) return elevationDelta
    return compareClockwise(a, b)
  })
  const result = {} as Record<Id, string>
  let groupIndex = -1
  let groupElevation = Infinity
  let inGroup: NamedCenter<Id>[] = []

  const flush = () => {
    if (inGroup.length === 0) return
    const letter = labelForIndex(groupIndex, alphabet)
    inGroup.sort(compareClockwise).forEach((item, i) => {
      result[item.id] = `${prefix}-${letter}${i + 1}`
    })
  }

  for (const item of sorted) {
    const elevation = elevationOf(item.center)
    if (groupIndex < 0 || Math.abs(elevation - groupElevation) > ELEVATION_EPSILON) {
      flush()
      groupIndex += 1
      groupElevation = elevation
      inGroup = []
    }
    inGroup.push(item)
  }
  flush()

  return result
}

function assignFlatNames<Id extends string | number>(items: NamedCenter<Id>[], prefix: string): Record<Id, string> {
  const result = {} as Record<Id, string>
  ;[...items].sort(compareClockwise).forEach((item, i) => {
    result[item.id] = `${prefix}-${i + 1}`
  })
  return result
}

export function createPartNameMaps(input: PartNameInput, lang: Lang): PartNameMaps {
  const prefixes = PREFIXES[lang]
  const alphabet = ALPHABETS[lang]

  const innerFlanges = input.flanges
    .filter((flange) => flange.side === 'inner')
    .map((flange) => ({ id: flangeNameKey(flange.vertexId, flange.side), center: flange.center }))
  const outerFlanges = input.flanges
    .filter((flange) => flange.side === 'outer')
    .map((flange) => ({ id: flangeNameKey(flange.vertexId, flange.side), center: flange.center }))

  const flanges = {
    ...assignElevationNames(innerFlanges, prefixes.innerFlange, alphabet),
    ...assignElevationNames(outerFlanges, prefixes.outerFlange, alphabet),
  }

  const flangePairs: Record<number, string> = {}
  for (const flange of input.flanges) {
    const inner = flanges[flangeNameKey(flange.vertexId, 'inner')]
    const outer = flanges[flangeNameKey(flange.vertexId, 'outer')]
    if (inner && outer) flangePairs[flange.vertexId] = `${inner}/${outer}`
  }

  return {
    struts: assignElevationNames(input.struts, prefixes.strut, alphabet),
    flanges,
    flangePairs,
    feet: assignFlatNames(input.feet, prefixes.foot),
    bracePlates: assignFlatNames(input.bracePlates, prefixes.bracePlate),
    braces: assignFlatNames(input.braces, prefixes.brace),
  }
}
