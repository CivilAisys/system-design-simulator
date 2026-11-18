import type { ClassRates } from '@/api/client'

// null 代表「不適用」或「無定義」，不能當成 0 顯示
export const DASH = '—'

export function formatUtilization(rho: number | null | undefined): string {
  return rho == null ? DASH : rho.toFixed(2)
}

export function formatRps(rps: number): string {
  return `${formatRpsNumber(rps)} rps`
}

// read、write 各自的到達率，接在總和下面，所以不重複單位
export function formatClassRates({ read, write }: ClassRates): string {
  return `read ${formatRpsNumber(read)}・write ${formatRpsNumber(write)}`
}

// 滑鼠提示的第一行：拓撲在那次 Run 之後改過，提示裡的數字可能對不上
export const STALE_RESULT_NOTE = '（結果已過期，按 Run 重新計算）'

// 滑鼠移到邊的 rps 標籤上的提示。只有一行、沒有總和，所以兩個數字都帶單位
export function classRatesTitle({ read, write }: ClassRates, stale: boolean | undefined): string {
  const line = `read ${formatRps(read)}・write ${formatRps(write)}`
  return stale ? `${STALE_RESULT_NOTE}\n${line}` : line
}

export function formatRpsNumber(rps: number): string {
  // 不到 0.5 的正數四捨五入會變成 0，看起來像沒有流量
  if (rps > 0 && rps < 0.5) return '< 1'
  return Math.round(rps).toLocaleString()
}

export function formatOptionalRps(rps: number | null | undefined): string {
  return rps == null ? DASH : formatRps(rps)
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return DASH
  if (ms === 0) return '0 ms'
  // 小於 0.1 ms（例如 Cache 預設的 0.01 ms）取一位小數會變成 0.0，改用兩位有效數字。
  // 門檻是 0.095：再大一點兩位有效數字會變成「0.10」，和 0.1 以上的「0.1」不一致
  return ms < 0.095 ? `${ms.toPrecision(2)} ms` : `${ms.toFixed(1)} ms`
}

// 頻寬和儲存量用十進位單位（1 MB = 1,000,000 bytes），和網路速率的 Gbps、磁碟容量的 GB 一致
const BYTE_RATE_UNITS = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s', 'PB/s']
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
const BIT_UNITS = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps', 'Pbps']

// 999.5 以上四捨五入會變成「1000」，改用下一個單位
const NEXT_UNIT_FROM = 999.5

function formatScaled(value: number, units: string[]): string {
  // 單位最大到 P，超過時用最小單位的科學記號（例如 1.2e18 B/s），不再印出一長串整數
  if (value >= NEXT_UNIT_FROM * 1000 ** (units.length - 1)) return `${value.toExponential(1).replace('e+', 'e')} ${units[0]}`
  let scaled = value
  let unit = 0
  while (scaled >= NEXT_UNIT_FROM && unit < units.length - 1) {
    scaled /= 1000
    unit++
  }
  // 最小單位顯示整數；其他保留 3 位有效數字
  const digits = unit === 0 || scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
  return `${scaled.toFixed(digits)} ${units[unit]}`
}

export function formatBytesPerSec(bytesPerSec: number): string {
  return formatScaled(bytesPerSec, BYTE_RATE_UNITS)
}

export function formatBytes(bytes: number): string {
  return formatScaled(bytes, BYTE_UNITS)
}

// 磁碟幾天後會滿，是估計值所以加「約」；不到 1 天顯示「不到 1 天」，避免看起來像 0
export function formatDays(days: number): string {
  if (days < 1) return '不到 1 天'
  return days < 100 ? `約 ${days.toFixed(1)} 天` : `約 ${Math.round(days).toLocaleString()} 天`
}

export function formatBitsPerSec(bytesPerSec: number): string {
  return formatScaled(bytesPerSec * 8, BIT_UNITS)
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}

// 成功率 = 1 − dropRate。丟棄很少時取一位小數會變成「100.0%」，看起來像沒有丟棄
export function formatSuccessRate(dropRate: number): string {
  const text = formatPercent(1 - dropRate)
  return dropRate > 0 && text === '100.0%' ? '> 99.9%' : text
}
