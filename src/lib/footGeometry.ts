import { draw } from 'replicad'
import type { Drawing } from 'replicad'
import type { FootParams } from './flangeGeometry'

export interface FootPartBoundaryResult {
  main: Drawing | null
}

// The separate "foot" part that slots through the two flange plates at a foot vertex.
//
// In this sketch's local frame:
// - x is across the flange foot arm,
// - y is through the strut width / flange stack,
// - extrusion is along the flange foot arm's axis, using foot.thickness.
//
// The two tabs are centered on the part and enter the two flange slots. Their y-length is the
// flange thickness (`flangeThickness` / groove depth), and their x-width is foot.grooveLength.
export function computeFootPartBoundary2D(
  foot: FootParams,
  strutWidth: number,
  flangeThickness: number,
): FootPartBoundaryResult {
  const halfBodyX = foot.length / 2
  const halfTabX = foot.grooveLength / 2
  const bodyHeight = Math.max(strutWidth - 2 * flangeThickness, 0)
  const halfBodyY = bodyHeight / 2
  const halfTotalY = halfBodyY + flangeThickness

  if (foot.length <= 0 || foot.grooveLength <= 0 || flangeThickness <= 0 || halfTotalY <= 0) {
    return { main: null }
  }

  const main = draw()
    .movePointerTo([-halfBodyX, -halfBodyY])
    .hLineTo(-halfTabX)
    .vLineTo(-halfTotalY)
    .hLineTo(halfTabX)
    .vLineTo(-halfBodyY)
    .hLineTo(halfBodyX)
    .vLineTo(halfBodyY)
    .hLineTo(halfTabX)
    .vLineTo(halfTotalY)
    .hLineTo(-halfTabX)
    .vLineTo(halfBodyY)
    .hLineTo(-halfBodyX)
    .close()

  return { main }
}

// This file is imported by debug pages dynamically; force a full reload on geometry edits so the
// debug page stays in sync with Vite HMR, matching flangeGeometry.ts.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload()
  })
}
