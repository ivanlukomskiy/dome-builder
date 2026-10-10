export type PreviewPartKind = 'flanges' | 'struts' | 'braces' | 'bracePlates' | 'foot' | 'shell'

export const PREVIEW_PART_KINDS: { kind: PreviewPartKind; label: string }[] = [
  { kind: 'flanges', label: 'Flanges' },
  { kind: 'struts', label: 'Struts' },
  { kind: 'braces', label: 'Braces' },
  { kind: 'bracePlates', label: 'Brace plates' },
  { kind: 'foot', label: 'Foot' },
  { kind: 'shell', label: 'Shell' },
]

// Visibility is view-only and never rebuilds or changes the exported geometry.
export type PartVisibility = Record<PreviewPartKind, boolean>

export const DEFAULT_PART_VISIBILITY: PartVisibility = {
  flanges: true,
  struts: true,
  braces: true,
  bracePlates: true,
  foot: true,
  shell: true,
}
