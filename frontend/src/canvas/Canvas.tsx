import { useMemo, type DragEvent } from 'react'
import {
  Controls,
  ReactFlow,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import { type Edge, type NodeType, type SimulationResult } from '@/api/client'
import { NODE_KINDS, PALETTE, type PaletteItem } from './catalog'
import { congestionOf } from './congestion'
import { IsoGrid } from './IsoGrid'
import { SimNode, type SimFlowNode } from './SimNode'
import { arrowMarker, edgeColor } from './edgeStyle'
import { RpsEdge, type RpsFlowEdge } from './RpsEdge'
import { unconnectedNodeIds } from './graph'
import { groupErrors } from './validation'

const nodeTypes = { sim: SimNode }
const edgeTypes = { rps: RpsEdge }

// 元件面板拖出來的 dataTransfer 格式，值是 PaletteItem 的 id
export const PALETTE_ITEM_MIME = 'application/x-sim-palette-item'

type CanvasProps = {
  nodes: SimFlowNode[]
  edges: RpsFlowEdge[]
  result: SimulationResult | null
  // 拓撲在上次 Run 之後改過
  stale: boolean
  onNodesChange: (changes: NodeChange<SimFlowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<RpsFlowEdge>[]) => void
  onConnect: (connection: Connection) => void
  isValidConnection: (connection: Connection | RpsFlowEdge) => boolean
  onAddNode: (item: PaletteItem, position: { x: number; y: number }) => void
}

export function Canvas({
  nodes,
  edges,
  result,
  stale,
  onNodesChange,
  onEdgesChange,
  onConnect,
  isValidConnection,
  onAddNode,
}: CanvasProps) {
  const { screenToFlowPosition } = useReactFlow()

  // 結果和驗證錯誤只在畫的時候疊上去，不寫進編輯狀態
  const errors = useMemo(() => groupErrors(result?.errors ?? []), [result])
  // 未連線看畫布就知道，不必等 Run；Auto-run 關閉或結果有驗證錯誤時也立即畫淡
  const unconnected = useMemo(() => unconnectedNodeIds(nodes.map((n) => n.data.node), edges), [nodes, edges])
  const shownNodes = useMemo<SimFlowNode[]>(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          result: result?.nodes[n.id],
          errors: errors.nodes.get(n.id),
          stale,
          unconnected: unconnected.has(n.id),
        },
      })),
    [nodes, result, errors, stale, unconnected],
  )
  // 邊的種類看 source 的 type。拖動節點時 nodes 每一幀都在變，只在 id 或 type 變了才重算，邊不用跟著重畫
  const typeKey = JSON.stringify(nodes.map((n) => [n.id, n.data.node.type]))
  const typeById = useMemo(() => new Map<string, NodeType>(JSON.parse(typeKey)), [typeKey])
  const shownEdges = useMemo<RpsFlowEdge[]>(
    () =>
      edges.map((e) => {
        const sourceType = typeById.get(e.source)
        const edgeResult = result?.edges[e.id]
        const edgeErrors = errors.edges.get(e.id)
        return {
          ...e,
          markerEnd: arrowMarker(edgeColor(e.selected, edgeErrors != null)),
          data: {
            ...e.data,
            kind: sourceType && NODE_KINDS[sourceType].outputEdgeKind,
            classTag: sourceType && classTag(sourceType, e.data.edge),
            result: edgeResult,
            errors: edgeErrors,
            stale,
            congestion: congestionOf(e.source, e.target, result?.nodes),
          },
        }
      }),
    [edges, typeById, result, errors, stale],
  )

  function onDragOver(event: DragEvent) {
    if (event.dataTransfer.types.includes(PALETTE_ITEM_MIME)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  function onDrop(event: DragEvent) {
    const id = event.dataTransfer.getData(PALETTE_ITEM_MIME)
    const item = PALETTE.find((candidate) => candidate.id === id)
    if (!item) {
      return
    }
    event.preventDefault()
    onAddNode(item, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
  }

  return (
    <ReactFlow
      nodes={shownNodes}
      edges={shownEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onDragOver={onDragOver}
      onDrop={onDrop}
      deleteKeyCode={['Backspace', 'Delete']}
      fitView
      // 預設 0.5 太大，節點離很遠時 fit view 框不住全部
      minZoom={0.1}
      proOptions={{ hideAttribution: true }}
    >
      <IsoGrid />
      <Controls orientation="horizontal" />
    </ReactFlow>
  )
}

// requestClass 只對 Service 的出邊有作用（spec 3.4），其他邊上的值計算時忽略，不顯示
function classTag(sourceType: NodeType, edge: Edge): 'R' | 'W' | undefined {
  if (!NODE_KINDS[sourceType].edgeChoiceParams.includes('requestClass')) return undefined
  return edge.requestClass === 'READ' ? 'R' : edge.requestClass === 'WRITE' ? 'W' : undefined
}
