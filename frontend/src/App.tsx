import { useState } from 'react'
import { Loader2, Moon, Play, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { simulate, type SimulationResult, type Topology } from '@/api/client'
import { Canvas } from '@/canvas/Canvas'
import { formatUtilization } from '@/canvas/format'
import { initialTopology } from '@/canvas/initialTopology'
import { ResultsPanel } from '@/results/ResultsPanel'
import { useTheme } from '@/theme'

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [topology] = useState(initialTopology)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    // 先清掉上一次的結果，Run 失敗時畫布不能留著舊的狀態色和 RPS
    setRunning(true)
    setResult(null)
    setError(null)
    // 上一次的瓶頸通知會和這次的結果（驗證錯誤、HTTP 錯誤）互相矛盾
    toast.dismiss(BOTTLENECK_TOAST)
    try {
      const next = await simulate(topology)
      setResult(next)
      notifyBottleneck(topology, next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const invalid = result && !result.valid ? result.errors : []
  const message =
    error ?? (invalid.length > 0 ? `驗證錯誤：${invalid.map((e) => e.message).join('；')}` : null)

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <h1 className="shrink-0 font-heading text-base font-semibold">System Design Simulator</h1>
        <Button onClick={run} disabled={running} size="sm" className="shrink-0">
          {running ? <Loader2 className="animate-spin" /> : <Play />}
          Run
        </Button>
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
      <main className="min-h-0 flex-1">
        <Canvas topology={topology} result={result} colorMode={theme} />
      </main>
      <section aria-label="結果" className="h-72 shrink-0 border-t">
        <ResultsPanel topology={topology} result={result} running={running} theme={theme} />
      </section>
      <Toaster theme={theme} position="top-right" />
    </div>
  )
}

// 固定 toast id，連續 Run 時替換而不是堆疊
const BOTTLENECK_TOAST = 'bottleneck'

// 只要有伺服器類節點，後端一定會挑 ρ 最高的當瓶頸（第 4.4 節），
// 所以只在它至少 WARN（ρ ≥ 0.7）時才通知，全部 OK 時不打擾
function notifyBottleneck(topology: Topology, result: SimulationResult) {
  const id = result.summary.bottleneckNodeId
  if (!result.valid || id == null) return
  const metrics = result.nodes[id]
  if (!metrics?.status || metrics.status === 'OK') return
  const name = topology.nodes.find((node) => node.id === id)?.name ?? id
  toast.warning(`發現瓶頸：${name}`, {
    id: BOTTLENECK_TOAST,
    description: `ρ ${formatUtilization(metrics.utilization)}・${metrics.status}`,
  })
}
