import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@/api/client'
import { initialTopology } from './initialTopology'
import { copyNodes, pasteClip } from './clipboard'

// Users → API → DB
const { nodes, edges } = initialTopology
const usedIds = new Set([...nodes, ...edges].map((item) => item.id))
const names = nodes.map((n) => n.name)

function byId<T extends Node | Edge>(items: T[], id: string): T {
  return items.find((item) => item.id === id)!
}

describe('copyNodes', () => {
  it('沒有選取節點時回傳 null', () => {
    expect(copyNodes(nodes, edges, new Set())).toBeNull()
    expect(copyNodes(nodes, edges, new Set(['e1']))).toBeNull()
  })

  it('只留兩端都被複製的邊', () => {
    const clip = copyNodes(nodes, edges, new Set(['svc-1', 'db-1']))
    expect(clip?.nodes.map((n) => n.id)).toEqual(['svc-1', 'db-1'])
    expect(clip?.edges.map((e) => e.id)).toEqual(['e2'])
  })
})

describe('pasteClip', () => {
  const clip = copyNodes(nodes, edges, new Set(['svc-1', 'db-1']))!

  it('新節點的 id 沒用過、參數相同，位置偏移', () => {
    const pasted = pasteClip(clip, 1, usedIds, names)
    expect(pasted.nodes.map((n) => n.id)).toEqual(['svc-2', 'db-2'])
    const svc = byId(pasted.nodes, 'svc-2')
    const original = byId(nodes, 'svc-1')
    expect(svc.params).toEqual(original.params)
    expect(svc.params).not.toBe(original.params)
    expect(svc.ui).toEqual({ x: original.ui!.x + 40, y: original.ui!.y + 40 })
  })

  it('複製的邊接到新節點，參數相同', () => {
    const pasted = pasteClip(clip, 1, usedIds, names)
    expect(pasted.edges).toEqual([{ ...byId(edges, 'e2'), id: 'e-svc-2-db-2', source: 'svc-2', target: 'db-2' }])
  })

  it('名稱接上沒被用掉的編號，和原本的可以區分', () => {
    const pasted = pasteClip(clip, 1, usedIds, [...names, 'API 2'])
    expect(pasted.nodes.map((n) => n.name)).toEqual(['API 3', 'DB 2'])
  })

  it('從去掉編號的名稱重新編號，名稱本身的數字留著', () => {
    const named = (id: string, name: string): Node => ({ ...byId(nodes, 'db-1'), id, name })
    const source = [named('db-1', 'Postgres 1'), named('db-2', 'S3')]
    const pasted = pasteClip({ nodes: source, edges: [] }, 1, new Set(['db-1', 'db-2']), ['Postgres 1', 'S3'])
    expect(pasted.nodes.map((n) => n.name)).toEqual(['Postgres 2', 'S3 2'])
  })

  it('每貼一次多偏移一點', () => {
    const second = pasteClip(clip, 2, usedIds, names)
    expect(byId(second.nodes, 'db-2').ui).toEqual({ x: 680, y: 80 })
  })

  it('不沿用任何用過的 id（含已刪除的）', () => {
    const pasted = pasteClip(clip, 1, new Set([...usedIds, 'svc-2', 'e-svc-3-db-2']), names)
    expect(pasted.nodes.map((n) => n.id)).toEqual(['svc-3', 'db-2'])
    expect(pasted.edges[0].id).toBe('e-svc-3-db-2-2')
  })
})
