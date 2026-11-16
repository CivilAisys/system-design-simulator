import { useMemo, type DragEvent } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  useReactFlow,
  type ColorMode,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { totalRps, type Edge, type NodeType, type SimulationResult } from '@/api/client'
import { NODE_KINDS, PALETTE, type PaletteItem } from './catalog'
import { SimNode, type SimFlowNode } from './SimNode'
import { arrowMarker, edgeColor } from './edgeStyle'
import { RpsEdge, type RpsFlowEdge } from './RpsEdge'
import { flowRatio } from './flow'
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
  colorMode: ColorMode
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
  colorMode,
  onNodesChange,
  onEdgesChange,
  onConnect,
  isValidConnection,
  onAddNode,
}: CanvasProps) {
  const { screenToFlowPosition } = useReactFlow()

  // 結果和驗證錯誤只在畫的時候疊上去，不寫進編輯狀態
  const errors = useMemo(() => groupErrors(result?.errors ?? []), [result])
  // 邊的粗細和粒子以畫布上最大的邊 RPS 為基準。只看目前還在的邊：結果過期時可能有已經刪掉的邊
  const maxRps = useMemo(
    () => Math.max(0, ...edges.map((e) => result?.edges[e.id]).map((r) => (r ? totalRps(r.rps) : 0))),
    [edges, result],
  )
  const shownNodes = useMemo<SimFlowNode[]>(
    () =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, result: result?.nodes[n.id], errors: errors.nodes.get(n.id), stale },
      })),
    [nodes, result, errors, stale],
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
            flow: edgeResult && flowRatio(totalRps(edgeResult.rps), maxRps),
            errors: edgeErrors,
            stale,
          },
        }
      }),
    [edges, typeById, result, maxRps, errors, stale],
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
      colorMode={colorMode}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
    </ReactFlow>
  )
}

// requestClass 只對 Service 的出邊有作用（spec 3.4），其他邊上的值計算時忽略，不顯示
function classTag(sourceType: NodeType, edge: Edge): 'R' | 'W' | undefined {
  if (!NODE_KINDS[sourceType].edgeChoiceParams.includes('requestClass')) return undefined
  return edge.requestClass === 'READ' ? 'R' : edge.requestClass === 'WRITE' ? 'W' : undefined
}
