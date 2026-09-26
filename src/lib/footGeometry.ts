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
// On either x side of the tab/body cross, the foot continues as a strut-width rectangle, then a
// semicircle whose center is on the rectangle's far edge and whose radius is strutWidth / 2.
export function computeFootPartBoundary2D(
  foot: FootParams,
  strutWidth: number,
  flangeThickness: number,
): FootPartBoundaryResult {
  const halfBodyX = foot.length / 2
  const halfTabX = foot.grooveLength / 2
  const halfStrutY = strutWidth / 2
  const bodyHeight = Math.max(strutWidth - 2 * flangeThickness, 0)
  const halfBodyY = bodyHeight / 2
  const halfTotalY = halfBodyY + flangeThickness
  const straightEndX = halfBodyX + foot.straightLength

  if (
    foot.length <= 0 ||
    foot.grooveLength <= 0 ||
    foot.straightLength < 0 ||
    strutWidth <= 0 ||
    flangeThickness <= 0 ||
    halfTotalY <= 0
  ) {
    return { main: null }
  }

  const main = draw()
    .movePointerTo([halfTabX, -halfTotalY])
    .vLineTo(-halfBodyY)
    .hLineTo(halfBodyX)
    .vLineTo(-halfStrutY)
    .hLineTo(straightEndX)
    .threePointsArcTo([straightEndX, halfStrutY], [straightEndX + halfStrutY, 0])
    .hLineTo(halfBodyX)
    .vLineTo(halfBodyY)
    .hLineTo(halfTabX)
    .vLineTo(halfTotalY)
    .hLineTo(-halfTabX)
    .vLineTo(halfBodyY)
    .hLineTo(-halfBodyX)
    .vLineTo(halfStrutY)
    .hLineTo(-straightEndX)
    .threePointsArcTo([-straightEndX, -halfStrutY], [-straightEndX - halfStrutY, 0])
    .hLineTo(-halfBodyX)
    .vLineTo(-halfBodyY)
    .hLineTo(-halfTabX)
    .vLineTo(-halfTotalY)
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
