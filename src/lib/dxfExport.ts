import type { Drawing } from 'replicad'

const DEG2RAD = Math.PI / 180

// Converts a flat replicad `Drawing` into a minimal DXF (R12-style POLYLINE/VERTEX entities, one
// polyline per closed/open loop - including holes, e.g. the milling-relief circles cut into a
// strut). Built on top of `Drawing.toSVGPaths()` (replicad's own, already-battle-tested 2D
// export) rather than reaching into replicad's private curve internals: its `M/L/Q/C/A/Z` path
// data is parsed back into vertices, with SVG's `A` arc command converted to DXF's per-vertex
// "bulge" so real circular arcs stay arcs instead of being flattened into polylines. Note
// `toSVGPathD()` mirrors the geometry about the X axis to match SVG's y-down convention - that
// mirror (and its effect on arc winding direction) is undone here so the exported DXF matches
// the drawing's real coordinates.
export function drawingToDXF(drawing: Drawing): string {
  const pathStrings = collectPathStrings(drawing.toSVGPaths())
  const polylines = pathStrings.map(parseSvgPathToPolyline).filter((pl) => pl.vertices.length >= 2)
  return buildDXF(polylines)
}

function collectPathStrings(paths: string[] | string[][]): string[] {
  const items = paths as (string | string[])[]
  const out: string[] = []
  for (const p of items) {
    if (Array.isArray(p)) out.push(...p)
    else out.push(p)
  }
  return out
}

interface Vertex {
  x: number
  y: number
  bulge: number
}

interface Polyline {
  vertices: Vertex[]
  closed: boolean
}

const PATH_COMMAND_ARG_COUNT: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, A: 7, Z: 0 }

function parseSvgPathToPolyline(d: string): Polyline {
  const tokens = d.trim().split(/\s+/)
  const vertices: Vertex[] = []
  let closed = false
  let cx = 0
  let cy = 0
  let i = 0

  while (i < tokens.length) {
    const cmd = tokens[i]
    i++
    const argCount = PATH_COMMAND_ARG_COUNT[cmd]
    if (argCount === undefined) throw new Error(`Unsupported SVG path command in DXF export: ${cmd}`)
    const args = tokens.slice(i, i + argCount).map(Number)
    i += argCount

    if (cmd === 'M') {
      ;[cx, cy] = args
      vertices.push({ x: cx, y: -cy, bulge: 0 })
    } else if (cmd === 'L') {
      const [x, y] = args
      vertices.push({ x, y: -y, bulge: 0 })
      ;[cx, cy] = [x, y]
    } else if (cmd === 'Q' || cmd === 'C') {
      const end = cmd === 'Q' ? [args[2], args[3]] : [args[4], args[5]]
      const controls = cmd === 'Q' ? [[args[0], args[1]]] : [[args[0], args[1]], [args[2], args[3]]]
      for (const [x, y] of sampleBezier([cx, cy], controls, end)) {
        vertices.push({ x, y: -y, bulge: 0 })
      }
      ;[cx, cy] = end
    } else if (cmd === 'A') {
      const [rx, ry, xRot, largeArc, sweep, x, y] = args
      const segments = svgArcToSegments(cx, cy, rx, ry, xRot, largeArc !== 0, sweep !== 0, x, y)
      for (const seg of segments) {
        // The mirror `toSVGPathD()` applies to match SVG's y-down convention reverses arc
        // winding, so the bulge sign has to flip along with un-mirroring the Y coordinate.
        if (vertices.length > 0) vertices[vertices.length - 1].bulge = -seg.bulge
        vertices.push({ x: seg.x, y: -seg.y, bulge: 0 })
      }
      ;[cx, cy] = [x, y]
    } else if (cmd === 'Z') {
      closed = true
    }
  }

  // `Z` just marks the loop as closed - the preceding command already lands exactly on the
  // start point, so drop that duplicate rather than emitting a zero-length closing edge.
  if (closed && vertices.length > 1) {
    const first = vertices[0]
    const last = vertices[vertices.length - 1]
    if (Math.abs(first.x - last.x) < 1e-4 && Math.abs(first.y - last.y) < 1e-4) vertices.pop()
  }

  return { vertices, closed }
}

