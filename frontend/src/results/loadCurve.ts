import { useEffect, useState } from 'react'
import type { SweepPoint, SweepResult } from '@/api/client'
import { DASH, formatMs, formatRps, formatSuccessRate, formatUtilization } from '@/canvas/format'

// 負載曲線（spec 4.10、第 6 節）：上限倍率只給這三個選項，預設 2 倍
export const MAX_MULTIPLIERS = [2, 5, 10] as const
export type MaxMultiplier = (typeof MAX_MULTIPLIERS)[number]
export const DEFAULT_MAX_MULTIPLIER: MaxMultiplier = 2

const STORAGE_KEY = 'loadCurveMax'

// 存在瀏覽器裡的上限；不是三個選項之一（沒存過、被改過）時用預設值
export function parseMaxMultiplier(stored: string | null): MaxMultiplier {
  return MAX_MULTIPLIERS.find((option) => String(option) === stored) ?? DEFAULT_MAX_MULTIPLIER
}

function readStoredMaxMultiplier(): MaxMultiplier {
  try {
    return parseMaxMultiplier(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_MAX_MULTIPLIER
  }
}

// 上限倍率存在 localStorage，重新整理後保留
export function useStoredMaxMultiplier() {
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

// 延遲線（spec 第 6 節）。ECharts 的折線資料 [x, y]：x 是總 rps；延遲沒有定義（過載）時是 null，線斷在那裡，不畫到 0
export type LatencyLine = {
  name: string
  // 用哪個顏色；read、write 合成一條時用 read 的
  color: 'read' | 'write'
  // 提示裡的名稱
  label: string
  value: (point: SweepPoint) => number | null
  data: [number, number | null][]
}

const read = (point: SweepPoint) => point.endToEndMs.read ?? null
const write = (point: SweepPoint) => point.endToEndMs.write ?? null

// 每一點的 read、write 延遲都相同時合成一條；沒有這個 class 的請求（整條都是 null）時不畫
export function latencyLines(points: readonly SweepPoint[]): LatencyLine[] {
  const line = (name: string, color: LatencyLine['color'], label: string, value: LatencyLine['value']) => ({
    name,
    color,
    label,
    value,
    data: points.map((point): [number, number | null] => [point.totalRps, value(point)]),
  })
  const hasRead = points.some((point) => read(point) != null)
  const hasWrite = points.some((point) => write(point) != null)
  if (hasRead && hasWrite && points.every((point) => sameMs(read(point), write(point)))) {
    return [line('延遲（read、write 相同）', 'read', '延遲', read)]
  }
  return [
    ...(hasRead ? [line('read 延遲', 'read', 'read 延遲', read)] : []),
    ...(hasWrite ? [line('write 延遲', 'write', 'write 延遲', write)] : []),
  ]
}

function sameMs(a: number | null, b: number | null) {
  return a == null || b == null ? a === b : Math.abs(a - b) < 1e-9
}

// 成功率，0–100（%）
export function successSeries(points: readonly SweepPoint[]): [number, number][] {
  return points.map((point) => [point.totalRps, point.successRate * 100])
}

// 延遲軸：從 0 到沒有負載時（第一點）延遲的 3 倍，取整數；read、write 不同時取較大的。
// 不封頂的話，延遲衝到幾秒的拓撲前面整段會被壓成一條平線。超過上限的部分不畫，標出從哪裡開始超出和最高值
export type LatencyAxis = {
  max: number | undefined
  overflow: { totalRps: number; peakMs: number } | null
}

export function latencyAxis(points: readonly SweepPoint[], lines: readonly LatencyLine[]): LatencyAxis {
  const first = points[0]
  const base = first ? maxOf(lines.map((line) => line.value(first))) : null
  if (base == null || base <= 0) return { max: undefined, overflow: null }
  const max = niceCeil(base * 3)
  const over = points.find((point) => (maxOf(lines.map((line) => line.value(point))) ?? 0) > max)
  if (!over) return { max, overflow: null }
  const peakMs = maxOf(points.flatMap((point) => lines.map((line) => line.value(point))))!
  return { max, overflow: { totalRps: over.totalRps, peakMs } }
}

function maxOf(values: readonly (number | null)[]): number | null {
  const defined = values.filter((value): value is number => value != null)
  return defined.length > 0 ? Math.max(...defined) : null
}

// 往上取到最高位數的整數倍：273 → 300、39 → 40
export function niceCeil(value: number): number {
  const step = 10 ** Math.floor(Math.log10(value))
  // 去掉浮點誤差：0.27 → 0.3，不是 0.30000000000000004
  return Number((Math.ceil(value / step) * step).toPrecision(12))
}

// 背景色帶：第一個到 ρ 0.7 的節點到過載之間是黃色，過載之後是紅色；門檻是 null 時不畫。
// row 是標籤在第幾行：兩個都有時過載的放第二行，黃色帶再窄兩個標籤也不會疊在一起
export type CurveBand = { kind: 'warn' | 'overload'; from: number; to: number; label: string; row: 0 | 1 }

export function curveBands(result: SweepResult, nodeName: (id: string) => string): CurveBand[] {
  const end = result.points.at(-1)?.totalRps ?? 0
  const { warn, overload } = result.thresholds
  const bands: CurveBand[] = []
  if (warn && warn.totalRps < (overload?.totalRps ?? end)) {
    bands.push({
      kind: 'warn',
      from: warn.totalRps,
      to: overload?.totalRps ?? end,
      label: `${nodeName(warn.nodeId)} 接近飽和（ρ ≥ 0.7）`,
      row: 0,
    })
  }
  // 過載剛好落在最後一點時沒有寬度，不畫（標籤會擠在右邊界上）
  if (overload && overload.totalRps < end) {
    bands.push({
      kind: 'overload',
      from: overload.totalRps,
      to: end,
      label: `${nodeName(overload.nodeId)} 過載`,
      row: bands.length > 0 ? 1 : 0,
    })
  }
  return bands
}

// 倍率：取兩位小數，去掉多餘的 0。過載前加密的點（7.92、7.96、7.992 倍）要和過載的 8 倍分得出來
export function formatMultiplier(multiplier: number): string {
  if (multiplier === 0 || multiplier >= 0.01) return String(Number(multiplier.toFixed(2)))
  return '< 0.01'
}

const times = (multiplier: number) => `目前的 ${formatMultiplier(multiplier)} 倍`

// 圖上方的一行結論：在哪裡過載（或沒有），在那之前延遲從多少升到多少
export function curveHeadline(
  result: SweepResult,
  lines: readonly LatencyLine[],
  nodeName: (id: string) => string,
): string {
  const { points, thresholds } = result
  const { warn, overload } = thresholds
  const last = points.at(-1)
  if (!last) return ''
  // 「升到」取過載前（沒有過載時是範圍內）最後一個有定義的點
  const before = overload ? points.filter((point) => point.multiplier < overload.multiplier) : points
  const changes = lines
    .map((line) => {
      const values = before.map(line.value).filter((value): value is number => value != null)
      return values.length > 0 ? { label: line.label, from: values[0], to: values.at(-1)! } : null
    })
    .filter((change) => change != null)
  const rise = changes
    .map((change, i) => {
      // 第二條起省略「延遲」：read 延遲從 a 升到 b、write 從 c 升到 d
      const label = i === 0 ? change.label : change.label.replace('延遲', '')
      const [from, to] = [formatMs(change.from), formatMs(change.to)]
      // 顯示出來一樣時（範圍內幾乎不用排隊）不寫「從 91.0 ms 升到 91.0 ms」
      return from === to ? `${label}維持在 ${from}` : `${label}從 ${from} 升到 ${to}`
    })
    .join('、')

  if (overload) {
    const verb = overload.multiplier >= 1 ? '流量放大到' : '流量到'
    const head = `${verb} ${formatRps(overload.totalRps)}（${times(overload.multiplier)}）時 ${nodeName(overload.nodeId)} 過載`
    // 中文接英文（read 延遲）時隔一格
    return rise ? `${head}；在那之前${/^[a-z]/i.test(rise) ? ' ' : ''}${rise}。` : `${head}。`
  }
  const head = `放大到 ${formatRps(last.totalRps)}（${times(last.multiplier)}）都沒有過載`
  if (warn) {
    const near = `${nodeName(warn.nodeId)} 從 ${formatRps(warn.totalRps)}（${formatMultiplier(warn.multiplier)} 倍）起接近飽和`
    return rise ? `${head}；${near}，${rise}。` : `${head}；${near}。`
  }
  return rise ? `${head}，${rise}。` : `${head}。`
}

// 滑過曲線時的提示，一行一項。延遲沒有定義寫「—」（過載）
export function pointTooltip(
  point: SweepPoint,
  lines: readonly LatencyLine[],
  nodeName: (id: string) => string,
): string[] {
  const { busiest } = point
  return [
    `總 rps：${formatRps(point.totalRps)}（${times(point.multiplier)}）`,
    ...lines.map((line) => `${line.label}：${formatMs(line.value(point))}`),
    `成功率：${formatSuccessRate(1 - point.successRate)}`,
    busiest ? `ρ 最高：${nodeName(busiest.nodeId)} ${formatUtilization(busiest.utilization)}` : `ρ 最高：${DASH}`,
  ]
}
