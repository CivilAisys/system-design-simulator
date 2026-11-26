import { useEffect, useState } from 'react'

// 原型：視覺風格比較（prototype/visual-refresh，不合併）。
// current 是現行外觀，paper 是 C 紙感（只有淺色版，選了就強制淺色）
export type Skin = 'current' | 'paper'

export const SKINS: { id: Skin; label: string }[] = [
  { id: 'current', label: '現行' },
  { id: 'paper', label: 'C 紙感' },
]

// 原型：C 紙感的流量光束樣式，見 RpsEdge 和 skins.css
export type Beam = 'neon' | 'neon-thin' | 'neon-multi' | 'neon-trail' | 'neon-led' | 'tube'

export const BEAMS: { id: Beam; label: string; title: string }[] = [
  { id: 'neon', label: '霓虹管', title: '原版：粗細固定，一道白光從頭掃到尾' },
  { id: 'neon-thin', label: '細霓虹', title: '燈管粗細跟著流量，光暈收斂，比較安靜' },
  { id: 'neon-multi', label: '多道掃光', title: '掃光數量就是流量：1～4 道白光同時在線上跑' },
  { id: 'neon-trail', label: '拖尾掃光', title: '掃光後面拖著漸淡的尾巴，方向感最強' },
  { id: 'neon-led', label: 'LED 燈條', title: '一格一格的 LED，亮燈像跑馬燈往前跳' },
  { id: 'tube', label: '細管線', title: '對照：只有液體的細管線' },
]

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 無法存取 localStorage 時只是不記住選擇
  }
}

export function useSkin() {
  const [skin, setSkin] = useState<Skin>(() =>
    readStored(
      'skin',
      SKINS.map((s) => s.id),
      'current',
    ),
  )
  const [beam, setBeam] = useState<Beam>(() =>
    readStored(
      'beam',
      BEAMS.map((b) => b.id),
      'neon',
    ),
  )

  useEffect(() => {
    document.documentElement.dataset.skin = skin
    store('skin', skin)
  }, [skin])

  useEffect(() => {
    document.documentElement.dataset.beam = beam
    store('beam', beam)
  }, [beam])

  return { skin, setSkin, beam, setBeam }
}
