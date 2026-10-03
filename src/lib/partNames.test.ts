import { describe, expect, it } from 'vitest'
import { bracePlateNameKey, createPartNameMaps, flangeNameKey } from './partNames'

describe('createPartNameMaps', () => {
  it('adds a dot only to IDs made entirely of 6 and 9', () => {
    const items = Array.from({ length: 197 }, (_, i) => ({
      id: i + 1, center: [1, -i, 0] as [number, number, number],
    }))
    const names = createPartNameMaps({
      struts: items, feet: items, braces: items,
      flanges: items.map(({ id, center }) => ({ vertexId: id, side: 'inner', center })),
      bracePlates: items.map(({ id, center }) => ({ id: String(id), center })),
    })
    for (const map of [names.struts, names.feet, names.braces, names.bracePlates]) {
      for (const id of [6, 9, 66, 69, 96, 99]) expect(map[id]).toBe(`${id}.`)
      for (const id of [1, 8, 11, 16, 18, 26, 49, 60, 67, 81, 88, 90, 101, 169, 196, 197]) {
        expect(map[id]).toBe(String(id))
      }
    }
    expect(names.flanges[flangeNameKey(69, 'inner')]).toBe('69.')
    expect(names.flanges[flangeNameKey(96, 'inner')]).toBe('96.')
  })

  it('numbers parts continuously from top to bottom and clockwise within each elevation', () => {
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
    )

    expect(names.struts[11]).toBe('1')
    expect(names.struts[10]).toBe('2')
    expect(names.struts[12]).toBe('3')
    expect(names.flanges[flangeNameKey(1, 'inner')]).toBe('1')
    expect(names.flanges[flangeNameKey(2, 'inner')]).toBe('2')
    expect(names.flanges[flangeNameKey(1, 'outer')]).toBe('3')
    expect(names.flanges[flangeNameKey(2, 'outer')]).toBe('4')
  })

  it('uses independent numeric sequences for feet, brace plates, and braces', () => {
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
    )

    expect(names.feet[2]).toBe('1')
    expect(names.feet[1]).toBe('2')
    expect(names.bracePlates[bracePlateNameKey(8, 21, 'B')]).toBe('1')
    expect(names.bracePlates[bracePlateNameKey(7, 20, 'A')]).toBe('2')
    expect(names.braces[6]).toBe('2')
    expect(names.braces[5]).toBe('1')
  })

  it('preserves clockwise ordering for near-equal elevations and breaks angle ties deterministically', () => {
    const input = {
      struts: [
        { id: 20, center: [0, 100 + 1e-8, -1] as [number, number, number] },
        { id: 10, center: [1, 100, 0] as [number, number, number] },
        { id: 2, center: [1, 100, 0] as [number, number, number] },
        { id: 1, center: [1, 50, 0] as [number, number, number] },
      ],
      flanges: [], feet: [], bracePlates: [], braces: [],
    }
    const names = createPartNameMaps(input)
    expect(names.struts).toEqual({ 2: '1', 10: '2', 20: '3', 1: '4' })
    expect(createPartNameMaps({ ...input, struts: [...input.struts].reverse() })).toEqual(names)
    expect(names.feet).toEqual({})
  })
})
