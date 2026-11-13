import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { simulate, type SimulationResult, type Topology } from '@/api/client'

const AUTO_RUN_DEBOUNCE_MS = 300

type SimulationOptions = {
  // 每次送出前呼叫，例如收掉上一次的瓶頸通知
  onRun?: () => void
  // 只有最新一次 Run 的成功結果會呼叫
  onResult?: (topology: Topology, result: SimulationResult) => void
}

// Run、Auto-run（spec 第 6 節）和「已過期」判斷
export function useSimulation(topology: Topology, { onRun, onResult }: SimulationOptions = {}) {
  const [autoRun, setAutoRun] = useState(true)
  const [result, setResult] = useState<SimulationResult | null>(null)
  // 目前結果是從哪個拓撲算出來的，用來判斷是否過期
  const [resultKey, setResultKey] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latestRun = useRef(0)

  const key = useMemo(() => simulationKey(topology), [topology])

  async function run(target: Topology) {
    const id = ++latestRun.current
    setRunning(true)
    setError(null)
    onRun?.()
    // 計算中保留舊結果，Auto-run 時畫布才不會每次修改都閃一下
    try {
      const next = await simulate(target)
      if (id !== latestRun.current) return
      setResult(next)
      setResultKey(simulationKey(target))
      onResult?.(target, next)
    } catch (e) {
      if (id !== latestRun.current) return
      // Run 失敗時畫布不能留著舊的狀態色和 RPS
      setResult(null)
      setResultKey(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      // 較早送出但較晚回來的回應直接丟棄，也不能把較新那次的 running 關掉
      if (id === latestRun.current) setRunning(false)
    }
  }

  const runLatest = useEffectEvent(() => run(topology))

  // key 不含位置和選取，拖動節點不會觸發；重新開啟 Auto-run 時也會補算一次
  useEffect(() => {
    if (!autoRun) return
    const timer = setTimeout(runLatest, AUTO_RUN_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key, autoRun])

  // Auto-run 開啟時，修改後的結果很快會被取代，不標示過期
  const stale = !autoRun && result != null && resultKey !== key

  return {
    result,
    running,
    error,
    stale,
    autoRun,
    setAutoRun,
    run: () => run(topology),
  }
}

// ui 欄位只影響畫面，不影響計算（spec 第 6 節）
function simulationKey(topology: Topology): string {
  return JSON.stringify({ ...topology, nodes: topology.nodes.map(({ ui: _ui, ...node }) => node) })
}
