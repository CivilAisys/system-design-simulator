import { describe, expect, it } from 'vitest'
import { canConnect, connectedFirst, createsCycle, unconnectedNodeIds } from './graph'

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
    // 讀入的存檔可以有環
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

describe('unconnectedNodeIds', () => {
  const nodes = [
    { id: 'c', type: 'CLIENT' as const },
    { id: 'svc', type: 'SERVICE' as const },
    { id: 'db', type: 'DATABASE' as const },
    { id: 'cache', type: 'CACHE' as const },
    { id: 'tail', type: 'CACHE' as const },
  ]

  it('沒有任何邊的節點是未連線', () => {
    expect(unconnectedNodeIds(nodes, [edge('c', 'svc'), edge('svc', 'db'), edge('svc', 'tail')])).toEqual(
      new Set(['cache']),
    )
  })

  it('只有入邊或只有出邊都算有連線', () => {
    expect(unconnectedNodeIds(nodes, [edge('c', 'svc'), edge('cache', 'db'), edge('svc', 'tail')])).toEqual(
      new Set(),
    )
  })

  it('沒連線的 Client 不算，它照驗證錯誤顯示', () => {
    expect(unconnectedNodeIds(nodes, [])).toEqual(new Set(['svc', 'db', 'cache', 'tail']))
  })
})

describe('connectedFirst', () => {
  it('未連線的節點移到最後，其他照原本的順序', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    expect(connectedFirst(nodes, new Set(['a', 'c'])).map((n) => n.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})
