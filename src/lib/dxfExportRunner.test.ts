import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { runDxfExport, type RunDxfExportParams } from './dxfExportRunner'
import { computePreviewBuildInputs } from './previewBuildInputs'
import { runExportBatches } from './exportBatchPool'
import { DEFAULT_PART_VISIBILITY, PREVIEW_PART_KINDS } from './previewParts'
import { DEFAULT_DXF_SHEET_SETTINGS } from './dxfSheetSettings'

vi.mock('./exportProfile', () => ({ exportProfilingEnabled: () => false }))
vi.mock('./previewBuildInputs', () => ({ computePreviewBuildInputs: vi.fn() }))
vi.mock('./exportBatchPool', () => ({ runExportBatches: vi.fn() }))
vi.mock('./exportPartNames', () => ({ buildExportPartNames: () => ({ struts: { 10: '1', 20: '2', 30: '3' }, flanges: {}, feet: {}, bracePlates: {}, braces: {} }) }))
const params = { shellEnabled: true, roundStrutBridge: false, scale: 1,
  data: { faces: new Map([[7, [0, 1, 2]]]), edges: new Map([[10, [0, 1]], [20, [1, 2]], [30, [2, 0]]]) },
} as unknown as RunDxfExportParams
const frame = { name: '1', kind: 'strut', thickness: 10, loops: [{ closed: true, vertices: [{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 0 }, { x: 0, y: 10, bulge: 0 }] }] }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(computePreviewBuildInputs).mockReturnValue({ strutEntries: [{ index: 10 }], vertices: [{ vertexId: 0 }], halfWidth: 5,
    shellVertices: new Map([[0, new THREE.Vector3(0, 0, 10)], [1, new THREE.Vector3(40, 0, 10)], [2, new THREE.Vector3(0, 30, 10)]]),
  } as unknown as ReturnType<typeof computePreviewBuildInputs>)
  vi.mocked(runExportBatches).mockResolvedValue([{ parts: ['strut', 'flange', 'foot', 'brace-plate', 'brace'].map(kind => ({ ...frame, kind })), bracePoints: [] }])
})

const outline = (kind: string) => `\nPOLYLINE\n8\n${kind}\n`

describe('DXF part selection', () => {
  it.each([[true, true], [true, false], [false, true]])('exports frame=%s shell=%s', async (includeFrameParts, includeShellParts) => {
    const blob = await runDxfExport(params, () => {}, () => false, undefined, { ...DEFAULT_DXF_SHEET_SETTINGS, parts: { flanges: includeFrameParts, struts: includeFrameParts, braces: includeFrameParts, bracePlates: includeFrameParts, foot: includeFrameParts, shell: includeShellParts } })
    const dxf = await blob!.text()
    expect(dxf.includes(outline('STRUTS'))).toBe(includeFrameParts)
    expect(dxf.includes(outline('SHELL'))).toBe(includeShellParts)
    expect(runExportBatches).toHaveBeenCalledTimes(includeFrameParts ? 2 : 0)
  })
  it.each(PREVIEW_PART_KINDS)('exports only $label when selected individually', async ({ kind }) => {
    const parts = { ...DEFAULT_PART_VISIBILITY }
    for (const key of PREVIEW_PART_KINDS) parts[key.kind] = key.kind === kind
    const blob = await runDxfExport(params, () => {}, () => false, undefined, { ...DEFAULT_DXF_SHEET_SETTINGS, parts })
    const dxf = await blob!.text()
    const layers = { struts: 'STRUTS', flanges: 'FLANGES', foot: 'FOOT', bracePlates: 'BRACE_PLATES', braces: 'BRACES', shell: 'SHELL' }
    for (const key of PREVIEW_PART_KINDS) expect(dxf.includes(outline(layers[key.kind]))).toBe(key.kind === kind)
  })
  it('exports both kinds by default' , async () => {
    const blob = await runDxfExport(params, () => {}, () => false)
    const dxf = await blob!.text()
    expect(dxf).toContain(outline('STRUTS'))
    expect(dxf).toContain(outline('SHELL'))
  })
  it('rejects empty selections before building geometry', async () => {
    await expect(runDxfExport(params, () => {}, () => false, undefined, { ...DEFAULT_DXF_SHEET_SETTINGS, parts: { flanges: false, struts: false, braces: false, bracePlates: false, foot: false, shell: false } })).rejects.toThrow('Select at least one part type')
    expect(computePreviewBuildInputs).not.toHaveBeenCalled()
  })
  it('reports when shell-only export has no enabled shell', async () => {
    await expect(runDxfExport({ ...params, shellEnabled: false }, () => {}, () => false, undefined, { ...DEFAULT_DXF_SHEET_SETTINGS, parts: { flanges: false, struts: false, braces: false, bracePlates: false, foot: false, shell: true } })).rejects.toThrow('no selected parts')
    expect(runExportBatches).not.toHaveBeenCalled()
  })
})
