import { describe, expect, it } from 'vitest'
import { ESTIMATED_NODE_SIZE, findFreePosition, NODE_GAP, type Point } from './placement'

const SIZE = ESTIMATED_NODE_SIZE
const STEP_X = SIZE.width + NODE_GAP
const STEP_Y = SIZE.height + NODE_GAP
const CENTER = { x: 500, y: 300 }
// 新節點放在中央時的左上角
const AT_CENTER = { x: CENTER.x - SIZE.width / 2, y: CENTER.y - SIZE.height / 2 }

// 還沒量過大小的節點，用估計值
function nodeAt(position: Point) {
  return { position }
}

// 中央往右 col 格、往下 row 格
function cell(col: number, row: number): Point {
  return { x: AT_CENTER.x + col * STEP_X, y: AT_CENTER.y + row * STEP_Y }
}

function overlap(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < SIZE.width && Math.abs(a.y - b.y) < SIZE.height
}

describe('findFreePosition', () => {
  it('中央空著時放在中央', () => {
    expect(findFreePosition(CENTER, [])).toEqual(AT_CENTER)
  })

  it('遠處的節點不影響', () => {
    expect(findFreePosition(CENTER, [nodeAt({ x: 2000, y: 2000 })])).toEqual(AT_CENTER)
  })

  it('中央被占時放在最近的空位：上下相鄰的格子', () => {
    const position = findFreePosition(CENTER, [nodeAt(AT_CENTER)])

    expect(position.x).toBe(AT_CENTER.x)
    expect(Math.abs(position.y - AT_CENTER.y)).toBe(STEP_Y)
  })

  it('格距不是正方形時，外圈正上方的格子比內圈斜角的近', () => {
    // 中央周圍兩圈只剩右邊 (2, 1) 空著；正上方第三圈 (0, -3) 比它近
    const occupied = []
    for (let row = -2; row <= 2; row++) {
      for (let col = -2; col <= 2; col++) {
        if (col !== 2 || row !== 1) occupied.push(nodeAt(cell(col, row)))
      }
    }
    const position = findFreePosition(CENTER, occupied)

    expect(position.x).toBe(AT_CENTER.x)
    expect(Math.abs(position.y - AT_CENTER.y)).toBe(3 * STEP_Y)
  })

  it('連續新增多個不會互相重疊', () => {
    const placed: Point[] = []
    for (let i = 0; i < 12; i++) {
      placed.push(findFreePosition(CENTER, placed.map(nodeAt)))
    }

    for (const [i, a] of placed.entries()) {
      for (const b of placed.slice(i + 1)) {
        expect(overlap(a, b)).toBe(false)
      }
    }
  })

  it('量到的大小比估計值大時照實際大小避開', () => {
    const wide = { position: { x: AT_CENTER.x - 200, y: AT_CENTER.y }, measured: { width: 600, height: SIZE.height } }
    const position = findFreePosition(CENTER, [wide])

    // 同一列左右相鄰的格子都碰到它，只能放上下
    expect(position.x).toBe(AT_CENTER.x)
    expect(Math.abs(position.y - AT_CENTER.y)).toBe(STEP_Y)
  })
})
