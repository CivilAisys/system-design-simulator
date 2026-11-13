import { useCallback, useMemo, useState } from 'react'
import {
  applyEdgeChanges,
  applyNodeChanges,
  MarkerType,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import type { Edge, Node, NodeType, Topology } from '@/api/client'
import { newNode, type NodeParams } from './catalog'
import type { SimFlowNode } from './SimNode'
import type { RpsFlowEdge } from './RpsEdge'

const TOPOLOGY_VERSION = 1

// spec 3.4 的預設值
const EDGE_DEFAULTS = { weight: 1, callsPerRequest: 1, latencyMs: 1 }

export type NodePatch = { name?: string; params?: Partial<NodeParams> }
export type EdgePatch = Partial<Pick<Edge, 'weight' | 'callsPerRequest' | 'latencyMs'>>

// 畫布上的 React Flow nodes／edges 是唯一的狀態來源（含位置和選取），
// 送給後端的 Topology 從它們推導，位置寫回 ui 欄位
export function useTopologyEditor(initial: Topology) {
  const [nodes, setNodes] = useState<SimFlowNode[]>(() => initial.nodes.map(toFlowNode))
  const [edges, setEdges] = useState<RpsFlowEdge[]>(() => initial.edges.map(toFlowEdge))
  // 用過的節點和邊 id（含已刪除的），新建時不沿用，見 newNode。只在事件中修改，不影響畫面
  const [usedIds] = useState(() => new Set([...initial.nodes, ...initial.edges].map((item) => item.id)))

  const onNodesChange = useCallback(
    (changes: NodeChange<SimFlowNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange<RpsFlowEdge>[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  )

  // 同一對 source → target 只能有一條邊（spec 3.4）；自己連自己必定是環，也一併擋掉
  const isValidConnection = useCallback(
    (c: Connection | RpsFlowEdge) =>
      c.source !== c.target && !edges.some((e) => e.source === c.source && e.target === c.target),
    [edges],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      // 刪掉再重連同一對節點時不能沿用舊的 id，理由同 newNode
      const id = unusedId(`e-${c.source}-${c.target}`, usedIds)
      usedIds.add(id)
      setEdges((es) => {
        if (es.some((e) => e.source === c.source && e.target === c.target)) {
          return es
        }
        return [...es, toFlowEdge({ id, source: c.source, target: c.target, ...EDGE_DEFAULTS })]
      })
    },
    [usedIds],
  )

  // 新節點取代原本的選取，屬性面板直接切到它
  const addNode = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      const node = newNode(type, usedIds, position)
      usedIds.add(node.id)
      setNodes((ns) => [
        ...ns.map((n) => (n.selected ? { ...n, selected: false } : n)),
        { ...toFlowNode(node), selected: true },
      ])
    },
    [usedIds],
  )

  // 只選取這個節點或邊（另一個傳 null），屬性面板會切到它
  const select = useCallback((target: { nodeId: string | null; edgeId: string | null }) => {
    setNodes((ns) => ns.map((n) => withSelected(n, n.id === target.nodeId)))
    setEdges((es) => es.map((e) => withSelected(e, e.id === target.edgeId)))
  }, [])

  const updateNode = useCallback(
    (id: string, patch: NodePatch) =>
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== id) {
            return n
          }
          const node = n.data.node
          return {
            ...n,
            data: {
              ...n.data,
              node: { ...node, name: patch.name ?? node.name, params: { ...node.params, ...patch.params } },
            },
          }
        }),
      ),
    [],
  )

  const updateEdge = useCallback(
    (id: string, patch: EdgePatch) =>
      setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, edge: { ...e.data.edge, ...patch } } } : e))),
    [],
  )

  // 只看 data（參數、名稱、連線），拖動和選取只換掉 React Flow 節點本身、data 不變，
  // 所以這份拓撲在拖動時維持同一個參考，Auto-run 不用每一幀都重新比對
  const nodeModels = useShallowStable(nodes.map((n) => n.data.node))
  const edgeModels = useShallowStable(edges.map((e) => e.data.edge))
  const model = useMemo<Topology>(
    () => ({ version: TOPOLOGY_VERSION, nodes: nodeModels.map(({ ui: _ui, ...node }) => node), edges: edgeModels }),
    [nodeModels, edgeModels],
  )

  const topology = useMemo<Topology>(
    () => ({
      version: TOPOLOGY_VERSION,
      nodes: nodes.map((n) => ({ ...n.data.node, ui: { x: n.position.x, y: n.position.y } })),
      edges: edges.map((e) => e.data.edge),
    }),
    [nodes, edges],
  )

  return {
    nodes,
    edges,
    topology,
    model,
    onNodesChange,
    onEdgesChange,
    onConnect,
    isValidConnection,
    addNode,
    select,
    updateNode,
    updateEdge,
  }
}

// 元素逐一相同時沿用上一次的陣列（在 render 中更新 state，React 文件的「儲存前一次 render 的資訊」寫法）
function useShallowStable<T>(items: T[]): T[] {
  const [stable, setStable] = useState(items)
  if (stable.length === items.length && stable.every((item, i) => item === items[i])) {
    return stable
  }
  setStable(items)
  return items
}

// base 沒用過就用 base，否則加上 -2、-3…
function unusedId(base: string, usedIds: ReadonlySet<string>): string {
  let id = base
  for (let n = 2; usedIds.has(id); n++) {
    id = `${base}-${n}`
  }
  return id
}

// 選取狀態沒變時沿用原物件，React Flow 不用重畫它
function withSelected<T extends { selected?: boolean }>(item: T, selected: boolean): T {
  return (item.selected ?? false) === selected ? item : { ...item, selected }
}

function toFlowNode(node: Node): SimFlowNode {
  return { id: node.id, type: 'sim', position: node.ui ?? { x: 0, y: 0 }, data: { node } }
}

function toFlowEdge(edge: Edge): RpsFlowEdge {
  return {
    id: edge.id,
    type: 'rps',
    source: edge.source,
    target: edge.target,
    markerEnd: { type: MarkerType.ArrowClosed },
    data: { edge },
  }
}
