import type { Edge, Node } from '@/api/client'

type EdgeEnds = Pick<Edge, 'source' | 'target'>

// 畫布的連線規則：同一對 source → target 只能有一條邊，也不能成環（spec 3.4）
export function canConnect(edges: readonly EdgeEnds[], source: string, target: string): boolean {
  return !edges.some((e) => e.source === source && e.target === target) && !createsCycle(edges, source, target)
}

// 加上 source → target 後是否成環：沿著現有的邊從 target 走得回 source 就是環。
// 自己連自己也算
export function createsCycle(edges: readonly EdgeEnds[], source: string, target: string): boolean {
  const downstream = new Map<string, string[]>()
  for (const e of edges) {
    const next = downstream.get(e.source)
    if (next) {
      next.push(e.target)
    } else {
      downstream.set(e.source, [e.target])
    }
  }
  const seen = new Set<string>()
  const stack = [target]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (id === source) {
      return true
    }
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    stack.push(...(downstream.get(id) ?? []))
  }
  return false
}

// 未連線的節點：沒有任何入邊和出邊，不在拓撲裡（spec 4.5）。看畫布就知道，不必等 Run。
// Client 例外：它沒連線時是驗證錯誤（NO_DOWNSTREAM），照錯誤顯示
export function unconnectedNodeIds(
  nodes: readonly Pick<Node, 'id' | 'type'>[],
  edges: readonly EdgeEnds[],
): Set<string> {
  const connected = new Set(edges.flatMap((e) => [e.source, e.target]))
  return new Set(nodes.filter((n) => n.type !== 'CLIENT' && !connected.has(n.id)).map((n) => n.id))
}

// 結果表格的列順序：照拓撲的節點順序，未連線的節點移到最後（spec 第 6 節）
export function connectedFirst<T extends { id: string }>(nodes: readonly T[], unconnected: ReadonlySet<string>): T[] {
  return [...nodes.filter((n) => !unconnected.has(n.id)), ...nodes.filter((n) => unconnected.has(n.id))]
}
