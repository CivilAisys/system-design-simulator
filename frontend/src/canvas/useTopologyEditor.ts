import { useCallback, useMemo, useRef, useState } from 'react'
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import type { Edge, Node, NodeType, Topology } from '@/api/client'
import { newNode, type NodeParams } from './catalog'
import type { SimFlowNode } from './SimNode'
import { arrowMarker } from './edgeStyle'
import { canConnect } from './graph'
import { commit, createHistory, redo, replace, undo, type History, type Step } from './history'
import type { RpsFlowEdge } from './RpsEdge'

const TOPOLOGY_VERSION = 1

// spec 3.4 的預設值
const EDGE_DEFAULTS = { weight: 1, callsPerRequest: 1, latencyMs: 1 }

export type NodePatch = { name?: string; params?: Partial<NodeParams> }
export type EdgePatch = Partial<Pick<Edge, 'weight' | 'callsPerRequest' | 'latencyMs'>>

type CanvasState = { nodes: SimFlowNode[]; edges: RpsFlowEdge[] }

// 畫布上的 React Flow nodes／edges 是唯一的狀態來源（含位置和選取），
// 送給後端的 Topology 從它們推導，位置寫回 ui 欄位。
// 每次修改連同當時的選取記成一步，可以復原和重做；選取、量尺寸不算一步
export function useTopologyEditor(initial: Topology) {
  const [history, setHistory] = useState<History<CanvasState>>(() => createHistory(toCanvasState(initial)))
  const { nodes, edges } = history.present
  // 用過的節點和邊 id（含已刪除的），新建時不沿用，見 newNode。只在事件中修改，不影響畫面。
  // 復原回來的節點和邊因此不會和別的元素同 id，畫布上的結果（以 id 對應）不會套錯
  const [usedIds] = useState(() => new Set([...initial.nodes, ...initial.edges].map((item) => item.id)))
  const removeGroup = useRemoveGroup()

  // 修改畫布，記成一步
  const edit = useCallback((update: (state: CanvasState) => CanvasState, group: string | null = null) => {
    const at = Date.now()
    setHistory((h) => commit(h, update(h.present), { group, at }))
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange<SimFlowNode>[]) => {
      const step: Step = { group: changes.some(isRemove) ? removeGroup() : moveGroup(changes), at: Date.now() }
      setHistory((h) => {
        const next = { ...h.present, nodes: applyNodeChanges(changes, h.present.nodes) }
        return isNodeEdit(changes, h.present.nodes) ? commit(h, next, step) : replace(h, next)
      })
    },
    [removeGroup],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange<RpsFlowEdge>[]) => {
      const removed = changes.some(isRemove)
      const step: Step = { group: removed ? removeGroup() : null, at: Date.now() }
      setHistory((h) => {
        const next = { ...h.present, edges: applyEdgeChanges(changes, h.present.edges) }
        return removed ? commit(h, next, step) : replace(h, next)
      })
    },
    [removeGroup],
  )

  const isValidConnection = useCallback(
    (c: Connection | RpsFlowEdge) => canConnect(edges, c.source, c.target),
    [edges],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      // 刪掉再重連同一對節點時不能沿用舊的 id，理由同 newNode
      const id = unusedId(`e-${c.source}-${c.target}`, usedIds)
      usedIds.add(id)
      edit((state) => {
        if (!canConnect(state.edges, c.source, c.target)) {
          return state
        }
        const edge = toFlowEdge({ id, source: c.source, target: c.target, ...EDGE_DEFAULTS })
        return { ...state, edges: [...state.edges, edge] }
      })
    },
    [usedIds, edit],
  )

  // 新節點取代原本的選取，屬性面板直接切到它
  const addNode = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      const node = newNode(type, usedIds, position)
      usedIds.add(node.id)
      edit((state) => ({
        ...state,
        nodes: [...state.nodes.map((n) => withSelected(n, false)), { ...toFlowNode(node), selected: true }],
      }))
    },
    [usedIds, edit],
  )

  // 整份換成另一個拓撲（匯入、載入範例），復原紀錄清空。它的 id 也算用過，之後新建的節點和邊不會撞到
  const load = useCallback(
    (topology: Topology) => {
      for (const item of [...topology.nodes, ...topology.edges]) {
        usedIds.add(item.id)
      }
      setHistory(createHistory(toCanvasState(topology)))
    },
    [usedIds],
  )

  // 只選取這個節點或邊（另一個傳 null），屬性面板會切到它
  const select = useCallback((target: { nodeId: string | null; edgeId: string | null }) => {
    setHistory((h) =>
      replace(h, {
        nodes: h.present.nodes.map((n) => withSelected(n, n.id === target.nodeId)),
        edges: h.present.edges.map((e) => withSelected(e, e.id === target.edgeId)),
      }),
    )
  }, [])

  // 連續修改同一個欄位（打字、拖 slider）併成一步。值沒變（例如 "5" 打成 "5."）不算一步
  const updateNode = useCallback(
    (id: string, patch: NodePatch) =>
      edit(
        (state) => ({
          ...state,
          nodes: state.nodes.map((n) => {
            const node = n.data.node
            const unchanged = sameValues(node, { name: patch.name }) && sameValues(node.params, patch.params ?? {})
            if (n.id !== id || unchanged) {
              return n
            }
            return {
              ...n,
              data: {
                ...n.data,
                node: { ...node, name: patch.name ?? node.name, params: { ...node.params, ...patch.params } },
              },
            }
          }),
        }),
        fieldGroup(`node:${id}`, { name: patch.name, ...patch.params }),
      ),
    [edit],
  )

  const updateEdge = useCallback(
    (id: string, patch: EdgePatch) =>
      edit(
        (state) => ({
          ...state,
          edges: state.edges.map((e) =>
            e.id === id && !sameValues(e.data.edge, patch)
              ? { ...e, data: { ...e.data, edge: { ...e.data.edge, ...patch } } }
              : e,
          ),
        }),
        fieldGroup(`edge:${id}`, patch),
      ),
    [edit],
  )

  const undoEdit = useCallback(() => setHistory(undo), [])
  const redoEdit = useCallback(() => setHistory(redo), [])

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
    load,
    select,
    updateNode,
    updateEdge,
    undo: undoEdit,
    redo: redoEdit,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  }
}

