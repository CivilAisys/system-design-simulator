import { Handle, Position, type NodeProps, type Node as FlowNode } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { Node, NodeResult } from '@/api/client'
import { NODE_KINDS } from './catalog'
import { formatRps, formatUtilization } from './format'
import { ShardGrid } from './ShardGrid'
import { STATUS_FILL, STATUS_GLOW, STATUS_LABEL, STATUS_TEXT, WARNING_LABEL, WARNING_TITLE } from './status'
import { errorsTitle } from './validation'

export type SimNodeData = {
  node: Node
  result?: NodeResult
  // 這個節點的驗證錯誤訊息
  errors?: string[]
  // 拓撲在上次 Run 之後改過，結果和錯誤可能已經不準
  stale?: boolean
  // Read Replica 沒有自己的 shards，沿用 primary 的（spec 4.2.3），Canvas 從連過來的 Database 算
  mirroredShards?: number
}

export type SimFlowNode = FlowNode<SimNodeData, 'sim'>

export function SimNode({ data, selected }: NodeProps<SimFlowNode>) {
  const { node, result, errors, stale, mirroredShards } = data
  const { icon: Icon, hasInput, hasOutput, nodeMetric } = NODE_KINDS[node.type]
  // status 為 null（Client）時不變色
  const status = result?.status ?? null
  const shards = node.params.shards ?? mirroredShards ?? 1

  return (
    <div
      title={errors && errorsTitle(errors, stale)}
      className={cn(
        'relative min-w-36 rounded-card border border-input bg-card px-3 py-2.5 text-card-foreground shadow-(--node-shadow)',
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
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-[13px] font-semibold">{node.name}</span>
      </div>
      {result && (
        <div className="mt-1 flex items-center justify-between gap-3 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {status && <span aria-hidden className={cn('size-2 rounded-full', STATUS_FILL[status])} />}
            {nodeMetric === 'rejected'
              ? `拒絕 ${formatRps(result.rejectedRps)}`
              : `ρ ${formatUtilization(result.utilization)}`}
          </span>
          {status && <span className={cn('font-semibold', STATUS_TEXT[status])}>{STATUS_LABEL[status]}</span>}
        </div>
      )}
      {result?.warnings.map((warning) => (
        <p key={warning} className="mt-1 text-xs font-semibold text-critical-ink" title={WARNING_TITLE[warning]}>
          ⚠ {WARNING_LABEL[warning]}
        </p>
      ))}
      {shards > 1 && <ShardGrid count={shards} shards={result?.shards} stale={stale} />}
      {hasOutput && <Handle type="source" position={Position.Right} />}
    </div>
  )
}
