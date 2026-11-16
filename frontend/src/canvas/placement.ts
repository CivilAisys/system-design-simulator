// 點元件面板新增節點時，從畫面中央往外找最近一個不和既有節點重疊的位置（拖曳新增放在滑鼠放開的位置，不用這裡）

export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
// 節點左上角的位置和大小，和 React Flow 的 position 一致
export type Rect = Point & Size

// 新節點還沒畫出來、量不到大小，用一般節點的大小估計（SimNode 最小寬 144px，有指標時比較高）
export const ESTIMATED_NODE_SIZE: Size = { width: 180, height: 100 }
// 節點之間至少留的空隙，連線才看得到
const GAP = 24
// 找不到空位時（畫面被塞滿）放回中央，不無限往外找
const MAX_RINGS = 20

/**
 * 以節點大小加空隙為格距，從中央一圈一圈往外找，同一圈裡取離中央最近的空位。
 * 回傳新節點左上角的位置。
 */
export function findFreePosition(center: Point, occupied: Rect[], size: Size = ESTIMATED_NODE_SIZE): Point {
  const origin = { x: center.x - size.width / 2, y: center.y - size.height / 2 }
  const stepX = size.width + GAP
  const stepY = size.height + GAP
  for (let ring = 0; ring <= MAX_RINGS; ring++) {
    const candidates = ringCells(ring)
      .map(([i, j]) => ({ x: origin.x + i * stepX, y: origin.y + j * stepY }))
      .sort((a, b) => distance(a, origin) - distance(b, origin))
    const free = candidates.find((position) => occupied.every((rect) => !overlaps({ ...position, ...size }, rect)))
    if (free) return free
  }
  return origin
}

// 第 ring 圈的格子：和中央的 x、y 格數差的最大值剛好是 ring
function ringCells(ring: number): [number, number][] {
  if (ring === 0) return [[0, 0]]
  const cells: [number, number][] = []
  for (let i = -ring; i <= ring; i++) {
    for (let j = -ring; j <= ring; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) === ring) cells.push([i, j])
    }
  }
  return cells
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// 距離小於 GAP 也算重疊
function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width + GAP && b.x < a.x + a.width + GAP && a.y < b.y + b.height + GAP && b.y < a.y + a.height + GAP
  )
}
