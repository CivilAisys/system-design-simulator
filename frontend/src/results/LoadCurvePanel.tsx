import { lazy, Suspense, useEffect, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SimulationResult, Topology } from '@/api/client'
import type { Theme } from '@/theme'
import { STALE_RESULT_NOTE } from '@/canvas/format'
import { cn } from '@/lib/utils'
import { MAX_MULTIPLIERS, parseMaxMultiplier, type MaxMultiplier } from './loadCurve'
import { useLoadSweep } from './useLoadSweep'

// ECharts 很大，切到這個分頁才載入（同 Sankey）
const LoadCurveChart = lazy(() => import('./LoadCurveChart').then((module) => ({ default: module.LoadCurveChart })))

const STORAGE_KEY = 'loadCurveMax'

type LoadCurvePanelProps = {
  // 畫面上的拓撲，用來找節點名稱
  topology: Topology
  // 上次 Run 的結果和它算的拓撲；負載掃描掃的是那一份
  result: SimulationResult
  resultTopology: Topology | null
  stale: boolean
  theme: Theme
}

// 負載曲線分頁（spec 第 6 節）：只在分頁開著時掛上，關著時不打 API
export function LoadCurvePanel({ topology, result, resultTopology, stale, theme }: LoadCurvePanelProps) {
  const [maxMultiplier, setMaxMultiplier] = useStoredMaxMultiplier()
  const sweep = useLoadSweep(result.valid ? resultTopology : null, maxMultiplier)
  const nodeName = (id: string) => topology.nodes.find((node) => node.id === id)?.name ?? id

  let body
  if (!result.valid) {
    body = <Message>拓撲有驗證錯誤，先修正錯誤（見「錯誤」分頁）再看負載曲線</Message>
  } else if (sweep.error) {
    body = (
      <div className="flex items-center gap-3 p-4 text-sm">
        <span className="text-destructive">{sweep.error}</span>
        <Button variant="outline" size="sm" onClick={sweep.retry}>
          <RotateCw />
          重試
        </Button>
      </div>
    )
  } else if (!sweep.data) {
    body = <Message>計算中…</Message>
  } else if (sweep.data.currentRps === 0) {
    body = <Message>Client 的 rps 都是 0，沒有可以放大的流量</Message>
  } else {
    body = (
      <div className={cn('h-full min-h-40', (stale || sweep.loading) && 'opacity-50')}>
        <Suspense>
          <LoadCurveChart sweep={sweep.data} nodeName={nodeName} theme={theme} />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">所有 Client 的 rps 一起放大到</span>
        <Select value={String(maxMultiplier)} onValueChange={(value) => setMaxMultiplier(parseMaxMultiplier(value))}>
          <SelectTrigger size="sm" className="w-20" aria-label="上限倍率">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MAX_MULTIPLIERS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option}×
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {stale && <span className="text-xs text-muted-foreground">{STALE_RESULT_NOTE}</span>}
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  )
}

function Message({ children }: { children: string }) {
  return <p className="p-4 text-sm text-muted-foreground">{children}</p>
}

function readStoredMaxMultiplier(): MaxMultiplier {
  try {
    return parseMaxMultiplier(localStorage.getItem(STORAGE_KEY))
  } catch {
    return parseMaxMultiplier(null)
  }
}

// 上限倍率存在 localStorage，重新整理後保留
function useStoredMaxMultiplier() {
  const [value, setValue] = useState(readStoredMaxMultiplier)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(value))
    } catch {
      // 無法存取 localStorage 時只是不記住選擇
    }
  }, [value])

  return [value, setValue] as const
}
