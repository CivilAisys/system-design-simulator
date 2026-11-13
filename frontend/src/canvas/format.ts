// null 代表「不適用」或「無定義」，不能當成 0 顯示
export const DASH = '—'

export function formatUtilization(rho: number | null | undefined): string {
  return rho == null ? DASH : rho.toFixed(2)
}

export function formatRps(rps: number): string {
  // 不到 0.5 的正數四捨五入會變成 0，看起來像沒有流量
  if (rps > 0 && rps < 0.5) return '< 1 rps'
  return `${Math.round(rps).toLocaleString()} rps`
}

export function formatOptionalRps(rps: number | null | undefined): string {
  return rps == null ? DASH : formatRps(rps)
}

export function formatMs(ms: number | null | undefined): string {
  return ms == null ? DASH : `${ms.toFixed(1)} ms`
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}