// 同一個 task 裡的刪除算同一步：React Flow 刪 Node 時先送相連 Edge 的 remove、再送 Node 的 remove，是兩次呼叫
function useRemoveGroup() {
  const batch = useRef({ id: 0, open: false })
  return useCallback(() => {
    const current = batch.current
    if (!current.open) {
      current.open = true
      current.id++
      queueMicrotask(() => {
        current.open = false
      })
    }
    return `remove:${current.id}`
  }, [])
}

function isRemove(change: NodeChange | EdgeChange): boolean {
  return change.type === 'remove'
}

// 刪除、移動節點算一步（新增節點走 addNode）；選取和量尺寸不算。
// 拖動時 React Flow 每一幀都送 dragging 的位置，只在開始拖（節點還沒在拖）時記一步，中途和放開都不算
function isNodeEdit(changes: NodeChange<SimFlowNode>[], nodes: SimFlowNode[]): boolean {
  return changes.some((change) => {
    if (change.type !== 'position') {
      return change.type === 'remove'
    }
    return change.position != null && !nodes.find((n) => n.id === change.id)?.dragging
  })
}

// 用方向鍵移動（不是拖動）時，按住不放併成一步
function moveGroup(changes: NodeChange<SimFlowNode>[]): string | null {
  const moved = changes.flatMap((change) => (change.type === 'position' && !change.dragging ? [change.id] : []))
  return moved.length > 0 ? `move:${moved.join(',')}` : null
}

// patch 裡有給的欄位都和 current 相同
function sameValues(current: object, patch: object): boolean {
  const values = current as Record<string, unknown>
  return Object.entries(patch).every(([field, value]) => value === undefined || Object.is(values[field], value))
}

// 同一個元素的同一組欄位才併成一步
function fieldGroup(target: string, patch: object): string {
  const fields = Object.entries(patch).flatMap(([field, value]) => (value === undefined ? [] : [field]))
  return `${target}:${fields.sort().join(',')}`
}

function toCanvasState(topology: Topology): CanvasState {
  return { nodes: topology.nodes.map(toFlowNode), edges: topology.edges.map(toFlowEdge) }
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
    markerEnd: arrowMarker(),
    data: { edge },
  }
}
