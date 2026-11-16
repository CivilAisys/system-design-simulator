import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge as FlowEdge,
} from '@xyflow/react'
import { totalRps, type Edge, type EdgeResult } from '@/api/client'
import { cn } from '@/lib/utils'
import type { EdgeKind } from './catalog'
import { edgeStyle } from './edgeStyle'
import { particles } from './flow'
import { formatBytesPerSec, formatRps } from './format'

export type RpsEdgeData = {
  edge: Edge
  // 依 source 的 type 決定，畫的時候才算（Canvas）；沒有時當成同步
  kind?: EdgeKind
  // 只給 READ／WRITE 其中一個 class 走的邊顯示「R」／「W」，requestClass 沒有作用的邊沒有（Canvas 算）
  classTag?: 'R' | 'W'
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
  const { kind = 'SYNC', classTag, result, flow, errors, stale } = data
  // 過期的結果不播動畫：流量可能已經不是這樣
  const moving = flow != null && !stale ? particles(flow) : null

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={edgeStyle(selected, flow, errors, stale, kind)} />
      {/* begin 為負值讓粒子一開始就平均分布在線上，而不是從起點一個個出發。
          系統設定減少動態效果時隱藏（SVG 動畫不受 CSS animation 控制） */}
      {moving &&
        Array.from({ length: moving.count }, (_, i) => (
          <circle
            key={i}
            r={3.5}
            className="pointer-events-none fill-(--flow-particle) [filter:var(--flow-particle-glow)] motion-reduce:hidden"
          >
            <animateMotion
              dur={`${moving.durationS}s`}
              begin={`${(-i * moving.durationS) / moving.count}s`}
              repeatCount="indefinite"
              path={path}
            />
          </circle>
        ))}
      {(result || classTag) && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              'nodrag nopan pointer-events-none absolute border border-input bg-card px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-secondary-foreground',
              // 只有一行時是膠囊，多了積壓、頻寬的第二行就改成圓角矩形
              result?.backlogRps || result?.bandwidth ? 'rounded-xl' : 'rounded-full',
              stale && 'opacity-50',
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {classTag && <span className={cn('font-bold text-foreground', result && 'mr-1')}>{classTag}</span>}
            {result && formatRps(totalRps(result.rps))}
            {/* 沒有處理成功的訊息：queue 每秒增加的筆數。放第二行，不拉長標籤 */}
            {result && result.backlogRps > 0 && (
              <div className="text-critical-ink">積壓 +{formatRps(result.backlogRps)}/s</div>
            )}
            {/* 只有 Client 的邊有：使用者端頻寬（spec 4.7） */}
            {result?.bandwidth && (
              <div className="text-[10px] font-medium text-muted-foreground">
                出 {formatBytesPerSec(result.bandwidth.egressBytesPerSec)}・入{' '}
                {formatBytesPerSec(result.bandwidth.ingressBytesPerSec)}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
