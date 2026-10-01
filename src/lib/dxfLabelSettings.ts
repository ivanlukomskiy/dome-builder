// Text heights in millimeters before applying the export scale.
export interface DxfLabelSettings {
  partIdLabelSize: number
  connectedPartIdLabelSize: number
}

export const DEFAULT_DXF_LABEL_SETTINGS: DxfLabelSettings = {
  partIdLabelSize: 8,
  connectedPartIdLabelSize: 5,
}
