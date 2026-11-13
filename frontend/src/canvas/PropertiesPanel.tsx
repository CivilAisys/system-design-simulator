import { useId, type ReactNode } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import type { NodeResult } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NODE_KINDS, type NodeParams } from './catalog'
import { formatUtilization } from './format'
import { NumberField } from './NumberField'
import {
  checkNodeParam,
  EDGE_PARAM_SPECS,
  edgeNumberParams,
  NODE_NUMBER_PARAMS,
  NODE_PARAM_SPECS,
  nodeParam,
} from './params'
import type { SimFlowNode } from './SimNode'
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

type NodePropertiesProps = {
  node: SimFlowNode
  result: NodeResult | undefined
  onUpdate: (id: string, patch: NodePatch) => void
}

function NodeProperties({ node: flowNode, result, onUpdate }: NodePropertiesProps) {
  const nameId = useId()
  const node = flowNode.data.node
  const { label, icon: Icon } = NODE_KINDS[node.type]
  const utilization = result?.utilization ?? null

  return (
    <div className="grid gap-4">
      <PanelHeader title={label} icon={<Icon className="size-4 text-muted-foreground" />} nodeId={node.id} />
      <div className="grid gap-1.5">
        <Label htmlFor={nameId}>名稱</Label>
        <Input id={nameId} value={node.name} onChange={(event) => onUpdate(node.id, { name: event.target.value })} />
      </div>
      {NODE_NUMBER_PARAMS[node.type].map((param) => (
        <NumberField
          key={param}
          spec={NODE_PARAM_SPECS[param]}
          value={nodeParam(node.params, param)}
          check={(value) => checkNodeParam(node.params, param, value)}
          onChange={(value) => onUpdate(node.id, { params: { [param]: value } })}
        />
      ))}
      {node.type === 'SERVICE' && (
        <div className="grid gap-1.5">
          <Label>callMode</Label>
          <Select
            value={node.params.callMode}
            // 選項只有下面兩個 SelectItem
            onValueChange={(value) =>
              onUpdate(node.id, { params: { callMode: value as NonNullable<NodeParams['callMode']> } })
            }
          >
            <SelectTrigger className="w-full" aria-label="callMode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SEQUENTIAL">SEQUENTIAL（依序）</SelectItem>
              <SelectItem value="PARALLEL">PARALLEL（平行）</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {/* Client 沒有容量，ρ 不適用；Run 之前也還沒有值 */}
      {utilization !== null && (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <span>ρ</span>
            <span className="tabular-nums">{formatUtilization(utilization)}</span>
          </div>
          <Progress value={Math.min(utilization, 1) * 100} aria-label="ρ" />
        </div>
      )}
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
      {edgeNumberParams(source.type).map((param) => (
        <NumberField
          key={param}
          spec={EDGE_PARAM_SPECS[param]}
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
      <h2 className="min-w-0 flex-1 truncate font-heading text-sm font-semibold" title={title}>
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
