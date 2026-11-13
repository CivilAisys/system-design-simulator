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
    (c: Connection) =>
      setEdges((es) => {
        if (es.some((e) => e.source === c.source && e.target === c.target)) {
          return es
        }
        const edge: Edge = { id: `e-${c.source}-${c.target}`, source: c.source, target: c.target, ...EDGE_DEFAULTS }
        return [...es, toFlowEdge(edge)]
      }),
    [],
  )

  // 新節點取代原本的選取，屬性面板直接切到它
  const addNode = useCallback(
    (type: NodeType, position: { x: number; y: number }) =>
      setNodes((ns) => {
        const node = newNode(
          type,
          ns.map((n) => n.data.node),
          position,
        )
        return [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), { ...toFlowNode(node), selected: true }]
      }),
    [],
  )

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
    onNodesChange,
    onEdgesChange,
    onConnect,
    isValidConnection,
    addNode,
    updateNode,
    updateEdge,
  }
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
