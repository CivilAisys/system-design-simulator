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
  // result 是用哪些節點名稱算出來的。驗證錯誤的訊息由後端用當時的名稱組成，有錯誤時改名也要重新檢查
  const [resultNames, setResultNames] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 每次 reset 加一，同一份拓撲重新載入時 Auto-run 也要再跑一次
  const [generation, setGeneration] = useState(0)
  // 最新一次 Run 的請求；新的 Run 或 reset 時取消，後端不必再算沒人要的結果。
  // 回應回來時 controller 已經不是這一個，就表示有更新的 Run 或 reset 接手
  const inFlight = useRef<AbortController | null>(null)
  const pendingAutoRun = useRef<ReturnType<typeof setTimeout> | null>(null)

  const key = useMemo(() => simulationKey(topology), [topology])
  const names = useMemo(() => nodeNamesKey(topology), [topology])
  // 名稱不影響計算，只有畫面上的結果有驗證錯誤（訊息帶著名稱）時改名才需要重新 Run。
  // 計算中先不判斷：等那次 Run 回來，有錯誤而且名稱又改過才再送
  const namesOutdated = !running && result?.valid === false && resultNames !== names
  const needsRun = runKey !== key || namesOutdated

  async function run() {
    // 手動 Run 取代還在倒數的 Auto-run，同一份拓撲不送兩次
    cancelPendingAutoRun()
    abortInFlight()
    const controller = new AbortController()
    inFlight.current = controller
    const target = topology
    const targetNames = names
    setRunKey(key)
    setRunning(true)
    setError(null)
    // 計算中保留舊結果，Auto-run 時畫布才不會每次修改都閃一下
    let next: SimulationResult
    try {
      next = await simulate(target, controller.signal)
    } catch (e) {
      // 被取消的請求（AbortError）已經有較新的 Run 或 reset 接手，不算失敗
      if (controller !== inFlight.current) return
      inFlight.current = null
      // Run 失敗時畫布不能留著舊的狀態色和 RPS
      setResult(null)
      setRunKey(null)
      setError(e instanceof Error ? e.message : String(e))
      setRunning(false)
      onError?.()
      return
    }
    // 較早送出但較晚回來的回應直接丟棄，也不能把較新那次的 running 關掉
    if (controller !== inFlight.current) return
    inFlight.current = null
    setResult(next)
    setResultNames(targetNames)
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

  function abortInFlight() {
    inFlight.current?.abort()
    inFlight.current = null
  }

  // 換了一份拓撲（匯入、載入範例）：舊結果的 id 可能和新拓撲重疊，不能留著疊到畫布上；
  // 計算中的 Run 也不屬於新拓撲，取消掉
  function reset() {
    cancelPendingAutoRun()
    abortInFlight()
    setResult(null)
    setRunKey(null)
    setRunning(false)
    setError(null)
    setGeneration((g) => g + 1)
  }

  // 已經送出過同一份拓撲（例如重新打開 Auto-run、或沒有驗證錯誤時改名稱）就不再送
  const autoRunIfNeeded = useEffectEvent(() => {
    pendingAutoRun.current = null
    if (needsRun) run()
  })

  // names：有驗證錯誤時連續改名，停下來才送一次。
  // namesOutdated：計算中改了名稱，回來的結果才發現有驗證錯誤時，要再跑一次。
  // 不能依賴 needsRun：Run 失敗會清掉 runKey，依賴它會不停自動重試
  useEffect(() => {
    if (!autoRun) return
    pendingAutoRun.current = setTimeout(autoRunIfNeeded, AUTO_RUN_DEBOUNCE_MS)
    return cancelPendingAutoRun
  }, [key, names, namesOutdated, autoRun, generation])

  // 離開畫面時取消還沒回來的請求
  useEffect(() => abortInFlight, [])

  // Auto-run 開啟時，修改後的結果很快會被取代，不標示過期；手動 Run 計算中也不標示
  const stale = !autoRun && result != null && needsRun

  return { result, running, error, stale, autoRun, setAutoRun, run, reset }
}

// 名稱和 ui 欄位不影響計算，改了不重算、也不算過期（spec 第 6 節；有驗證錯誤時的名稱見 nodeNamesKey）
function simulationKey(topology: Topology): string {
  return JSON.stringify({ ...topology, nodes: topology.nodes.map(({ ui: _ui, name: _name, ...node }) => node) })
}

function nodeNamesKey(topology: Topology): string {
  return JSON.stringify(topology.nodes.map(({ id, name }) => [id, name]))
}
