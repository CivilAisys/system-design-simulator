import { Handle, Position, type NodeProps, type Node as FlowNode } from '@xyflow/react'
import { Database, Server, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Node, NodeResult, NodeType, Status } from '@/api/client'
import { formatUtilization } from './format'

export type SimNodeData = {
  node: Node
  result?: NodeResult
}

export type SimFlowNode = FlowNode<SimNodeData, 'sim'>

const ICONS: Record<NodeType, LucideIcon> = {
  CLIENT: Users,
  SERVICE: Server,
  DATABASE: Database,
}

// 第 4.4 節的狀態色，用 ring 和光暈疊在 bg-card 上，不改底色
const STATUS_CLASSES: Record<Status, string> = {
  OK: 'ring-2 ring-emerald-500 shadow-lg shadow-emerald-500/40',
  WARN: 'ring-2 ring-yellow-500 shadow-lg shadow-yellow-500/40',
  CRITICAL: 'ring-2 ring-orange-500 shadow-lg shadow-orange-500/40',
  OVERLOADED: 'ring-2 ring-red-500 shadow-lg shadow-red-500/40',
}

const STATUS_TEXT: Record<Status, string> = {
  OK: 'text-emerald-500',
  WARN: 'text-yellow-500',
  CRITICAL: 'text-orange-500',
  OVERLOADED: 'text-red-500',
}

export function SimNode({ data }: NodeProps<SimFlowNode>) {
  const { node, result } = data
  const Icon = ICONS[node.type]
  // status 為 null（Client）時不變色
  const status = result?.status ?? null

  return (
    <div
      className={cn(
        'min-w-36 rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm',
        status && STATUS_CLASSES[status],
      )}
    >
      {node.type !== 'CLIENT' && <Handle type="target" position={Position.Left} />}
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
      {node.type !== 'DATABASE' && <Handle type="source" position={Position.Right} />}
    </div>
  )
}
