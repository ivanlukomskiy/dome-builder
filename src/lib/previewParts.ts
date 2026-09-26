// The kinds of parts the Preview is made of, each drawn as its own mesh so its transparency can be
// set on its own (view-only - it doesn't touch the geometry, so changing it never rebuilds the
// preview, and it isn't saved with the dome).
export type PreviewPartKind = 'flanges' | 'struts' | 'braces' | 'bracePlates' | 'foot'

export const PREVIEW_PART_KINDS: { kind: PreviewPartKind; label: string }[] = [
  { kind: 'flanges', label: 'Flanges' },
  { kind: 'struts', label: 'Struts' },
  { kind: 'braces', label: 'Braces' },
  { kind: 'bracePlates', label: 'Brace plates' },
  { kind: 'foot', label: 'Foot' },
]

// Transparency, in percent: 0 is fully opaque, and it can't go past this - a part that's nearly
// invisible is easy to lose track of.
export const MIN_PART_TRANSPARENCY = 0
export const MAX_PART_TRANSPARENCY = 85
export const PART_TRANSPARENCY_STEP = 5

export type PartTransparency = Record<PreviewPartKind, number>

export const DEFAULT_PART_TRANSPARENCY: PartTransparency = {
  flanges: 0,
  struts: 0,
  braces: 0,
  bracePlates: 0,
  foot: 0,
}

export function clampPartTransparency(percent: number): number {
  if (!Number.isFinite(percent)) return MIN_PART_TRANSPARENCY
  return Math.min(Math.max(percent, MIN_PART_TRANSPARENCY), MAX_PART_TRANSPARENCY)
}

// The material opacity (0-1) for a transparency percentage.
export function partOpacity(transparencyPercent: number): number {
  return 1 - clampPartTransparency(transparencyPercent) / 100
}
