import { Fragment, useId, type ReactNode } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import type { NodeResult } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { NODE_KINDS, shownShards } from './catalog'
import { CategoryIcon } from './CategoryIcon'
import { formatUtilization } from './format'
import { workersHint } from './instanceStack'
import { NumberField } from './NumberField'
import {
  checkNodeParam,
  EDGE_CHOICE_SPECS,
  EDGE_PARAM_SPECS,
  formatShare,
  NODE_CHOICE_SPECS,
  NODE_PARAM_SPECS,
  nodeParam,
  type ChoiceSpec,
} from './params'
import type { SimFlowNode } from './SimNode'
import { STATUS_BADGE, STATUS_FILL, STATUS_TEXT } from './status'
import type { RpsFlowEdge } from './RpsEdge'
import type { EdgePatch, NodePatch } from './useTopologyEditor'

type PropertiesPanelProps = {
  nodes: SimFlowNode[]
  edges: RpsFlowEdge[]
  nodeResults: Record<string, NodeResult> | undefined
  onUpdateNode: (id: string, patch: NodePatch) => void
  onUpdateEdge: (id: string, patch: EdgePatch) => void
}

// 只在剛好選了一個 Node 或一條 Edge 時顯示它的參數
export function PropertiesPanel({ nodes, edges, nodeResults, onUpdateNode, onUpdateEdge }: PropertiesPanelProps) {
  const selectedNodes = nodes.filter((n) => n.selected)
  const selectedEdges = edges.filter((e) => e.selected)

  let content
  if (selectedNodes.length === 1 && selectedEdges.length === 0) {
    const node = selectedNodes[0]
    // key：換選取時重建，輸入框裡打到一半的字不會帶到別的節點
    content = (
      <NodeProperties key={node.id} node={node} result={nodeResults?.[node.id]} onUpdate={onUpdateNode} />
    )
  } else if (selectedEdges.length === 1 && selectedNodes.length === 0) {
    const edge = selectedEdges[0]
    content = <EdgeProperties key={edge.id} edge={edge} nodes={nodes} onUpdate={onUpdateEdge} />
  } else {
    content = <p className="text-sm text-muted-foreground">選取一個元件或連線來調整參數。</p>
  }

  return (
    <aside aria-label="屬性" className="w-72 shrink-0 overflow-y-auto border-l p-4">
      {content}
    </aside>
  )
}

// 按「設定磁碟容量」時先填的值
const NEW_DISK_GB = 1000

type NodePropertiesProps = {
  node: SimFlowNode
  result: NodeResult | undefined
  onUpdate: (id: string, patch: NodePatch) => void
}

