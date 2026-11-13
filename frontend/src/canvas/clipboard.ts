import type { Edge, Node } from '@/api/client'
import { newEdgeId, newNodeId } from './catalog'

// 每貼一次多往右下偏移這麼多，連續貼上的複本不會疊在一起
const PASTE_OFFSET = 40

// 一組節點（含 ui 位置）和它們之間的邊：複製下來的內容，或貼上產生的新節點和邊
export type Clip = { nodes: Node[]; edges: Edge[] }

// 複製選取的節點，連同兩端都被選取的邊；連到沒被選取的節點的邊不複製。沒有選取節點時回傳 null
export function copyNodes(nodes: readonly Node[], edges: readonly Edge[], selected: ReadonlySet<string>): Clip | null {
  const copied = nodes.filter((n) => selected.has(n.id))
  if (copied.length === 0) {
    return null
  }
  return { nodes: copied, edges: edges.filter((e) => selected.has(e.source) && selected.has(e.target)) }
}

// 同一份複製內容的第 pastes 次貼上（從 1 起算）：參數相同，id 沒用過（見 newNode），名稱和現有的節點不同，位置偏移 pastes 次
export function pasteClip(clip: Clip, pastes: number, usedIds: ReadonlySet<string>, usedNames: Iterable<string>): Clip {
  const ids = new Set(usedIds)
  const names = new Set(usedNames)
  const newIds = new Map<string, string>()
  const offset = PASTE_OFFSET * pastes
  const nodes = clip.nodes.map((node) => {
    const id = newNodeId(node.type, ids)
    ids.add(id)
    newIds.set(node.id, id)
    const name = copyName(node.name, names)
    names.add(name)
    const { x, y } = node.ui ?? { x: 0, y: 0 }
    return { ...node, id, name, params: { ...node.params }, ui: { x: x + offset, y: y + offset } }
  })
  const edges = clip.edges.map((edge) => {
    const source = newIds.get(edge.source)!
    const target = newIds.get(edge.target)!
    const id = newEdgeId(source, target, ids)
    ids.add(id)
    return { ...edge, id, source, target }
  })
  return { nodes, edges }
}

// 「API」→「API 2」、「API 2」→「API 3」：去掉結尾的編號，接上第一個沒被用掉的編號
function copyName(name: string, names: ReadonlySet<string>): string {
  // 只去掉空格隔開的編號，「S3」這類名稱本身的數字留著
  const base = name.replace(/ \d+$/, '')
  const numbered = (n: number) => (base === '' ? String(n) : `${base} ${n}`)
  let n = 2
  while (names.has(numbered(n))) {
    n++
  }
  return numbered(n)
}
