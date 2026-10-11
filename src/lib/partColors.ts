import { Color, LinearSRGBColorSpace } from 'three'

// Shared Preview and STEP palette, stored in Three's linear RGB space.
export const FLANGE_COLOR = new Color('#b0b4bc')
// Vertices with a corner length or flange parameter override.
export const CORNER_OVERRIDE_COLOR = new Color('#22d3ee')
export const BRACE_BODY_COLOR: [number, number, number] = [0.96, 0.62, 0.13]
export const BRACE_PLATE_COLOR: [number, number, number] = [0.878, 0.353, 0.816]
export const FOOT_COLOR: [number, number, number] = [0.753, 0.518, 0.961]
export const SHELL_COLOR = new Color('#c5d4df')

// Thickness overrides saturate the green-to-red heatmap at 300 mm.
export function edgeThicknessColor(override: number | undefined): Color {
  if (override === undefined) return new Color('#3a5a7a')
  return new Color('#4fd97e').lerp(new Color('#ff3b3b'), Math.min(override / 300, 1))
}

// Replicad passes these byte channels straight to OpenCascade's linear RGB
// constructor. Avoid Three's default conversion to sRGB here.
export function stepColor(color: Color | [number, number, number]): string {
  const linear = Array.isArray(color) ? new Color().setRGB(...color) : color
  return `#${linear.getHexString(LinearSRGBColorSpace)}`
}
