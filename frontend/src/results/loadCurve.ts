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

// ECharts 的折線資料 [x, y]：x 是總 rps。延遲沒有定義（過載）時是 null，線斷在那裡，不畫到 0
export type CurveSeries = {
  read: [number, number | null][]
  write: [number, number | null][]
  // 成功率，0–100（%）
  success: [number, number][]
}

export function curveSeries(points: readonly SweepPoint[]): CurveSeries {
  return {
    read: points.map((point) => [point.totalRps, point.endToEndMs.read ?? null]),
    write: points.map((point) => [point.totalRps, point.endToEndMs.write ?? null]),
    success: points.map((point) => [point.totalRps, point.successRate * 100]),
  }
}

// 垂直的參考線：目前的 rps，以及第一個到 ρ 0.7、第一個過載的位置（範圍內沒到時不畫）
export type ReferenceLine = { kind: 'current' | 'warn' | 'overload'; totalRps: number; label: string }

export function referenceLines(result: SweepResult, nodeName: (id: string) => string): ReferenceLine[] {
  const lines: ReferenceLine[] = [{ kind: 'current', totalRps: result.currentRps, label: '目前' }]
  const { warn, overload } = result.thresholds
  if (warn) {
    lines.push({
      kind: 'warn',
      totalRps: warn.totalRps,
      label: `${nodeName(warn.nodeId)} ρ 0.7 @ ${formatRps(warn.totalRps)}`,
    })
  }
  if (overload) {
    lines.push({
      kind: 'overload',
      totalRps: overload.totalRps,
      label: `${nodeName(overload.nodeId)} 過載 @ ${formatRps(overload.totalRps)}`,
    })
  }
  return lines
}

// 滑過曲線時的提示，一行一項。延遲沒有定義寫「—」（過載，或沒有這個 class 的請求）
export function pointTooltip(point: SweepPoint, nodeName: (id: string) => string): string[] {
  const lines = [
    `總 rps：${formatRps(point.totalRps)}`,
    `read 延遲：${formatMs(point.endToEndMs.read)}`,
    `write 延遲：${formatMs(point.endToEndMs.write)}`,
    `成功率：${formatSuccessRate(1 - point.successRate)}`,
  ]
  const { busiest } = point
  lines.push(
    busiest ? `ρ 最高：${nodeName(busiest.nodeId)} ${formatUtilization(busiest.utilization)}` : `ρ 最高：${DASH}`,
  )
  return lines
}
