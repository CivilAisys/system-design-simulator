import { Handle, Position, type NodeProps, type Node as FlowNode } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { Node, NodeResult } from '@/api/client'
import { hasInput, hasOutput, NODE_KINDS } from './catalog'
import { formatUtilization } from './format'
import { STATUS_GLOW, STATUS_TEXT } from './status'
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
  const Icon = NODE_KINDS[node.type].icon
  // status 為 null（Client）時不變色
  const status = result?.status ?? null

  return (
    <div
      title={errors && errorsTitle(errors, stale)}
      className={cn(
        'relative min-w-36 rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm',
        selected && 'border-primary',
      )}
    >
      {/* 外框和光暈單獨一層，過載脈動時只有光暈閃，文字不跟著閃。
          驗證失敗時沒有計算結果，不會同時有狀態色。過期時畫淡、不脈動 */}
      {(errors || status) && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-px rounded-lg',
            errors ? 'ring-2 ring-destructive shadow-lg shadow-destructive/40' : status && STATUS_GLOW[status],
            stale
              ? 'opacity-30'
              : !errors && status === 'OVERLOADED' && 'animate-glow-pulse motion-reduce:animate-none',
          )}
        />
      )}
      {hasInput(node.type) && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{node.name}</span>
      </div>
      {result && (
        <div className="mt-1 flex items-baseline justify-between gap-3 text-xs">
          <span className="text-muted-foreground">ρ {formatUtilization(result.utilization)}</span>
          {status && <span className={cn('font-semibold', STATUS_TEXT[status])}>{status}</span>}
        </div>
      )}
      {hasOutput(node.type) && <Handle type="source" position={Position.Right} />}
    </div>
  )
}
