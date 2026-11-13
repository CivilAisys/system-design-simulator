import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge as FlowEdge,
} from '@xyflow/react'
import { totalRps, type Edge, type EdgeResult } from '@/api/client'
import { cn } from '@/lib/utils'
import { edgeStyle } from './edgeStyle'
import { particles } from './flow'
import { formatRps } from './format'

export type RpsEdgeData = {
  edge: Edge
  result?: EdgeResult
  // 這條邊的 RPS / 整張圖最大的邊 RPS（0..1），有計算結果時才有
  flow?: number
  // 這條邊的驗證錯誤訊息
  errors?: string[]
  // 拓撲在上次 Run 之後改過，結果可能不準
  stale?: boolean
}

// React Flow 的 edge.data 是選填，這裡一定有對應的 Edge
export type RpsFlowEdge = FlowEdge<RpsEdgeData, 'rps'> & { data: RpsEdgeData }

export function RpsEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps<RpsFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const { result, flow, errors, stale } = data
  // 過期的結果不播動畫：流量可能已經不是這樣
  const moving = flow != null && !stale ? particles(flow) : null

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={edgeStyle(selected, flow, errors, stale)} />
      {/* begin 為負值讓粒子一開始就平均分布在線上，而不是從起點一個個出發。
          系統設定減少動態效果時隱藏（SVG 動畫不受 CSS animation 控制） */}
      {moving &&
        Array.from({ length: moving.count }, (_, i) => (
          <circle key={i} r={3} className="pointer-events-none fill-(--flow-particle) motion-reduce:hidden">
            <animateMotion
              dur={`${moving.durationS}s`}
              begin={`${(-i * moving.durationS) / moving.count}s`}
              repeatCount="indefinite"
              path={path}
            />
          </circle>
        ))}
      {result && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              'nodrag nopan pointer-events-none absolute rounded bg-background/80 px-1.5 py-0.5 text-xs text-foreground',
              stale && 'opacity-50',
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {formatRps(totalRps(result.rps))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
