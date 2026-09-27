import { describe, expect, it } from 'vitest'
import { bracePlateNameKey, createPartNameMaps, flangeNameKey } from './partNames'

describe('createPartNameMaps', () => {
  it('groups elevation-named parts highest first and numbers each group clockwise around Y', () => {
    const names = createPartNameMaps(
      {
        struts: [
          { id: 10, center: [0, 100, -1] },
          { id: 11, center: [1, 100, 0] },
          { id: 12, center: [-1, 50, 0] },
        ],
        flanges: [
          { vertexId: 1, side: 'inner', center: [1, 20, 0] },
          { vertexId: 2, side: 'inner', center: [0, 20, -1] },
          { vertexId: 1, side: 'outer', center: [1, 10, 0] },
          { vertexId: 2, side: 'outer', center: [0, 10, -1] },
        ],
        feet: [],
        bracePlates: [],
        braces: [],
      },
      'en',
    )

    expect(names.struts[11]).toBe('S-A1')
    expect(names.struts[10]).toBe('S-A2')
    expect(names.struts[12]).toBe('S-B1')
    expect(names.flanges[flangeNameKey(1, 'inner')]).toBe('FI-A1')
    expect(names.flanges[flangeNameKey(2, 'inner')]).toBe('FI-A2')
    expect(names.flanges[flangeNameKey(1, 'outer')]).toBe('FE-A1')
    expect(names.flangePairs[1]).toBe('FI-A1/FE-A1')
  })

  it('numbers foots, brace plates, and braces clockwise without elevation letters', () => {
    const names = createPartNameMaps(
      {
        struts: [],
        flanges: [],
        feet: [
          { id: 1, center: [0, 0, -1] },
          { id: 2, center: [1, 100, 0] },
        ],
        bracePlates: [
          { id: bracePlateNameKey(7, 20, 'A'), center: [-1, 0, 0] },
          { id: bracePlateNameKey(8, 21, 'B'), center: [0, 0, -1] },
        ],
        braces: [
          { id: 5, center: [0, 20, 1] },
          { id: 6, center: [1, 10, 0] },
        ],
      },
      'ru',
    )

    expect(names.feet[2]).toBe('О-1')
    expect(names.feet[1]).toBe('О-2')
    expect(names.bracePlates[bracePlateNameKey(8, 21, 'B')]).toBe('ПР-1')
    expect(names.bracePlates[bracePlateNameKey(7, 20, 'A')]).toBe('ПР-2')
    expect(names.braces[6]).toBe('Р-1')
    expect(names.braces[5]).toBe('Р-2')
  })
})
