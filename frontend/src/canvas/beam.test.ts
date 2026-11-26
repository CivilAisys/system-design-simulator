import { describe, expect, it } from 'vitest'
import { beamOf, rpsLevel } from './beam'

describe('流量級距', () => {
  it.each([
    [1, 0],
    [100, 1 / 3],
    [10_000, 2 / 3],
    [1_000_000, 1],
  ])('%d rps 的 level 是 %d', (rps, level) => {
    expect(rpsLevel(rps)).toBeCloseTo(level)
  })

  it('小於 1 rps 算 0，超過 100 萬 rps 算 1', () => {
    expect(rpsLevel(0.5)).toBe(0)
    expect(rpsLevel(5_000_000)).toBe(1)
  })

  it.each([
    [1, 1],
    [100, 2],
    [10_000, 3],
    [1_000_000, 4],
  ])('%d rps 有 %d 道白光', (rps, sweeps) => {
    expect(beamOf(rps)?.sweeps).toBe(sweeps)
  })

  it('流量越大，白光走完一條邊越快', () => {
    expect(beamOf(1)?.durationS).toBeCloseTo(3.4 * 1.6)
    expect(beamOf(1_000_000)?.durationS).toBeCloseTo(1.2 * 1.6)
  })

  it('顏色從青色混到電光紫', () => {
    expect(beamOf(1)?.color).toBe('color-mix(in oklab, #7b4dff 0%, #00c2ff)')
    expect(beamOf(1_000_000)?.color).toBe('color-mix(in oklab, #7b4dff 100%, #00c2ff)')
  })

  it('0 rps 沒有燈管', () => {
    expect(beamOf(0)).toBeNull()
  })
})
