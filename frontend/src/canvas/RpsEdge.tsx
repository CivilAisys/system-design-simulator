import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge as FlowEdge,
} from '@xyflow/react'
import type { EdgeResult } from '@/api/client'
import { formatRps } from './format'

export type RpsEdgeData = {
  result?: EdgeResult
}

export type RpsFlowEdge = FlowEdge<RpsEdgeData, 'rps'>

export function RpsEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<RpsFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const rps = data?.result?.rps

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} />
      {rps && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded bg-background/80 px-1.5 py-0.5 text-xs text-foreground"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {formatRps(rps.read + rps.write)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
