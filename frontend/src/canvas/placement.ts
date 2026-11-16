// 點元件面板新增節點時，從畫面中央往外找最近一個不和既有節點重疊的位置（拖曳新增放在滑鼠放開的位置，不用這裡）

export type Point = { x: number; y: number }
type Rect = Point & { width: number; height: number }
// 只用到 React Flow 節點的位置（左上角）和量到的大小
export type PlacedNode = { position: Point; measured?: { width?: number; height?: number } }

// 新節點還沒畫出來、量不到大小，用一般節點的大小估計（SimNode 最小寬 144px，有指標時比較高）。
// 剛載入、還沒量過的既有節點也用這個值
export const ESTIMATED_NODE_SIZE = { width: 180, height: 100 }
// 節點之間至少留的空隙，連線才看得到
export const NODE_GAP = 24
// 往外找的格數上限；全部被占（實際上碰不到）時放回中央
const MAX_CELLS = 20

/**
 * 以節點大小加空隙為格距，在中央周圍的格子裡取離中央最近、不和既有節點重疊的一格。
 * 回傳新節點左上角的位置。
 */
export function findFreePosition(center: Point, nodes: PlacedNode[]): Point {
  const size = ESTIMATED_NODE_SIZE
  const origin = { x: center.x - size.width / 2, y: center.y - size.height / 2 }
  const occupied = nodes.map(toRect)
  const free = gridAround(origin)
    .sort((a, b) => distance(a, origin) - distance(b, origin))
    .find((position) => occupied.every((rect) => !overlaps({ ...position, ...size }, rect)))
  return free ?? origin
}

// 格距不是正方形，所以不能一圈一圈找：外圈正上方的格子可能比內圈斜角的近。全部列出來再依距離排序
function gridAround(origin: Point): Point[] {
  const stepX = ESTIMATED_NODE_SIZE.width + NODE_GAP
  const stepY = ESTIMATED_NODE_SIZE.height + NODE_GAP
  const cells: Point[] = []
  for (let row = -MAX_CELLS; row <= MAX_CELLS; row++) {
    for (let col = -MAX_CELLS; col <= MAX_CELLS; col++) {
      cells.push({ x: origin.x + col * stepX, y: origin.y + row * stepY })
    }
  }
  return cells
}

function toRect({ position, measured }: PlacedNode): Rect {
  return {
    ...position,
    width: measured?.width ?? ESTIMATED_NODE_SIZE.width,
    height: measured?.height ?? ESTIMATED_NODE_SIZE.height,
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// 距離小於 NODE_GAP 也算重疊
function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width + NODE_GAP &&
    b.x < a.x + a.width + NODE_GAP &&
    a.y < b.y + b.height + NODE_GAP &&
    b.y < a.y + a.height + NODE_GAP
  )
}
