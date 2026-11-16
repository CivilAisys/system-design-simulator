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

function formatRpsNumber(rps: number): string {
  // 不到 0.5 的正數四捨五入會變成 0，看起來像沒有流量
  if (rps > 0 && rps < 0.5) return '< 1'
  return Math.round(rps).toLocaleString()
}

export function formatOptionalRps(rps: number | null | undefined): string {
  return rps == null ? DASH : formatRps(rps)
}

export function formatMs(ms: number | null | undefined): string {
  return ms == null ? DASH : `${ms.toFixed(1)} ms`
}

// 頻寬和儲存量用十進位單位（1 MB = 1,000,000 bytes），和網路速率的 Gbps、磁碟容量的 GB 一致
const BYTE_RATE_UNITS = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s', 'PB/s']
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
const BIT_UNITS = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps', 'Pbps']

function formatScaled(value: number, units: string[]): string {
  let scaled = value
  let unit = 0
  // 999.5 以上四捨五入會變成「1000」，改用下一個單位
  while (scaled >= 999.5 && unit < units.length - 1) {
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

// 磁碟幾天後會滿；不到 1 天顯示「< 1 天」，避免看起來像 0
export function formatDays(days: number): string {
  if (days < 1) return '< 1 天'
  return days < 100 ? `${days.toFixed(1)} 天` : `${Math.round(days).toLocaleString()} 天`
}

export function formatBitsPerSec(bytesPerSec: number): string {
  return formatScaled(bytesPerSec * 8, BIT_UNITS)
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}
