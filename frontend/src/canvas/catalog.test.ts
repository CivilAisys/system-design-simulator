import { describe, expect, it } from 'vitest'
import { canFeed, newEdgeRequestClass, newNode, NODE_KINDS, NODE_TYPES, PALETTE } from './catalog'
import { checkNodeParam, NODE_CHOICE_SPECS } from './params'

describe('Node type 定義', () => {
  it('元件面板列出每一種 type', () => {
    expect([...NODE_TYPES].sort()).toEqual(Object.keys(NODE_KINDS).sort())
  })

  it.each(NODE_TYPES)('%s 的預設值剛好涵蓋它的參數，而且都合法', (type) => {
    const { defaults, numberParams, choiceParams } = NODE_KINDS[type]
    expect(Object.keys(defaults).sort()).toEqual([...numberParams, ...choiceParams].sort())
    for (const param of numberParams) {
      expect(checkNodeParam(defaults, param, defaults[param]!)).toBeNull()
    }
    for (const param of choiceParams) {
      expect(NODE_CHOICE_SPECS[param].options.map((o) => o.value)).toContain(defaults[param])
    }
  })
})

describe('元件面板', () => {
  it('每個 type 一項，preset 緊接在它的 type 後面，id 不重複', () => {
    expect(PALETTE.map((item) => item.id)).toEqual([
      'CLIENT',
      'LOAD_BALANCER',
      'SERVICE',
      'CACHE',
      'REDIS_CLUSTER',
      'CDN',
      'DATABASE',
      'READ_REPLICA',
      'OBJECT_STORAGE',
      'RATE_LIMITER',
      'EXTERNAL_API',
      'MESSAGE_QUEUE',
    ])
  })

  it('Redis Cluster 是 shards = 3 的 Cache，其他參數用 Cache 的預設值', () => {
    const cluster = PALETTE.find((item) => item.id === 'REDIS_CLUSTER')!
    const node = newNode(cluster, new Set(['cache-1']), { x: 0, y: 0 })

    expect(node).toMatchObject({ id: 'cache-2', type: 'CACHE', name: 'Redis Cluster 2' })
    expect(node.params).toEqual({ ...NODE_KINDS.CACHE.defaults, shards: 3 })
    for (const param of NODE_KINDS.CACHE.numberParams) {
      expect(checkNodeParam(node.params, param, node.params[param]!)).toBeNull()
    }
  })
})

describe('type 的連線限制', () => {
  it('Database 只能連到 Read Replica', () => {
    expect(canFeed('DATABASE', 'READ_REPLICA')).toBe(true)
    expect(canFeed('DATABASE', 'CACHE')).toBe(false)
  })

  it('Message Queue 只能連到 Service（consumer group）', () => {
    expect(canFeed('MESSAGE_QUEUE', 'SERVICE')).toBe(true)
    expect(canFeed('MESSAGE_QUEUE', 'DATABASE')).toBe(false)
  })

  it('沒有限制的 type 可以連到任何 type', () => {
    expect(canFeed('SERVICE', 'READ_REPLICA')).toBe(true)
    expect(canFeed('SERVICE', 'DATABASE')).toBe(true)
  })
})

describe('新邊的 requestClass', () => {
  it('Service 連到 Read Replica 預設只送 read', () => {
    expect(newEdgeRequestClass('SERVICE', 'READ_REPLICA')).toBe('READ')
  })

  it('其他邊預設 ALL', () => {
    expect(newEdgeRequestClass('SERVICE', 'DATABASE')).toBe('ALL')
    expect(newEdgeRequestClass('LOAD_BALANCER', 'READ_REPLICA')).toBe('ALL')
    expect(newEdgeRequestClass('DATABASE', 'READ_REPLICA')).toBe('ALL')
  })
})
