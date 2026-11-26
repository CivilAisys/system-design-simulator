import { lazy, Suspense, useMemo } from 'react'
import { RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SimulationResult, Topology } from '@/api/client'
import { STALE_RESULT_NOTE } from '@/canvas/format'
import { cn } from '@/lib/utils'
import { curveHeadline, latencyLines, MAX_MULTIPLIERS, parseMaxMultiplier, useStoredMaxMultiplier } from './loadCurve'
import { useLoadSweep } from './useLoadSweep'

// ECharts 很大，切到這個分頁才載入（同 Sankey）
const LoadCurveChart = lazy(() => import('./LoadCurveChart').then((module) => ({ default: module.LoadCurveChart })))

type LoadCurvePanelProps = {
  // 畫面上的拓撲，用來找節點名稱
  topology: Topology
  // 上次 Run 的結果和它算的拓撲；負載掃描掃的是那一份
  result: SimulationResult
  resultTopology: Topology | null
  stale: boolean
}

// 負載曲線分頁（spec 第 6 節）：只在分頁開著時掛上，關著時不打 API
export function LoadCurvePanel({ topology, result, resultTopology, stale }: LoadCurvePanelProps) {
  const [maxMultiplier, setMaxMultiplier] = useStoredMaxMultiplier()
  const sweep = useLoadSweep(result.valid ? resultTopology : null, maxMultiplier)
  // 只在名稱改了時才換函式：拖動節點時 topology 也會換，圖表不能因此重畫
  const namesKey = JSON.stringify(topology.nodes.map((node) => [node.id, node.name]))
  const nodeName = useMemo(() => {
    const names = new Map<string, string>(JSON.parse(namesKey))
    return (id: string) => names.get(id) ?? id
  }, [namesKey])
  const lines = useMemo(() => (sweep.data ? latencyLines(sweep.data.points) : []), [sweep.data])

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
  } else if (!sweep.data || (sweep.loading && sweep.data.currentRps === 0)) {
    // 還沒有曲線，或上一次沒有流量：等這次的結果，不能先說「沒有流量」
    body = <Message>計算中…</Message>
  } else if (sweep.data.currentRps === 0) {
    body = <Message>Client 的 rps 都是 0，沒有可以放大的流量</Message>
  } else {
    body = (
      <div className={cn('flex h-full flex-col gap-1', (stale || sweep.loading) && 'opacity-50')}>
        <p className="shrink-0 text-sm font-medium">{curveHeadline(sweep.data, lines, nodeName)}</p>
        <div className="min-h-56 flex-1">
          <Suspense>
            <LoadCurveChart sweep={sweep.data} lines={lines} nodeName={nodeName} />
          </Suspense>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">所有 Client 的 rps 一起放大，上限</span>
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
