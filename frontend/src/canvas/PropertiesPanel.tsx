import { Fragment, useId, useState, type ReactNode, type Ref } from 'react'
import { useReactFlow } from '@xyflow/react'
import { ChevronDown, PanelRightOpen, Pin, PinOff, Trash2 } from 'lucide-react'
import { totalRps, type EdgeResult, type NodeResult } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ExplanationSteps } from '@/explanation/ExplanationSteps'
import type { ExplanationStep } from '@/explanation/explanation'
import { cn } from '@/lib/utils'
import { NEW_DISK_GB, NODE_KINDS } from './catalog'
import { CategoryIcon } from './CategoryIcon'
import { formatClassRates, formatRps, formatUtilization, STALE_RESULT_NOTE } from './format'
import { unconnectedNodeIds } from './graph'
import { hotShareHint, replicasHint, workersHint } from './instanceRack'
import { NumberField } from './NumberField'
import { edgeParamGuide, nodeParamGuide, type ParamGuide } from './paramGuide'
import { ParamInfo } from './ParamInfo'
import { ParamLabel } from './ParamLabel'
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
import { displayStatus, STATUS_BADGE, STATUS_FILL, STATUS_TEXT } from './status'
import type { RpsFlowEdge } from './RpsEdge'
import type { EdgePatch, NodePatch } from './useTopologyEditor'

type PropertiesPanelProps = {
  nodes: SimFlowNode[]
  edges: RpsFlowEdge[]
  nodeResults: Record<string, NodeResult> | undefined
  edgeResults: Record<string, EdgeResult> | undefined
  // 拓撲在上次 Run 之後改過，結果可能不準
  stale: boolean
  // 上次 Run 驗證失敗，沒有計算結果
  invalid: boolean
  onUpdateNode: (id: string, patch: NodePatch) => void
  // 點計算說明裡的節點名稱：選取它並移到畫面上
  onSelectNode: (id: string) => void
  onUpdateEdge: (id: string, patch: EdgePatch) => void
  // 釘住時固定在畫布右側；沒釘住時浮在畫布上（App 只在剛好選了一個時放出來）
  pinned: boolean
  onTogglePin: () => void
  pinButtonRef?: Ref<HTMLButtonElement>
}

// 只在剛好選了一個 Node 或一條 Edge 時顯示它的參數
export function PropertiesPanel({
  nodes,
  edges,
  nodeResults,
  edgeResults,
  stale,
  invalid,
  onUpdateNode,
  onSelectNode,
  onUpdateEdge,
  pinned,
  onTogglePin,
  pinButtonRef,
}: PropertiesPanelProps) {
  const selectedNodes = nodes.filter((n) => n.selected)
  const selectedEdges = edges.filter((e) => e.selected)
  // 「怎麼算的」展開後，換到別的節點（包括點算式裡的名稱）時保持展開
  const [explanationOpen, setExplanationOpen] = useState(false)

  let content
  if (selectedNodes.length === 1 && selectedEdges.length === 0) {
    const node = selectedNodes[0]
    const unconnected = unconnectedNodeIds([node.data.node], edges).has(node.id)
    // key：換選取時重建，輸入框裡打到一半的字不會帶到別的節點
    content = (
      <NodeProperties
        key={node.id}
        node={node}
        result={nodeResults?.[node.id]}
        unconnected={unconnected}
        onUpdate={onUpdateNode}
        explanation={
          <ExplanationSection
            steps={nodeResults?.[node.id]?.explanation}
            unconnected={unconnected}
            invalid={invalid}
            stale={stale}
            open={explanationOpen}
            onToggle={() => setExplanationOpen((open) => !open)}
            nodeName={(id) => nodes.find((n) => n.id === id)?.data.node.name}
            onSelectNode={onSelectNode}
          />
        }
      />
    )
  } else if (selectedEdges.length === 1 && selectedNodes.length === 0) {
    const edge = selectedEdges[0]
    content = (
      <EdgeProperties
        key={edge.id}
        edge={edge}
        nodes={nodes}
        result={edgeResults?.[edge.id]}
        stale={stale}
        onUpdate={onUpdateEdge}
      />
    )
  } else {
    content = <p className="text-sm text-muted-foreground">選取一個元件或連線來調整參數。</p>
  }

  return (
    <aside
      aria-label="屬性"
      className={cn(
        'flex w-72 shrink-0 flex-col',
        pinned
          ? 'border-l'
          : // 浮在畫布右側、細條的左邊（App 的版面是 relative），上下留一點空隙，看得出是蓋在畫布上
            'absolute top-2 right-11 bottom-2 z-30 overflow-hidden rounded-xl border bg-background shadow-2xl animate-in fade-in slide-in-from-right-2',
      )}
    >
      <div className="flex items-center justify-between border-b py-1 pr-2 pl-4 text-xs font-medium text-muted-foreground">
        屬性
        <Button
          ref={pinButtonRef}
          variant="ghost"
          size="icon-sm"
          onClick={onTogglePin}
          aria-label={pinned ? '取消釘選屬性面板' : '釘選屬性面板'}
          title={pinned ? '取消釘選，選取時才浮出（]）' : '釘選屬性面板（]）'}
        >
          {pinned ? <Pin /> : <PinOff />}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{content}</div>
    </aside>
  )
}

