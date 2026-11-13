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
  it('returns null when no node is selected', () => {
    expect(copyNodes(nodes, edges, new Set())).toBeNull()
    expect(copyNodes(nodes, edges, new Set(['e1']))).toBeNull()
  })

  it('keeps only edges between copied nodes', () => {
    const clip = copyNodes(nodes, edges, new Set(['svc-1', 'db-1']))
    expect(clip?.nodes.map((n) => n.id)).toEqual(['svc-1', 'db-1'])
    expect(clip?.edges.map((e) => e.id)).toEqual(['e2'])
  })
})

describe('pasteClip', () => {
  const clip = copyNodes(nodes, edges, new Set(['svc-1', 'db-1']))!

  it('gives unused ids and the same params, offset from the original', () => {
    const pasted = pasteClip(clip, 1, usedIds, names)
    expect(pasted.nodes.map((n) => n.id)).toEqual(['svc-2', 'db-2'])
    const svc = byId(pasted.nodes, 'svc-2')
    const original = byId(nodes, 'svc-1')
    expect(svc.params).toEqual(original.params)
    expect(svc.params).not.toBe(original.params)
    expect(svc.ui).toEqual({ x: original.ui!.x + 40, y: original.ui!.y + 40 })
  })

  it('reconnects copied edges to the new nodes with the same params', () => {
    const pasted = pasteClip(clip, 1, usedIds, names)
    expect(pasted.edges).toEqual([{ ...byId(edges, 'e2'), id: 'e-svc-2-db-2', source: 'svc-2', target: 'db-2' }])
  })

  it('names copies so they can be told apart', () => {
    const pasted = pasteClip(clip, 1, usedIds, [...names, 'API 2'])
    expect(pasted.nodes.map((n) => n.name)).toEqual(['API 3', 'DB 2'])
  })

  it('numbers from the base name and keeps digits that are part of the name', () => {
    const named = (id: string, name: string): Node => ({ ...byId(nodes, 'db-1'), id, name })
    const source = [named('db-1', 'Postgres 1'), named('db-2', 'S3')]
    const pasted = pasteClip({ nodes: source, edges: [] }, 1, new Set(['db-1', 'db-2']), ['Postgres 1', 'S3'])
    expect(pasted.nodes.map((n) => n.name)).toEqual(['Postgres 2', 'S3 2'])
  })

  it('offsets each repeated paste further', () => {
    const second = pasteClip(clip, 2, usedIds, names)
    expect(byId(second.nodes, 'db-2').ui).toEqual({ x: 680, y: 80 })
  })

  it('never reuses an id, including deleted ones', () => {
    const pasted = pasteClip(clip, 1, new Set([...usedIds, 'svc-2', 'e-svc-3-db-2']), names)
    expect(pasted.nodes.map((n) => n.id)).toEqual(['svc-3', 'db-2'])
    expect(pasted.edges[0].id).toBe('e-svc-3-db-2-2')
  })
})
