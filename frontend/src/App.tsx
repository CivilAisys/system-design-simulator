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
    setRunning(true)
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

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <h1 className="font-heading text-base font-semibold">System Design Simulator</h1>
        <Button onClick={run} disabled={running} size="sm">
          {running ? <Loader2 className="animate-spin" /> : <Play />}
          Run
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
        {invalid.length > 0 && (
          <span className="text-sm text-destructive">
            驗證錯誤：{invalid.map((e) => e.message).join('；')}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
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
