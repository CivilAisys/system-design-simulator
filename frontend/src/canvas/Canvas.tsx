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
import type { NodeType, SimulationResult } from '@/api/client'
import { NODE_KINDS } from './catalog'
import { SimNode, type SimFlowNode } from './SimNode'
import { RpsEdge, type RpsFlowEdge } from './RpsEdge'

const nodeTypes = { sim: SimNode }
const edgeTypes = { rps: RpsEdge }

// 元件面板拖出來的 dataTransfer 格式，值是 NodeType
export const NODE_TYPE_MIME = 'application/x-sim-node-type'

type CanvasProps = {
  nodes: SimFlowNode[]
  edges: RpsFlowEdge[]
  result: SimulationResult | null
  colorMode: ColorMode
  onNodesChange: (changes: NodeChange<SimFlowNode>[]) => void
  onEdgesChange: (changes: EdgeChange<RpsFlowEdge>[]) => void
  onConnect: (connection: Connection) => void
  isValidConnection: (connection: Connection | RpsFlowEdge) => boolean
  onAddNode: (type: NodeType, position: { x: number; y: number }) => void
}

export function Canvas({
  nodes,
  edges,
  result,
  colorMode,
  onNodesChange,
  onEdgesChange,
  onConnect,
  isValidConnection,
  onAddNode,
}: CanvasProps) {
  const { screenToFlowPosition } = useReactFlow()

  // 結果只在畫的時候疊上去，不寫進編輯狀態
  const shownNodes = useMemo<SimFlowNode[]>(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, result: result?.nodes[n.id] } })),
    [nodes, result],
  )
  const shownEdges = useMemo<RpsFlowEdge[]>(
    () => edges.map((e) => ({ ...e, data: { ...e.data, result: result?.edges[e.id] } })),
    [edges, result],
  )

  function onDragOver(event: DragEvent) {
    if (event.dataTransfer.types.includes(NODE_TYPE_MIME)) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  function onDrop(event: DragEvent) {
    const type = event.dataTransfer.getData(NODE_TYPE_MIME)
    if (!Object.hasOwn(NODE_KINDS, type)) {
      return
    }
    event.preventDefault()
    onAddNode(type as NodeType, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
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
