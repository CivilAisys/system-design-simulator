import { describe, expect, it } from 'vitest'
import { createsCycle } from './graph'

const link = (source: string, target: string) => ({ source, target })

describe('createsCycle', () => {
  it('rejects a self-loop', () => {
    expect(createsCycle([], 'a', 'a')).toBe(true)
  })

  it('rejects an edge back to an upstream node', () => {
    expect(createsCycle([link('a', 'b')], 'b', 'a')).toBe(true)
  })

  it('rejects closing a longer loop', () => {
    const edges = [link('a', 'b'), link('b', 'c'), link('c', 'd')]
    expect(createsCycle(edges, 'd', 'a')).toBe(true)
    expect(createsCycle(edges, 'd', 'b')).toBe(true)
  })

  it('allows several paths merging into the same downstream node', () => {
    // a → b → d、a → c → d，再加 a → d 或 b → c 都沒有環
    const edges = [link('a', 'b'), link('a', 'c'), link('b', 'd'), link('c', 'd')]
    expect(createsCycle(edges, 'a', 'd')).toBe(false)
    expect(createsCycle(edges, 'b', 'c')).toBe(false)
  })

  it('allows edges between unrelated branches', () => {
    const edges = [link('a', 'b'), link('c', 'd')]
    expect(createsCycle(edges, 'b', 'c')).toBe(false)
    expect(createsCycle(edges, 'd', 'a')).toBe(false)
  })

  it('terminates when the existing edges already contain a cycle', () => {
    // 匯入的檔案可以有環
    const edges = [link('a', 'b'), link('b', 'a'), link('c', 'd')]
    expect(createsCycle(edges, 'b', 'c')).toBe(false)
    expect(createsCycle(edges, 'd', 'a')).toBe(false)
    expect(createsCycle(edges, 'c', 'a')).toBe(false)
    expect(createsCycle([...edges, link('b', 'c')], 'd', 'a')).toBe(true)
  })
})