function NodeProperties({ node: flowNode, result, onUpdate }: NodePropertiesProps) {
  const nameId = useId()
  const node = flowNode.data.node
  const { label, icon, category, numberParams, choiceParams } = NODE_KINDS[node.type]
  const utilization = result?.utilization ?? null
  const status = result?.status ?? null

  // 分片時才有熱點：省略時平均分配，顯示平均值；改了之後就是明確的占比。緊接在 shards 後面顯示
  const hotShareField = (node.params.shards ?? 1) > 1 && (
    <div className="grid gap-1">
      <NumberField
        spec={NODE_PARAM_SPECS.hotShardShare}
        value={node.params.hotShardShare ?? 1 / (node.params.shards ?? 1)}
        check={(value) => checkNodeParam(node.params, 'hotShardShare', value)}
        onChange={(value) => onUpdate(node.id, { params: { hotShardShare: value } })}
      />
      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>
          最熱的 shard 分到的流量比例，平均是 1/{node.params.shards}（{formatShare(1 / (node.params.shards ?? 1))}）
        </span>
        {/* 設定過占比之後，shard 數改了也不會跟著變；改回平均就會跟著 1/N 走 */}
        {node.params.hotShardShare !== undefined && (
          <Button
            variant="link"
            size="sm"
            className="h-auto shrink-0 p-0 text-xs"
            onClick={() => onUpdate(node.id, { clearParams: ['hotShardShare'] })}
          >
            改回平均
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <div className="grid gap-4">
      <PanelHeader title={label} icon={<CategoryIcon icon={icon} category={category} />} nodeId={node.id} />
      <div className="grid gap-1.5">
        <Label htmlFor={nameId}>名稱</Label>
        <Input id={nameId} value={node.name} onChange={(event) => onUpdate(node.id, { name: event.target.value })} />
      </div>
      {numberParams.map((param) => (
        <Fragment key={param}>
          <NumberField
            spec={NODE_PARAM_SPECS[param]}
            value={nodeParam(node.params, param)}
            check={(value) => checkNodeParam(node.params, param, value)}
            onChange={(value) => onUpdate(node.id, { params: { [param]: value } })}
          />
          {param === 'shards' && hotShareField}
          {param === 'instances' && (
            <p className="-mt-3 text-xs text-muted-foreground">
              {workersHint(
                nodeParam(node.params, 'instances'),
                nodeParam(node.params, 'concurrency'),
                shownShards(node, flowNode.data.mirroredShards),
              )}
            </p>
          )}
        </Fragment>
      ))}
      {/* 磁碟容量選填：沒設定時不估算磁碟幾天後會滿（spec 4.8） */}
      {numberParams.includes('retentionDays') &&
        (node.params.diskGbPerShard === undefined ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto justify-start p-0 text-xs"
            onClick={() => onUpdate(node.id, { params: { diskGbPerShard: NEW_DISK_GB } })}
          >
            設定磁碟容量，估算幾天後會滿
          </Button>
        ) : (
          <div className="grid gap-1">
            <NumberField
              spec={NODE_PARAM_SPECS.diskGbPerShard}
              value={node.params.diskGbPerShard}
              check={(value) => checkNodeParam(node.params, 'diskGbPerShard', value)}
              onChange={(value) => onUpdate(node.id, { params: { diskGbPerShard: value } })}
            />
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span>每個 shard 的磁碟容量</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto shrink-0 p-0 text-xs"
                onClick={() => onUpdate(node.id, { clearParams: ['diskGbPerShard'] })}
              >
                不估算
              </Button>
            </div>
          </div>
        ))}
      {choiceParams.map((param) => (
        <ChoiceField
          key={param}
          spec={NODE_CHOICE_SPECS[param]}
          value={node.params[param]}
          onChange={(value) => onUpdate(node.id, { params: { [param]: value } })}
        />
      ))}
      {/* Client 沒有容量，ρ 不適用；Run 之前也還沒有值 */}
      {utilization !== null && (
        // 底色跟著狀態（STATUS_BADGE 的淡底和深色文字）
        <div className={cn('grid gap-2.5 rounded-xl bg-muted p-3.5', status && STATUS_BADGE[status])}>
          <div className="flex items-baseline justify-between text-sm">
            <span>ρ</span>
            <span className={cn('font-heading text-[22px] font-bold', status && STATUS_TEXT[status])}>
              {formatUtilization(utilization)}
            </span>
          </div>
          <Progress
            value={Math.min(utilization, 1) * 100}
            aria-label="ρ"
            indicatorClassName={status ? STATUS_FILL[status] : undefined}
          />
        </div>
      )}
    </div>
  )
}

type ChoiceFieldProps<V extends string> = {
  spec: ChoiceSpec<V>
  value: V | undefined
  onChange: (value: V) => void
}

function ChoiceField<V extends string>({ spec, value, onChange }: ChoiceFieldProps<V>) {
  const { label, options } = spec
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Select
        value={value}
        // 選項只有 options 裡的值
        onValueChange={(selected) => onChange(selected as V)}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

type EdgePropertiesProps = {
  edge: RpsFlowEdge
  nodes: SimFlowNode[]
  onUpdate: (id: string, patch: EdgePatch) => void
}

function EdgeProperties({ edge: flowEdge, nodes, onUpdate }: EdgePropertiesProps) {
  const edge = flowEdge.data.edge
  const source = nodes.find((n) => n.id === edge.source)?.data.node
  const target = nodes.find((n) => n.id === edge.target)?.data.node
  if (!source || !target) {
    return null
  }

  return (
    <div className="grid gap-4">
      <PanelHeader title={`${source.name} → ${target.name}`} edgeId={edge.id} />
      {NODE_KINDS[source.type].edgeParams.map((param) => (
        <NumberField
          key={param}
          spec={EDGE_PARAM_SPECS[param]}
          value={edge[param]}
          onChange={(value) => onUpdate(edge.id, { [param]: value })}
        />
      ))}
      {NODE_KINDS[source.type].edgeChoiceParams.map((param) => (
        <ChoiceField
          key={param}
          spec={EDGE_CHOICE_SPECS[param]}
          value={edge[param]}
          onChange={(value) => onUpdate(edge.id, { [param]: value })}
        />
      ))}
    </div>
  )
}

type PanelHeaderProps = {
  title: string
  icon?: ReactNode
  nodeId?: string
  edgeId?: string
}

function PanelHeader({ title, icon, nodeId, edgeId }: PanelHeaderProps) {
  const { deleteElements } = useReactFlow()

  return (
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="min-w-0 flex-1 truncate font-heading text-[15px] font-bold" title={title}>
        {title}
      </h2>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="刪除"
        title="刪除（Delete）"
        // 刪 Node 時 React Flow 會連同相連的 Edge 一起刪
        onClick={() =>
          deleteElements({ nodes: nodeId ? [{ id: nodeId }] : [], edges: edgeId ? [{ id: edgeId }] : [] })
        }
      >
        <Trash2 />
      </Button>
    </div>
  )
}
