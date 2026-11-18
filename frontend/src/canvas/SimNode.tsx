import { Handle, Position, type NodeProps, type Node as FlowNode } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { Node, NodeResult } from '@/api/client'
import { NODE_KINDS } from './catalog'
import { CATEGORY_DOT } from './category'
import { CategoryIcon } from './CategoryIcon'
import { formatRps, formatUtilization } from './format'
import { hotSpotTitle, instanceRack, rackSlotStatuses } from './instanceRack'
import { Rack } from './Rack'
import { STATUS_FILL, STATUS_GLOW, STATUS_LABEL, STATUS_TEXT, WARNING_LABEL, WARNING_TITLE } from './status'
import { errorsTitle } from './validation'

export type SimNodeData = {
  node: Node
  result?: NodeResult
  // 這個節點的驗證錯誤訊息
  errors?: string[]
  // 拓撲在上次 Run 之後改過，結果和錯誤可能已經不準
  stale?: boolean
}

export type SimFlowNode = FlowNode<SimNodeData, 'sim'>

export function SimNode({ data, selected }: NodeProps<SimFlowNode>) {
  const { node, result, errors, stale } = data
  const { icon, category, hasInput, hasOutput, nodeMetric } = NODE_KINDS[node.type]
  // status 為 null（Client）時不變色
  const status = result?.status ?? null
  const rack = instanceRack(node)

  return (
    <div
      title={errors && errorsTitle(errors, stale)}
      className={cn(
        'relative min-w-36 rounded-card border border-input bg-card px-3 py-2.5 text-card-foreground',
        // 沒有上游的節點（Client）是流量的來源，不是機器：虛線外框、沒有陰影
        hasInput ? 'shadow-(--node-shadow)' : 'border-dashed',
        // 選取用強調色的外圈，和狀態色的外框、光暈分開
        selected && 'outline-2 outline-offset-6 outline-primary',
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
          <div className="text-[13px] font-semibold">{node.name}</div>
          {result && (
            <div className="mt-0.5 flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {status && <span aria-hidden className={cn('size-2 rounded-full', STATUS_FILL[status])} />}
                {nodeMetric === 'rejected'
                  ? `拒絕 ${formatRps(result.rejectedRps)}`
                  : `ρ ${formatUtilization(result.utilization)}`}
              </span>
              {status && <span className={cn('font-semibold', STATUS_TEXT[status])}>{STATUS_LABEL[status]}</span>}
            </div>
          )}
        </div>
        {rack && (
          <Rack
            slots={rackSlotStatuses(rack, status, result?.hotSpot)}
            title={hotSpotTitle(result?.hotSpot, node.params.instances ?? 1)}
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
