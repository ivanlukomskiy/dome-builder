import { draw, drawCircle } from 'replicad'
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
// The tab's four outer corners and each side rectangle's two center-side outside corners are
// chamfered by foot.chamferLength, clamped to the local edge lengths.
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
  const tabChamfer = Math.min(Math.max(foot.chamferLength, 0), halfTabX, flangeThickness)
  const rectChamfer = Math.min(Math.max(foot.chamferLength, 0), foot.straightLength, halfStrutY - halfBodyY)

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

  let main = draw()
    .movePointerTo([halfTabX, -halfTotalY + tabChamfer])
    .vLineTo(-halfBodyY)
    .hLineTo(halfBodyX)
    .vLineTo(-halfStrutY + rectChamfer)
    .lineTo([halfBodyX + rectChamfer, -halfStrutY])
    .hLineTo(straightEndX)
    .threePointsArcTo([straightEndX, halfStrutY], [straightEndX + halfStrutY, 0])
    .hLineTo(halfBodyX + rectChamfer)
    .lineTo([halfBodyX, halfStrutY - rectChamfer])
    .vLineTo(halfBodyY)
    .hLineTo(halfTabX)
    .vLineTo(halfTotalY - tabChamfer)
    .lineTo([halfTabX - tabChamfer, halfTotalY])
    .hLineTo(-halfTabX + tabChamfer)
    .lineTo([-halfTabX, halfTotalY - tabChamfer])
    .vLineTo(halfBodyY)
    .hLineTo(-halfBodyX)
    .vLineTo(halfStrutY - rectChamfer)
    .lineTo([-halfBodyX - rectChamfer, halfStrutY])
    .hLineTo(-straightEndX)
    .threePointsArcTo([-straightEndX, -halfStrutY], [-straightEndX - halfStrutY, 0])
    .hLineTo(-halfBodyX - rectChamfer)
    .lineTo([-halfBodyX, -halfStrutY + rectChamfer])
    .vLineTo(-halfBodyY)
    .hLineTo(-halfTabX)
    .vLineTo(-halfTotalY + tabChamfer)
    .lineTo([-halfTabX + tabChamfer, -halfTotalY])
    .hLineTo(halfTabX - tabChamfer)
    .close()

  if (foot.holeDiameter > 0) {
    const holeRadius = foot.holeDiameter / 2
    main = main
      .cut(drawCircle(holeRadius).translate([straightEndX, 0]))
      .cut(drawCircle(holeRadius).translate([-straightEndX, 0]))
  }

  return { main }
}

// This file is imported by debug pages dynamically; force a full reload on geometry edits so the
// debug page stays in sync with Vite HMR, matching flangeGeometry.ts.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload()
  })
}