// 沒釘住時畫布右側留下的細條，按一下釘回去
export function PropertiesRail({ onPin, buttonRef }: { onPin: () => void; buttonRef?: Ref<HTMLButtonElement> }) {
  return (
    <div className="flex w-9 shrink-0 flex-col items-center gap-2 border-l py-1">
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon-sm"
        onClick={onPin}
        aria-label="釘選屬性面板"
        title="釘選屬性面板（]）"
        className="text-muted-foreground"
      >
        <PanelRightOpen />
      </Button>
      <span className="text-xs text-muted-foreground [writing-mode:vertical-rl]">選取元件會浮出屬性</span>
    </div>
  )
}

// 按「設定熱點」時先填平均的 1.5 倍：看得出最熱那台比較忙，2 台時另一台也還有流量
function newHotShare(instances: number): number {
  return Math.min(1, 1.5 / instances)
}

type NodePropertiesProps = {
  node: SimFlowNode
  result: NodeResult | undefined
  // 沒有任何邊，和畫布一樣不列 ρ（見 unconnectedNodeIds）
  unconnected: boolean
  onUpdate: (id: string, patch: NodePatch) => void
  // 「怎麼算的」區塊，放在指標下面
  explanation: ReactNode
}

function NodeProperties({ node: flowNode, result, unconnected, onUpdate, explanation }: NodePropertiesProps) {
  const nameId = useId()
  const node = flowNode.data.node
  const { label, icon, category, numberParams, choiceParams, hasHotShare, hasDisk } = NODE_KINDS[node.type]
  // 未連線時沒有流量可看，不列 ρ；有連線但沒流量時 ρ 是 0，底色和進度條用灰色，不用 OK 的綠色
  const utilization = unconnected ? null : (result?.utilization ?? null)
  const status = displayStatus(result, false)

  const replicas = replicasHint(node)
  // 多台的 Cache 才有熱點：沒設定時所有機器共用一條佇列。緊接在 instances 後面顯示（spec 4.2.2）
  const instances = nodeParam(node.params, 'instances')
  const hotShareField =
    hasHotShare &&
    instances >= 2 &&
    (node.params.hotShare === undefined ? (
      <Button
        variant="link"
        size="sm"
        className="h-auto justify-start p-0 text-xs"
        onClick={() => onUpdate(node.id, { params: { hotShare: newHotShare(instances) } })}
      >
        設定熱點：最熱那台分到較多流量
      </Button>
    ) : (
      <div className="grid gap-1">
        <NumberField
          spec={NODE_PARAM_SPECS.hotShare}
          guide={nodeParamGuide(node.type, 'hotShare')}
          value={node.params.hotShare}
          check={(value) => checkNodeParam(node.params, 'hotShare', value)}
          onChange={(value) => onUpdate(node.id, { params: { hotShare: value } })}
        />
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>
            最熱那台分到的流量比例，平均是 1/{instances}（{formatShare(1 / instances)}）
          </span>
          <Button
            variant="link"
            size="sm"
            className="h-auto shrink-0 p-0 text-xs"
            onClick={() => onUpdate(node.id, { clearParams: ['hotShare'] })}
          >
            沒有熱點
          </Button>
        </div>
      </div>
    ))

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
            guide={nodeParamGuide(node.type, param)}
            value={nodeParam(node.params, param)}
            check={(value) => checkNodeParam(node.params, param, value)}
            onChange={(value) => onUpdate(node.id, { params: { [param]: value } })}
          />
          {param === 'instances' && (
            <>
              <p className="-mt-3 text-xs text-muted-foreground">
                {workersHint(instances, nodeParam(node.params, 'concurrency'))}
                {replicas && (
                  <>
                    <br />
                    {replicas}
                  </>
                )}
                {node.params.hotShare !== undefined && (
                  <>
                    <br />
                    {hotShareHint(node.params.hotShare)}
                  </>
                )}
              </p>
              {hotShareField}
            </>
          )}
        </Fragment>
      ))}
      {/* 磁碟容量選填：沒設定時不估算磁碟幾天後會滿（spec 4.8）；Object Storage 沒有 */}
      {hasDisk &&
        (node.params.diskGbPerInstance === undefined ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto justify-start p-0 text-xs"
            onClick={() => onUpdate(node.id, { params: { diskGbPerInstance: NEW_DISK_GB } })}
          >
            設定磁碟容量，估算幾天後會滿
          </Button>
        ) : (
          <div className="grid gap-1">
            <NumberField
              spec={NODE_PARAM_SPECS.diskGbPerInstance}
              guide={nodeParamGuide(node.type, 'diskGbPerInstance')}
              value={node.params.diskGbPerInstance}
              check={(value) => checkNodeParam(node.params, 'diskGbPerInstance', value)}
              onChange={(value) => onUpdate(node.id, { params: { diskGbPerInstance: value } })}
            />
            <div className="flex justify-end text-xs">
              <Button
                variant="link"
                size="sm"
                className="h-auto shrink-0 p-0 text-xs"
                onClick={() => onUpdate(node.id, { clearParams: ['diskGbPerInstance'] })}
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
          guide={nodeParamGuide(node.type, param)}
          value={node.params[param]}
          onChange={(value) => onUpdate(node.id, { params: { [param]: value } })}
        />
      ))}
      {/* Client 沒有容量，ρ 不適用；Run 之前也還沒有值；未連線時不列 */}
      {utilization !== null && (
        // 底色跟著狀態（STATUS_BADGE 的淡底和深色文字）
        <div className={cn('grid gap-2.5 rounded-xl bg-muted p-3.5', status && STATUS_BADGE[status])}>
          <div className="flex items-baseline justify-between text-sm">
            <ParamLabel label="使用率" labelEn="ρ" />
            <span className={cn('font-heading text-[22px] font-bold', status && STATUS_TEXT[status])}>
              {formatUtilization(utilization)}
            </span>
          </div>
          <Progress
            value={Math.min(utilization, 1) * 100}
            aria-label="使用率"
            indicatorClassName={status ? STATUS_FILL[status] : undefined}
          />
        </div>
      )}
      {explanation}
    </div>
  )
}

