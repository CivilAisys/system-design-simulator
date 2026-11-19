import { useEffect, useState } from 'react'
import { isAbortError, sweep, type SweepResult, type Topology } from '@/api/client'
import type { MaxMultiplier } from './loadCurve'

// 這次的請求：同一份拓撲、同一個上限、同一次重試
type Request = { topology: Topology; maxMultiplier: MaxMultiplier; attempt: number }
type SweepState = Request & { data?: SweepResult; error?: string }

// 負載曲線分頁開著時才掃描（呼叫端只在分頁裡用這個 hook）。topology 是上次 Run 算的那一份，
// 所以跟著 Auto-run：開著時改了拓撲會自動重算，關著時要按 Run；換上限則馬上重算。
// topology 為 null（還沒 Run、驗證失敗）時不掃描
export function useLoadSweep(topology: Topology | null, maxMultiplier: MaxMultiplier) {
  const [state, setState] = useState<SweepState | null>(null)
  // 按「重試」時加一，同一份拓撲再送一次
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (topology == null) return
    const controller = new AbortController()
    const request = { topology, maxMultiplier, attempt }
    sweep(topology, maxMultiplier, controller.signal).then(
      (data) => setState({ ...request, data }),
      (e: unknown) => {
        // 被取消的請求已經有較新的掃描接手
        if (isAbortError(e)) return
        // 失敗時保留上一條曲線，重試成功前還看得到
        setState((previous) => ({
          ...request,
          data: previous?.data,
          error: e instanceof Error ? e.message : String(e),
        }))
      },
    )
    return () => controller.abort()
  }, [topology, maxMultiplier, attempt])

  const current =
    state != null && state.topology === topology && state.maxMultiplier === maxMultiplier && state.attempt === attempt
  return {
    // 計算中保留上一次的曲線，改參數時才不會每次都閃一下
    data: state?.data,
    error: current ? state.error : undefined,
    loading: topology != null && !current,
    retry: () => setAttempt((n) => n + 1),
  }
}
