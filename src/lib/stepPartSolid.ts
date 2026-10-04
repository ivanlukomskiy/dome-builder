import { drawText, loadFont, type Drawing, type Shape3D } from 'replicad'
import boldFontUrl from '../assets/fonts/LiberationSans-Bold.ttf?url'
import { readableAngle, type DxfHelperText } from './dxf'
import type { PartLabels } from './partLabels'
import { validateStepLabelDepth } from './stepExportSettings'

export const ENGRAVING_FONT = 'Liberation Sans Bold'
let fontReady: Promise<unknown> | undefined
export function ensureEngravingFont(): Promise<unknown> {
  return fontReady ??= loadFont(boldFontUrl, ENGRAVING_FONT)
}

// The drawing and labels share local coordinates. Only parts exports use this builder;
// assembly solids retain their world-space planes. Depth is in final exported millimeters.
export function buildFlatStepPart(
  drawing: Drawing,
  thickness: number,
  scale: number,
  engraving?: { labels: PartLabels; partIdLabelSize: number; depth: number },
): Shape3D {
  if (!(Number.isFinite(scale) && scale > 0 && Number.isFinite(thickness) && thickness > 0)) {
    throw new Error('STEP parts require positive thickness and export scale.')
  }
  if (engraving) validateStepLabelDepth(engraving.depth, thickness * scale)
  const [cx, cy] = drawing.boundingBox.center
  let solid = drawing.sketchOnPlane('XY').extrude(thickness).asShape3D()
  try {
    if (scale !== 1) solid = solid.scale(scale).asShape3D()
    if (engraving) {
      const { labels, partIdLabelSize, depth } = engraving
      const texts: DxfHelperText[] = [{
        text: labels.name,
        x: labels.labelAnchor?.x ?? cx,
        y: labels.labelAnchor?.y ?? cy,
        angleDeg: labels.labelAngleDeg ?? 0,
        height: partIdLabelSize,
      }, ...labels.helpers ?? []]
      for (const label of texts) {
        if (!label.text || !Number.isFinite(label.height) || label.height <= 0) {
          throw new Error('STEP label text and sizes must be valid.')
        }
        let text = drawText(label.text, { fontFamily: ENGRAVING_FONT, fontSize: label.height * scale })
        // Font size is the em size; normalize visible glyph height to DXF text height.
        const bounds = text.boundingBox.bounds
        text = text.scale(label.height * scale / (bounds[1][1] - bounds[0][1]))
        const [tx, ty] = text.boundingBox.center
        text = text.translate(-tx, -ty).rotate(readableAngle(label.angleDeg)).translate(label.x * scale, label.y * scale)
        // Start at the pocket floor and overshoot the top, avoiding coincident boolean faces.
        const cutter = text.sketchOnPlane('XY', thickness * scale - depth).extrude(depth + 0.01).asShape3D()
        try {
          const engraved = solid.cut(cutter)
          solid.delete()
          solid = engraved
        } finally { cutter.delete() }
      }
    }
    return solid.translate([-cx * scale, -cy * scale, 0]).asShape3D()
  } catch (error) {
    solid.delete()
    throw error
  }
}
