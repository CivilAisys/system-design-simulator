import { useState } from 'react'
import { Loader2, Moon, Play, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { simulate, type SimulationResult } from '@/api/client'
import { Canvas } from '@/canvas/Canvas'
import { initialTopology } from '@/canvas/initialTopology'
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
    try {
      setResult(await simulate(topology))
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
      <main className="flex-1">
        <Canvas topology={topology} result={result} colorMode={theme} />
      </main>
    </div>
  )
}
