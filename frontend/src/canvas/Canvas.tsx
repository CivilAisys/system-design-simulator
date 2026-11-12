import { useMemo } from 'react'
import { Background, Controls, MarkerType, ReactFlow, type ColorMode } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { SimulationResult, Topology } from '@/api/client'
import { SimNode, type SimFlowNode } from './SimNode'
import { RpsEdge, type RpsFlowEdge } from './RpsEdge'

const nodeTypes = { sim: SimNode }
const edgeTypes = { rps: RpsEdge }

type CanvasProps = {
  topology: Topology
  result: SimulationResult | null
  colorMode: ColorMode
}

export function Canvas({ topology, result, colorMode }: CanvasProps) {
  const nodes = useMemo<SimFlowNode[]>(
    () =>
      topology.nodes.map((node) => ({
        id: node.id,
        type: 'sim',
        position: node.ui ?? { x: 0, y: 0 },
        data: { node, result: result?.nodes[node.id] },
      })),
    [topology, result],
  )

  const edges = useMemo<RpsFlowEdge[]>(
    () =>
      topology.edges.map((edge) => ({
        id: edge.id,
        type: 'rps',
        source: edge.source,
        target: edge.target,
        markerEnd: { type: MarkerType.ArrowClosed },
        data: { result: result?.edges[edge.id] },
      })),
    [topology, result],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      colorMode={colorMode}
      fitView
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
