// 邊的粗細和流量粒子（spec 第 6 節）都依「這條邊的 RPS / 畫布上最大的邊 RPS」換算

const WIDTH = { min: 1.5, max: 6 }
// 粒子走完一條邊的秒數和數量
const DURATION_S = { slowest: 3, fastest: 0.8 }
const PARTICLES = { min: 1, max: 5 }

// 0..1；所有邊都沒有流量時為 0
export function flowRatio(rps: number, maxRps: number): number {
  return maxRps > 0 ? rps / maxRps : 0
}

export function edgeWidth(ratio: number): number {
  return WIDTH.min + (WIDTH.max - WIDTH.min) * ratio
}

export type Particles = { count: number; durationS: number }

// 流量越大，粒子越多、走完一條邊越快。沒有流量時不畫粒子。
// 時長只看流量、不看邊的長度：拖動節點時長度每一幀都在變，改到時長會讓 SVG 動畫重新計時、粒子亂跳
export function particles(ratio: number): Particles | null {
  if (ratio <= 0) {
    return null
  }
  return {
    count: Math.round(PARTICLES.min + (PARTICLES.max - PARTICLES.min) * ratio),
    durationS: DURATION_S.slowest - (DURATION_S.slowest - DURATION_S.fastest) * ratio,
  }
}
