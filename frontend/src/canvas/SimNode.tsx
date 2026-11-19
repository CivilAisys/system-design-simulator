import { Handle, Position, type NodeProps, type Node as FlowNode } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { Node, NodeResult } from '@/api/client'
import { NODE_KINDS } from './catalog'
import { CATEGORY_DOT } from './category'
import { CategoryIcon } from './CategoryIcon'
import { formatRps, formatUtilization } from './format'
import { hotSpotTitle, instanceRack, rackSlotStatuses, replicaLabel } from './instanceRack'
import { Rack } from './Rack'
import {
  displayStatus,
  isIdle,
  STATUS_FILL,
  STATUS_GLOW,
  STATUS_LABEL,
  STATUS_TEXT,
  WARNING_LABEL,
  WARNING_TITLE,
} from './status'
import { errorsTitle } from './validation'

export type SimNodeData = {
  node: Node
  result?: NodeResult
  // 這個節點的驗證錯誤訊息
  errors?: string[]
  // 拓撲在上次 Run 之後改過，結果和錯誤可能已經不準
  stale?: boolean
  // 沒有任何邊，不在拓撲裡（見 unconnectedNodeIds）
  unconnected?: boolean
}

export type SimFlowNode = FlowNode<SimNodeData, 'sim'>

export function SimNode({ data, selected }: NodeProps<SimFlowNode>) {
  const { node, result, errors, stale, unconnected } = data
  const { icon, category, hasInput, hasOutput, nodeMetric } = NODE_KINDS[node.type]
  // status 為 null（Client）時不變色
  const status = displayStatus(result, unconnected ?? false)
  // 沒有流量時熱點的數字都是 0，不分顏色也不提示
  const hotSpot = isIdle(status) ? undefined : result?.hotSpot
  const rack = instanceRack(node)
  const replicas = replicaLabel(node)
  const errorText = errors && errorsTitle(errors, stale)

  return (
    <div
      title={errorText}
      className={cn(
        'relative max-w-64 min-w-36 rounded-card border border-input bg-card px-3 py-2.5 text-card-foreground',
        // 沒有上游的節點（Client）是流量的來源，不是機器：虛線外框、沒有陰影
        hasInput ? 'shadow-(--node-shadow)' : 'border-dashed',
        // 選取用強調色的外圈，和狀態色的外框、光暈分開
        selected && 'outline-2 outline-offset-6 outline-primary',
        // 未連線的節點不在拓撲裡：整個畫淡、灰色虛線外框，選取或滑過時恢復，方便編輯。
        // 有驗證錯誤（例如參數超出範圍）時不畫淡，紅框才看得清楚
        unconnected && 'border-dashed border-muted-foreground/60 transition-opacity',
        unconnected && !selected && !errors && 'opacity-40 hover:opacity-100',
      )}
    >
      {/* 外框和光暈單獨一層，過載脈動時只有光暈閃，文字不跟著閃。
          驗證失敗時沒有計算結果，不會同時有狀態色。過期時畫淡、不脈動 */}
      {(errors || status) && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-px rounded-card',
            errors ? 'ring-2 ring-destructive shadow-lg shadow-destructive/40' : status && STATUS_GLOW[status],
            stale
              ? 'opacity-30'
              : !errors && status === 'OVERLOADED' && 'animate-glow-pulse motion-reduce:animate-none',
          )}
        />
      )}
      {hasInput && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-2.5">
        <CategoryIcon icon={icon} category={category} />
        <div className="min-w-0 flex-1">
          {/* 寬度有上限，長名稱截成一行，完整名稱放在 title（節點可能很多，不用 shadcn tooltip）。
              滑過名稱時看不到外層的錯誤說明，所以一起放進來 */}
          <div
            className="truncate text-[13px] font-semibold"
            title={errorText ? `${node.name}\n${errorText}` : node.name}
          >
            {node.name}
          </div>
          {replicas && <div className="text-[11px] text-muted-foreground">{replicas}</div>}
          {(result || unconnected) && (
            <div className="mt-0.5 flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {status && <span aria-hidden className={cn('size-2 rounded-full', STATUS_FILL[status])} />}
                {/* 未連線沒有流量可看，不列 ρ */}
                {result &&
                  !unconnected &&
                  (nodeMetric === 'rejected'
                    ? `拒絕 ${formatRps(result.rejectedRps)}`
                    : `ρ ${formatUtilization(result.utilization)}`)}
              </span>
              {status && <span className={cn('font-semibold', STATUS_TEXT[status])}>{STATUS_LABEL[status]}</span>}
            </div>
          )}
        </div>
        {rack && (
          <Rack
            slots={rackSlotStatuses(rack, status, hotSpot)}
            title={hotSpotTitle(rack, hotSpot, stale)}
            stale={stale}
          />
        )}
      </div>
      {result?.warnings.map((warning) => (
        <p key={warning} className="mt-1 text-xs font-semibold text-critical-ink" title={WARNING_TITLE[warning]}>
          ⚠ {WARNING_LABEL[warning]}
        </p>
      ))}
      {/* 畫在狀態外框之後，不被外框蓋住 */}
      {rack && (
        <span
          className={cn(
            'pointer-events-none absolute -top-2.5 -right-2.5 rounded-full border-2 border-canvas px-1.75 py-px text-[11px] font-bold text-card',
            CATEGORY_DOT[category],
          )}
        >
          {rack.label}
        </span>
      )}
      {hasOutput && <Handle type="source" position={Position.Right} />}
    </div>
  )
}
