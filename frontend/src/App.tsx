import { useRef } from 'react'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { Loader2, Moon, Play, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { Switch } from '@/components/ui/switch'
import { isComputed, type NodeType, type SimulationResult, type Topology, type ValidationError } from '@/api/client'
import { Canvas } from '@/canvas/Canvas'
import { formatUtilization } from '@/canvas/format'
import { initialTopology } from '@/canvas/initialTopology'
import { Palette } from '@/canvas/Palette'
import { PropertiesPanel } from '@/canvas/PropertiesPanel'
import { useTopologyEditor } from '@/canvas/useTopologyEditor'
import { cn } from '@/lib/utils'
import { ResultsPanel } from '@/results/ResultsPanel'
import { useSimulation } from '@/simulation/useSimulation'
import { useTheme } from '@/theme'

export default function App() {
  // 元件面板、屬性面板和畫布共用同一個 React Flow store（座標換算、刪除）
  return (
    <ReactFlowProvider>
      <Simulator />
    </ReactFlowProvider>
  )
}

function Simulator() {
  const { theme, toggleTheme } = useTheme()
  const editor = useTopologyEditor(initialTopology)
  const { topology } = editor
  const { screenToFlowPosition, fitView } = useReactFlow()
  const canvasRef = useRef<HTMLElement>(null)
  const bottleneck = useBottleneckToast()
  const { result, running, error, stale, autoRun, setAutoRun, run } = useSimulation(editor.model, {
    onResult: bottleneck.notify,
    // 上一次的瓶頸通知會和 Run 失敗互相矛盾
    onError: bottleneck.clear,
  })

  // 點擊元件面板時放在目前畫面的中央
  function addAtCenter(type: NodeType) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) {
      return
    }
    editor.addNode(type, screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }))
  }

  // 錯誤指到的節點：節點錯誤是它本身，邊錯誤是邊的兩端。
  // 結果可能比畫布舊（Auto-run 還在 debounce），已經刪掉的節點或邊回傳空陣列
  function errorNodeIds({ nodeId, edgeId }: ValidationError): string[] {
    if (nodeId != null) {
      return editor.nodes.some((n) => n.id === nodeId) ? [nodeId] : []
    }
    const edge = editor.edges.find((e) => e.id === edgeId)
    return edge ? [edge.source, edge.target] : []
  }

  // 選取有問題的節點或邊（屬性面板切到它），並把它移到畫面中央
  function focusError(error: ValidationError) {
    const ids = errorNodeIds(error)
    if (ids.length === 0) {
      return
    }
    editor.select({ nodeId: error.nodeId, edgeId: error.nodeId == null ? error.edgeId : null })
    void fitView({ nodes: ids.map((id) => ({ id })), duration: 300, maxZoom: 1.5 })
  }

  const invalidCount = result && !result.valid ? result.errors.length : 0
  const message = error ?? (invalidCount > 0 ? `拓撲有 ${invalidCount} 個驗證錯誤，見「錯誤」分頁` : null)

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <h1 className="shrink-0 font-heading text-base font-semibold">System Design Simulator</h1>
        <Button onClick={run} disabled={running} size="sm" className="shrink-0">
          {running ? <Loader2 className="animate-spin" /> : <Play />}
          Run
        </Button>
        <div className="flex shrink-0 items-center gap-2">
          <Switch id="auto-run" checked={autoRun} onCheckedChange={setAutoRun} size="sm" />
          <Label htmlFor="auto-run">Auto-run</Label>
        </div>
        {stale && (
          <Badge variant="outline" className="shrink-0" title="拓撲在上次 Run 之後改過，按 Run 重新計算">
            已過期
          </Badge>
        )}
        {/* 長訊息截成一行，完整內容放在 title */}
        {message && (
          <span role="alert" title={message} className="min-w-0 truncate text-sm text-destructive">
            {message}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? '切換為淺色' : '切換為深色'}
        >
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
      </header>
      <SidebarProvider className="min-h-0 flex-1">
        <Palette onAdd={addAtCenter} />
        <main ref={canvasRef} className="min-w-0 flex-1">
          <Canvas
            nodes={editor.nodes}
            edges={editor.edges}
            result={result}
            stale={stale}
            colorMode={theme}
            onNodesChange={editor.onNodesChange}
            onEdgesChange={editor.onEdgesChange}
            onConnect={editor.onConnect}
            isValidConnection={editor.isValidConnection}
            onAddNode={editor.addNode}
          />
        </main>
        <PropertiesPanel
          nodes={editor.nodes}
          edges={editor.edges}
          nodeResults={result?.nodes}
          onUpdateNode={editor.updateNode}
          onUpdateEdge={editor.updateEdge}
        />
      </SidebarProvider>
      <section aria-label="結果" className={cn('h-72 shrink-0 border-t', stale && 'opacity-60')}>
        <ResultsPanel
          topology={topology}
          result={result}
          running={running}
          theme={theme}
          canFocusError={(e) => errorNodeIds(e).length > 0}
          onFocusError={focusError}
        />
      </section>
      <Toaster theme={theme} position="top-right" />
    </div>
  )
}

// 固定 toast id，連續 Run 時原地更新而不是堆疊
const BOTTLENECK_TOAST = 'bottleneck'

// 只要有伺服器類節點，後端一定會挑 ρ 最高的當瓶頸（第 4.4 節），
// 所以只在它至少 WARN（ρ ≥ 0.7）時才通知，全部 OK 時不打擾。
// Auto-run 每次修改都會重算：同一個瓶頸（節點和狀態都沒變）只原地更新 ρ，
// 使用者關掉或自動消失後就不再跳出，直到瓶頸換了節點或狀態
function useBottleneckToast() {
  const shown = useRef<{ key: string; open: boolean } | null>(null)

  function clear() {
    shown.current = null
    toast.dismiss(BOTTLENECK_TOAST)
  }

  function notify(topology: Topology, result: SimulationResult) {
    const id = isComputed(result) ? result.summary.bottleneckNodeId : null
    const metrics = id == null ? undefined : result.nodes[id]
    // 驗證錯誤或沒有瓶頸時，上一次的通知會和這次的結果互相矛盾
    if (id == null || !metrics?.status || metrics.status === 'OK') {
      clear()
      return
    }
    const key = `${id}:${metrics.status}`
    if (shown.current?.key === key && !shown.current.open) return
    shown.current = { key, open: true }
    const closed = () => {
      if (shown.current?.key === key) shown.current.open = false
    }
    const name = topology.nodes.find((node) => node.id === id)?.name ?? id
    toast.warning(`發現瓶頸：${name}`, {
      id: BOTTLENECK_TOAST,
      description: `ρ ${formatUtilization(metrics.utilization)}・${metrics.status}`,
      onDismiss: closed,
      onAutoClose: closed,
    })
  }

  return { notify, clear }
}
