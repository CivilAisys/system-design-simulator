import type { Edge } from '@/api/client'

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
