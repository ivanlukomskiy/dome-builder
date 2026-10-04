// The angle steps (degrees) a part may be turned by when arranged on a sheet; 0 keeps every part
// as it is. Finer steps try more orientations per part: tighter sheets, slower packing.
export const DXF_ROTATION_STEPS = [0, 90, 60, 30, 10] as const
export type DxfRotationStep = (typeof DXF_ROTATION_STEPS)[number]

export interface DxfSheetSettings {
  arrangeOnSheet: boolean
  width: number
  height: number
  margin: number
  spacing: number
  rotationStep: DxfRotationStep
}

export const DEFAULT_DXF_SHEET_SETTINGS: DxfSheetSettings = {
  arrangeOnSheet: false,
  width: 2440,
  height: 1220,
  margin: 10,
  spacing: 5,
  rotationStep: 90,
}

// Every angle (radians) a part may be placed at: the multiples of the step within a full turn.
export function allowedRotations(step: DxfRotationStep): number[] {
  if (step === 0) return [0]
  return Array.from({ length: 360 / step }, (_, i) => (i * step * Math.PI) / 180)
}

export function validateDxfSheetSettings(settings: DxfSheetSettings): void {
  const { width, height, margin, spacing } = settings
  if (![width, height, margin, spacing].every(Number.isFinite)) throw new Error('Sheet dimensions, margin, and spacing must be finite numbers.')
  if (width <= 0 || height <= 0) throw new Error('Sheet width and height must be greater than zero.')
  if (margin < 0 || spacing < 0) throw new Error('Sheet margin and part spacing cannot be negative.')
  if (2 * margin >= Math.min(width, height)) throw new Error('Sheet margin leaves no usable area.')
  if (!DXF_ROTATION_STEPS.includes(settings.rotationStep)) throw new Error('Rotation step must be one of 0, 90, 60, 30 or 10 degrees.')
  if (Math.max(width, height, spacing) > 1_000_000) throw new Error('Sheet dimensions and spacing cannot exceed 1,000,000 mm.')
}
