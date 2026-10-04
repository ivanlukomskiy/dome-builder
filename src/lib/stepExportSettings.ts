import { DEFAULT_DXF_LABEL_SETTINGS, type DxfLabelSettings } from './dxfLabelSettings'

export interface StepExportSettings extends DxfLabelSettings {
  addLabels: boolean
  depth: number
}

export const DEFAULT_STEP_EXPORT_SETTINGS: StepExportSettings = { addLabels: false, depth: 1, ...DEFAULT_DXF_LABEL_SETTINGS }

export function validateStepLabelDepth(depth: number, thickness?: number): void {
  if (!Number.isFinite(depth) || depth <= 0) throw new Error('Label depth must be greater than 0 mm.')
  if (thickness !== undefined && depth >= thickness) {
    throw new Error(`Label depth (${depth} mm) must be less than the exported part thickness (${thickness} mm).`)
  }
}
