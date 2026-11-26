// 邊上的霓虹燈管和掃光（spec 第 6 節）。顏色、白光數量、速度都看這條邊實際 rps 的對數級距，
// 不和全圖最大的邊比，換一張拓撲也能直接比較

// level 0 和 1 對應的 rps 是 10^0 和 10^MAX_DECADE：1 rps → 0、100 萬 rps → 1
const MAX_DECADE = 6
const SWEEPS = { min: 1, max: 4 }
// 一道白光走完整條邊的秒數：level 0 → 5.44 秒、level 1 → 1.92 秒
const DURATION_S = { slowest: 3.4, fastest: 1.2, scale: 1.6 }
const COLOR = { cold: '#00c2ff', hot: '#7b4dff' }

// 0..1
export function rpsLevel(rps: number): number {
  return Math.min(1, Math.max(0, Math.log10(Math.max(rps, 1)) / MAX_DECADE))
}

export type Beam = {
  level: number
  // 同時在線上的白光數量，平均分布
  sweeps: number
  // 一道白光走完整條邊的秒數。只看流量、不看邊的長度：拖動節點時長度每一幀都在變，
  // 改到時長會讓動畫重新計時、白光亂跳
  durationS: number
  // 低流量青色、高流量電光紫
  color: string
}

// 沒有流量時沒有燈管，只剩底下的淡線
export function beamOf(rps: number): Beam | null {
  if (rps <= 0) {
    return null
  }
  const level = rpsLevel(rps)
  return {
    level,
    sweeps: SWEEPS.min + Math.round((SWEEPS.max - SWEEPS.min) * level),
    durationS: (DURATION_S.slowest - (DURATION_S.slowest - DURATION_S.fastest) * level) * DURATION_S.scale,
    color: `color-mix(in oklab, ${COLOR.hot} ${Math.round(level * 100)}%, ${COLOR.cold})`,
  }
}
