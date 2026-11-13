import { Handle, Position, type NodeProps, type Node as FlowNode } from '@xyflow/react'
import { cn } from '@/lib/utils'
import type { Node, NodeResult } from '@/api/client'
import { hasInput, hasOutput, NODE_KINDS } from './catalog'
import { formatUtilization } from './format'
import { STATUS_RING, STATUS_TEXT } from './status'

export type SimNodeData = {
  node: Node
  result?: NodeResult
}

export type SimFlowNode = FlowNode<SimNodeData, 'sim'>

export function SimNode({ data, selected }: NodeProps<SimFlowNode>) {
  const { node, result } = data
  const Icon = NODE_KINDS[node.type].icon
  // status 為 null（Client）時不變色
  const status = result?.status ?? null

  return (
    <div
      className={cn(
        'min-w-36 rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm',
        status && STATUS_RING[status],
        selected && 'border-primary',
      )}
    >
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