type ExplanationSectionProps = {
  steps: ExplanationStep[] | undefined
  unconnected: boolean
  invalid: boolean
  stale: boolean
  open: boolean
  onToggle: () => void
  nodeName: (id: string) => string | undefined
  onSelectNode: (id: string) => void
}

// 每個數字怎麼算出來的（spec 4.9），預設收起
function ExplanationSection({
  steps,
  unconnected,
  invalid,
  stale,
  open,
  onToggle,
  nodeName,
  onSelectNode,
}: ExplanationSectionProps) {
  const contentId = useId()
  // 拓撲有驗證錯誤、沒有結果時不顯示，錯誤分頁會說明
  if (invalid && !steps) {
    return null
  }

  let content
  if (unconnected) {
    content = <p className="text-xs text-muted-foreground">未連線，沒有計算</p>
  } else if (!steps) {
    content = <p className="text-xs text-muted-foreground">Run 之後顯示</p>
  } else {
    content = (
      <>
        {stale && <p className="text-xs text-muted-foreground">{STALE_RESULT_NOTE}</p>}
        <div className={cn(stale && 'opacity-50')}>
          <ExplanationSteps steps={steps} nodeName={nodeName} onSelectNode={onSelectNode} />
        </div>
      </>
    )
  }

  return (
    <div className="grid gap-2 border-t pt-3">
      <Button
        variant="ghost"
        size="sm"
        className="h-auto justify-between px-1 py-1 text-sm font-medium"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
      >
        怎麼算的
        <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
      </Button>
      {open && (
        <div id={contentId} className="grid gap-2">
          {content}
        </div>
      )}
    </div>
  )
}

type ChoiceFieldProps<V extends string> = {
  spec: ChoiceSpec<V>
  value: V | undefined
  onChange: (value: V) => void
  // 同 NumberField
  guide?: ParamGuide
}

function ChoiceField<V extends string>({ spec, value, onChange, guide }: ChoiceFieldProps<V>) {
  const { label, labelEn, options } = spec
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1">
        <Label>
          <ParamLabel label={label} labelEn={labelEn} />
        </Label>
        {guide && <ParamInfo label={label} guide={guide} />}
      </div>
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
  result: EdgeResult | undefined
  stale: boolean
  onUpdate: (id: string, patch: EdgePatch) => void
}

function EdgeProperties({ edge: flowEdge, nodes, result, stale, onUpdate }: EdgePropertiesProps) {
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
          guide={edgeParamGuide(source.type, target.type, param)}
          value={edge[param]}
          onChange={(value) => onUpdate(edge.id, { [param]: value })}
        />
      ))}
      {NODE_KINDS[source.type].edgeChoiceParams.map((param) => (
        <ChoiceField
          key={param}
          spec={EDGE_CHOICE_SPECS[param]}
          guide={edgeParamGuide(source.type, target.type, param)}
          value={edge[param]}
          onChange={(value) => onUpdate(edge.id, { [param]: value })}
        />
      ))}
      {/* Run 之前還沒有值；過期時和畫布上的標籤一樣淡化 */}
      {result && (
        <div className={cn('grid gap-1 rounded-xl bg-muted p-3.5', stale && 'opacity-50')}>
          <div className="flex items-baseline justify-between text-sm">
            <span>流量</span>
            <span className="font-heading text-[15px] font-bold">{formatRps(totalRps(result.rps))}</span>
          </div>
          <div className="text-right text-xs text-muted-foreground">{formatClassRates(result.rps)}</div>
        </div>
      )}
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