function sampleBezier(start: number[], controls: number[][], end: number[]): [number, number][] {
  const points = [start, ...controls, end]
  const degree = points.length - 1
  const steps = 16
  const out: [number, number][] = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    let px = 0
    let py = 0
    for (let k = 0; k <= degree; k++) {
      const b = binomial(degree, k) * (1 - t) ** (degree - k) * t ** k
      px += b * points[k][0]
      py += b * points[k][1]
    }
    out.push([px, py])
  }
  return out
}

function binomial(n: number, k: number): number {
  let result = 1
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1)
  return result
}

// Standard SVG arc endpoint-to-center parameterization (spec appendix F.6.5), returning a list of
// {x, y, bulge} segments to append after the arc's start point - normally just one, but a near-
// full-circle arc (as used for the milling-relief holes, drawn as a single `A` command back to
// ~its own start) is split into two half-turns since a single DXF bulge can't represent a full
// turn (tan blows up near +-360deg), and a non-circular ellipse falls back to a sampled polyline.
function svgArcToSegments(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  xRotDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): { x: number; y: number; bulge: number }[] {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx < 1e-9 || ry < 1e-9 || (x1 === x2 && y1 === y2)) return [{ x: x2, y: y2, bulge: 0 }]

  const phi = xRotDeg * DEG2RAD
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  const dx2 = (x1 - x2) / 2
  const dy2 = (y1 - y2) / 2
  const x1p = cosPhi * dx2 + sinPhi * dy2
  const y1p = -sinPhi * dx2 + cosPhi * dy2

  let rxSq = rx * rx
  let rySq = ry * ry
  const x1pSq = x1p * x1p
  const y1pSq = y1p * y1p
  const lambda = x1pSq / rxSq + y1pSq / rySq
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rx *= s
    ry *= s
    rxSq = rx * rx
    rySq = ry * ry
  }

  const sign = largeArc !== sweep ? 1 : -1
  const num = rxSq * rySq - rxSq * y1pSq - rySq * x1pSq
  const den = rxSq * y1pSq + rySq * x1pSq
  const co = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = (co * rx * y1p) / ry
  const cyp = (-co * ry * x1p) / rx

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2

  const vecAngle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }

  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dTheta = vecAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI

  const ellipsePoint = (theta: number): [number, number] => [
    cx + rx * Math.cos(theta) * cosPhi - ry * Math.sin(theta) * sinPhi,
    cy + rx * Math.cos(theta) * sinPhi + ry * Math.sin(theta) * cosPhi,
  ]

  const nearCircular = Math.abs(rx - ry) < 1e-6
  if (nearCircular) {
    if (Math.abs(dTheta) > 2 * Math.PI - 1e-3) {
      const half = dTheta / 2
      const [midX, midY] = ellipsePoint(theta1 + half)
      const bulge = Math.tan(half / 4)
      return [
        { x: midX, y: midY, bulge },
        { x: x2, y: y2, bulge },
      ]
    }
    return [{ x: x2, y: y2, bulge: Math.tan(dTheta / 4) }]
  }

  const segmentCount = Math.max(4, Math.ceil(Math.abs(dTheta) / (10 * DEG2RAD)))
  const out: { x: number; y: number; bulge: number }[] = []
  for (let i = 1; i <= segmentCount; i++) {
    const [ex, ey] = ellipsePoint(theta1 + (dTheta * i) / segmentCount)
    out.push({ x: ex, y: ey, bulge: 0 })
  }
  return out
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (Object.is(n, -0)) n = 0
  return n.toFixed(6)
}

function buildDXF(polylines: Polyline[]): string {
  const lines: string[] = []
  const put = (code: number, value: string) => lines.push(String(code), value)

  put(0, 'SECTION')
  put(2, 'HEADER')
  put(9, '$ACADVER')
  put(1, 'AC1009')
  put(9, '$INSUNITS')
  put(70, '4') // millimeters
  put(0, 'ENDSEC')

  put(0, 'SECTION')
  put(2, 'ENTITIES')
  for (const pl of polylines) {
    put(0, 'POLYLINE')
    put(8, '0')
    put(66, '1')
    put(70, pl.closed ? '1' : '0')
    for (const v of pl.vertices) {
      put(0, 'VERTEX')
      put(8, '0')
      put(10, fmt(v.x))
      put(20, fmt(v.y))
      put(30, '0')
      if (v.bulge) put(42, fmt(v.bulge))
    }
    put(0, 'SEQEND')
  }
  put(0, 'ENDSEC')
  put(0, 'EOF')

  return lines.join('\n') + '\n'
}
