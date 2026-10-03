export interface DxfSheetSettings {
  arrangeOnSheet: boolean
  width: number
  height: number
  margin: number
  spacing: number
}

export const DEFAULT_DXF_SHEET_SETTINGS: DxfSheetSettings = {
  arrangeOnSheet: false,
  width: 2440,
  height: 1220,
  margin: 10,
  spacing: 5,
}

export function validateDxfSheetSettings(settings: DxfSheetSettings): void {
  const { width, height, margin, spacing } = settings
  if (![width, height, margin, spacing].every(Number.isFinite)) throw new Error('Sheet dimensions, margin, and spacing must be finite numbers.')
  if (width <= 0 || height <= 0) throw new Error('Sheet width and height must be greater than zero.')
  if (margin < 0 || spacing < 0) throw new Error('Sheet margin and part spacing cannot be negative.')
  if (2 * margin >= Math.min(width, height)) throw new Error('Sheet margin leaves no usable area.')
  if (Math.max(width, height, spacing) > 1_000_000) throw new Error('Sheet dimensions and spacing cannot exceed 1,000,000 mm.')
}
