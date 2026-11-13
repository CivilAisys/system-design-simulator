import { describe, expect, it } from 'vitest'
import { canConnect, createsCycle } from './graph'

const edge = (source: string, target: string) => ({ source, target })

describe('createsCycle', () => {
  it('自己連自己是環', () => {
    expect(createsCycle([], 'a', 'a')).toBe(true)
  })

  it('連回上游是環', () => {
    expect(createsCycle([edge('a', 'b')], 'b', 'a')).toBe(true)
  })

  it('繞好幾個節點回來也是環', () => {
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')]
    expect(createsCycle(edges, 'd', 'a')).toBe(true)
    expect(createsCycle(edges, 'd', 'b')).toBe(true)
  })

  it('多條路徑匯到同一個下游不是環', () => {
    // a → b → d、a → c → d，再加 a → d 或 b → c 都沒有環
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')]
    expect(createsCycle(edges, 'a', 'd')).toBe(false)
    expect(createsCycle(edges, 'b', 'c')).toBe(false)
  })

  it('連到不相干的分支不是環', () => {
    const edges = [edge('a', 'b'), edge('c', 'd')]
    expect(createsCycle(edges, 'b', 'c')).toBe(false)
    expect(createsCycle(edges, 'd', 'a')).toBe(false)
  })

  it('現有的邊已經有環時照樣判斷，不會無限迴圈', () => {
    // 匯入的檔案可以有環
    const edges = [edge('a', 'b'), edge('b', 'a'), edge('c', 'd')]
    expect(createsCycle(edges, 'b', 'c')).toBe(false)
    expect(createsCycle(edges, 'd', 'a')).toBe(false)
    expect(createsCycle(edges, 'c', 'a')).toBe(false)
    expect(createsCycle([...edges, edge('b', 'c')], 'd', 'a')).toBe(true)
  })
})

describe('canConnect', () => {
  const edges = [edge('a', 'b'), edge('b', 'c')]

  it('擋掉重複的邊', () => {
    expect(canConnect(edges, 'a', 'b')).toBe(false)
  })

  it('擋掉會成環的邊', () => {
    expect(canConnect(edges, 'c', 'a')).toBe(false)
    expect(canConnect(edges, 'a', 'a')).toBe(false)
  })

  it('其他連線可以', () => {
    expect(canConnect(edges, 'a', 'c')).toBe(true)
    expect(canConnect(edges, 'c', 'd')).toBe(true)
  })
})
