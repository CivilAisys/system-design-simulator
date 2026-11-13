import { useEffect, useEffectEvent, useRef, useState, type ChangeEvent } from 'react'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { ChevronDown, Download, Loader2, Moon, Play, Redo2, Sun, Undo2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { EXAMPLES } from '@/examples'
import { restoreTopology, saveTopology, type Restored } from '@/io/autosave'
import { downloadTopology, parseTopology, serializeTopology } from '@/io/topologyFile'
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
  // 上次的畫布（自動存檔），讀不回來時用起始拓撲
  const [restored] = useState(() => restoreTopology(initialTopology))
  const editor = useTopologyEditor(restored.topology)
  const { topology } = editor
  const { screenToFlowPosition, fitView } = useReactFlow()
  const canvasRef = useRef<HTMLElement>(null)
  const bottleneck = useBottleneckToast()
  const { result, running, error, stale, autoRun, setAutoRun, run, reset } = useSimulation(editor.model, {
    onResult: bottleneck.notify,
    // 上一次的瓶頸通知會和 Run 失敗互相矛盾
    onError: bottleneck.clear,
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  useEditShortcuts({ undo, redo, copy: editor.copy, paste: editor.paste })
  useAutosave(topology, restored)
  // 換了拓撲之後把整張圖放進畫面。fitView 要等新節點量好尺寸，React Flow 會自己排隊，
  // 但必須在新節點進到 React Flow 之後才呼叫，所以放在 effect 裡
  const [fitRequest, setFitRequest] = useState(0)
  useEffect(() => {
    if (fitRequest > 0) void fitView({ duration: 300 })
  }, [fitRequest, fitView])

  // 匯入和載入範例共用：換掉畫布，通知上可以復原
  function loadTopology(next: Topology, message: string) {
    const loadId = editor.load(next)
    resetForNewTopology()
    toast.success(message, {
      id: LOAD_TOAST,
      // 預設 4 秒太短，來不及看清楚新拓撲再決定要不要復原
      duration: LOAD_TOAST_MS,
      action: { label: '復原', onClick: () => undoLoad(loadId) },
    })
  }

  // 整份拓撲換掉（匯入、載入範例，或復原／重做跨過它們）：清掉另一份拓撲的結果和通知，
  // 把整張圖放進畫面；Auto-run 開啟時會自動 Run
  function resetForNewTopology() {
    reset()
    bottleneck.clear()
    setFitRequest((n) => n + 1)
  }

  // 復原或重做跨過了匯入、載入範例，那則通知上的「復原」已經不適用
  function travelledAcrossLoad() {
    resetForNewTopology()
    toast.dismiss(LOAD_TOAST)
  }

  function undo() {
    if (editor.undo()) travelledAcrossLoad()
  }

  function redo() {
    if (editor.redo()) travelledAcrossLoad()
  }

  function undoLoad(loadId: number) {
    if (editor.undoLoad(loadId)) {
      travelledAcrossLoad()
    } else {
      toast.info('換掉之後又改過畫布，請用工具列的「復原」一步步回去')
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    // 清掉選取，同一個檔案改過之後可以再匯入一次
    input.value = ''
    if (!file) {
      return
    }
    let text: string
    try {
      text = await file.text()
    } catch {
      toast.error(`匯入失敗：讀不到 ${file.name}`)
      return
    }
    const parsed = parseTopology(text)
    if (!parsed.ok) {
      const [first, ...rest] = parsed.errors
      toast.error(`匯入失敗：${file.name} 格式錯誤`, {
        description: rest.length > 0 ? `${first}（另有 ${rest.length} 個錯誤）` : first,
      })
      return
    }
    loadTopology(parsed.topology, `已匯入 ${file.name}`)
  }

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
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={undo}
            disabled={!editor.canUndo}
            aria-label="復原"
            title="復原（Ctrl/⌘+Z）"
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={redo}
            disabled={!editor.canRedo}
            aria-label="重做"
            title="重做（Ctrl/⌘+Shift+Z）"
          >
            <Redo2 />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={importFile}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload />
            匯入
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadTopology(topology)}>
            <Download />
            匯出
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                範例
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => loadTopology(initialTopology, '已回到起始拓撲')}>
                起始拓撲
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {EXAMPLES.map((example) => (
                <DropdownMenuItem
                  key={example.id}
                  onSelect={() => loadTopology(example.topology, `已載入範例「${example.label}」`)}
                >
                  {example.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
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

type EditActions = { undo: () => void; redo: () => void; copy: () => boolean; paste: () => boolean }

// Ctrl/Cmd+Z 復原、Ctrl/Cmd+Shift+Z 重做、Ctrl/Cmd+C 複製選取的節點、Ctrl/Cmd+V 貼上。
// 焦點在輸入框時交給輸入框自己的復原和文字的複製貼上
function useEditShortcuts({ undo, redo, copy, paste }: EditActions) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) {
      return
    }
    const target = event.target
    if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) {
      return
    }
    const key = event.key.toLowerCase()
    if (key === 'z') {
      event.preventDefault()
      if (event.shiftKey) {
        redo()
      } else {
        undo()
      }
    } else if (key === 'c' && !event.shiftKey) {
      // 不攔截：頁面上有選取的文字（例如結果表格）時，瀏覽器照樣複製文字
      copy()
    } else if (key === 'v' && !event.shiftKey && paste()) {
      event.preventDefault()
    }
  })
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

// 拓撲內容（含位置）變了就存起來，重新整理後還原。選取、量尺寸也會換掉 topology 的參考，但內容沒變不寫。
// 一開始記成還原出來的拓撲：存檔讀不回來時，使用者動手修改之前不蓋掉它，重新整理還會再提示
function useAutosave(topology: Topology, restored: Restored) {
  const saved = useRef<string | null>(null)
  useEffect(() => {
    saved.current ??= serializeTopology(restored.topology)
    const text = serializeTopology(topology)
    if (text !== saved.current) {
      saved.current = text
      saveTopology(topology)
    }
  }, [topology, restored])
  // sonner 會把 Toaster 訂閱前就發出的通知補給它。固定 id，StrictMode 重跑 effect 也只有一則
  useEffect(() => {
    if (restored.error != null) {
      toast.warning('讀不回上次的畫布，已回到起始拓撲', { id: RESTORE_TOAST, description: restored.error })
    }
  }, [restored])
}

const RESTORE_TOAST = 'restore'

// 匯入、載入範例的通知，同一時間只留最新的一則
const LOAD_TOAST = 'load'
const LOAD_TOAST_MS = 10_000

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
