import { useEffect, useState } from 'react'
import { isAbortError, sweep, type SweepResult, type Topology } from '@/api/client'

type SweepState = { topology: Topology; maxMultiplier: number; data?: SweepResult; error?: string }

// 負載曲線分頁開著時才掃描（呼叫端只在分頁裡用這個 hook）。topology 是上次 Run 算的那一份，
// 所以跟著 Auto-run：開著時改了拓撲會自動重算，關著時要按 Run。topology 為 null（還沒 Run、驗證失敗）時不掃描
export function useLoadSweep(topology: Topology | null, maxMultiplier: number) {
  const [state, setState] = useState<SweepState | null>(null)
  // 按「重試」時加一，同一份拓撲再送一次
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (topology == null) return
    const controller = new AbortController()
    sweep(topology, maxMultiplier, controller.signal).then(
      (data) => setState({ topology, maxMultiplier, data }),
      (e: unknown) => {
        // 被取消的請求已經有較新的掃描接手
        if (isAbortError(e)) return
        setState({ topology, maxMultiplier, error: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => controller.abort()
  }, [topology, maxMultiplier, attempt])

  const current = state?.topology === topology && state.maxMultiplier === maxMultiplier
  return {
    // 計算中保留上一次的曲線，改參數時才不會每次都閃一下
    data: state?.data,
    error: current ? state.error : undefined,
    loading: topology != null && !current,
    retry: () => setAttempt((n) => n + 1),
  }
}
