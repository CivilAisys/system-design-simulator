import { describe, expect, it } from 'vitest'
import { ESTIMATED_NODE_SIZE, findFreePosition, type Rect } from './placement'

const SIZE = ESTIMATED_NODE_SIZE
const CENTER = { x: 500, y: 300 }
// 新節點放在中央時的左上角
const AT_CENTER = { x: CENTER.x - SIZE.width / 2, y: CENTER.y - SIZE.height / 2 }

function rectAt(position: { x: number; y: number }): Rect {
  return { ...position, ...SIZE }
}

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

describe('findFreePosition', () => {
  it('中央空著時放在中央', () => {
    expect(findFreePosition(CENTER, [])).toEqual(AT_CENTER)
  })

  it('遠處的節點不影響', () => {
    expect(findFreePosition(CENTER, [rectAt({ x: 2000, y: 2000 })])).toEqual(AT_CENTER)
  })

  it('中央被占時放在最近的空位，不和它重疊', () => {
    const occupied = rectAt(AT_CENTER)
    const position = findFreePosition(CENTER, [occupied])

    expect(overlap(rectAt(position), occupied)).toBe(false)
    // 最近的空位在第一圈：上下左右相鄰的格子
    const offset = Math.hypot(position.x - AT_CENTER.x, position.y - AT_CENTER.y)
    expect(offset).toBeLessThanOrEqual(SIZE.width + 24)
  })

  it('連續新增多個不會互相重疊', () => {
    const placed: Rect[] = []
    for (let i = 0; i < 12; i++) {
      placed.push(rectAt(findFreePosition(CENTER, placed)))
    }

    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        expect(overlap(a, b)).toBe(false)
      }
    }
  })

  it('避開比估計大小還大的節點', () => {
    const wide = { x: AT_CENTER.x - 200, y: AT_CENTER.y, width: 600, height: SIZE.height }
    const position = findFreePosition(CENTER, [wide])

    expect(overlap(rectAt(position), wide)).toBe(false)
  })
})
