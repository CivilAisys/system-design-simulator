import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { simulate, type SimulationResult, type Topology } from '@/api/client'

const AUTO_RUN_DEBOUNCE_MS = 300

type SimulationOptions = {
  // 只有最新一次 Run 的成功結果會呼叫
  onResult?: (topology: Topology, result: SimulationResult) => void
  // 只有最新一次 Run 失敗時會呼叫
  onError?: () => void
}

// Run、Auto-run（spec 第 6 節）和「已過期」判斷。
// topology 只在參數、名稱或連線改變時換參考（見 useTopologyEditor 的 model），拖動節點不會重新計算 key
export function useSimulation(topology: Topology, { onResult, onError }: SimulationOptions = {}) {
  const [autoRun, setAutoRun] = useState(true)
  const [result, setResult] = useState<SimulationResult | null>(null)
  // 最新一次送出的 Run 是哪個拓撲（含計算中），用來判斷過期和要不要再送；失敗時清掉，之後可以重試
  const [runKey, setRunKey] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latestRun = useRef(0)
  const pendingAutoRun = useRef<ReturnType<typeof setTimeout> | null>(null)

  const key = useMemo(() => simulationKey(topology), [topology])

  async function run() {
    // 手動 Run 取代還在倒數的 Auto-run，同一份拓撲不送兩次
    cancelPendingAutoRun()
    const id = ++latestRun.current
    const target = topology
    setRunKey(key)
    setRunning(true)
    setError(null)
    // 計算中保留舊結果，Auto-run 時畫布才不會每次修改都閃一下
    let next: SimulationResult
    try {
      next = await simulate(target)
    } catch (e) {
      if (id !== latestRun.current) return
      // Run 失敗時畫布不能留著舊的狀態色和 RPS
      setResult(null)
      setRunKey(null)
      setError(e instanceof Error ? e.message : String(e))
      setRunning(false)
      onError?.()
      return
    }
    // 較早送出但較晚回來的回應直接丟棄，也不能把較新那次的 running 關掉
    if (id !== latestRun.current) return
    setResult(next)
    setRunning(false)
    // 放在 try 外面：通知出錯不能被當成 Run 失敗而清掉結果
    onResult?.(target, next)
  }

  function cancelPendingAutoRun() {
    if (pendingAutoRun.current != null) {
      clearTimeout(pendingAutoRun.current)
      pendingAutoRun.current = null
    }
  }

  // 已經送出過同一份拓撲（例如重新打開 Auto-run、或改名稱後又改回來）就不再送
  const autoRunIfChanged = useEffectEvent(() => {
    pendingAutoRun.current = null
    if (runKey !== key) run()
  })

  useEffect(() => {
    if (!autoRun) return
    pendingAutoRun.current = setTimeout(autoRunIfChanged, AUTO_RUN_DEBOUNCE_MS)
    return cancelPendingAutoRun
  }, [key, autoRun])

  // Auto-run 開啟時，修改後的結果很快會被取代，不標示過期；手動 Run 計算中也不標示
  const stale = !autoRun && result != null && runKey !== key

  return { result, running, error, stale, autoRun, setAutoRun, run }
}

// 名稱和 ui 欄位不影響計算（spec 第 6 節），改了不重算、也不算過期
function simulationKey(topology: Topology): string {
  return JSON.stringify({ ...topology, nodes: topology.nodes.map(({ ui: _ui, name: _name, ...node }) => node) })
}
