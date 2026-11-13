import { describe, expect, it } from 'vitest'
import type { Topology } from '@/api/client'
import { initialTopology } from '@/canvas/initialTopology'
import { parseTopology, serializeTopology, toTopology } from './topologyFile'

// 每種類型各一個節點，邊涵蓋三種出邊參數（weight、callsPerRequest、只有 latencyMs）
function validFile() {
  return {
    version: 1,
    nodes: [
      { id: 'client', type: 'CLIENT', name: 'Users', params: { rps: 1000, readRatio: 0.9 }, ui: { x: 0, y: 0 } },
      {
        id: 'lb',
        type: 'LOAD_BALANCER',
        name: 'LB',
        params: { instances: 1, concurrency: 1000, serviceTimeMs: 1 },
        state: 'HEALTHY',
        ui: { x: 300, y: 0 },
      },
      {
        id: 'svc',
        type: 'SERVICE',
        name: 'API',
        params: { instances: 2, concurrency: 200, serviceTimeMs: 50, callMode: 'PARALLEL' },
        ui: { x: 600, y: 0 },
      },
      {
        id: 'cache',
        type: 'CACHE',
        name: 'Redis',
        params: { instances: 1, concurrency: 1, serviceTimeMs: 0.01, hitRatio: 0.8 },
        ui: { x: 900, y: -100 },
      },
      {
        id: 'db',
        type: 'DATABASE',
        name: 'DB',
        params: { instances: 1, concurrency: 100, serviceTimeMs: 10 },
        ui: { x: 900, y: 100 },
      },
    ],
    edges: [
      { id: 'e1', source: 'client', target: 'lb', weight: 1, callsPerRequest: 1, latencyMs: 1 },
      { id: 'e2', source: 'lb', target: 'svc', weight: 2, callsPerRequest: 1, latencyMs: 0.5 },
      { id: 'e3', source: 'svc', target: 'cache', weight: 1, callsPerRequest: 3, latencyMs: 1 },
      { id: 'e4', source: 'svc', target: 'db', weight: 1, callsPerRequest: 1, latencyMs: 2 },
      { id: 'e5', source: 'cache', target: 'db', weight: 1, callsPerRequest: 1, latencyMs: 1 },
    ],
  }
}

type File = ReturnType<typeof validFile>

// 改一份合法檔案後匯入，回傳錯誤訊息（合法時測試失敗）
function errorsOf(edit: (file: File) => unknown): string[] {
  const file = validFile()
  const result = toTopology(edit(file) ?? file)
  if (result.ok) {
    throw new Error('預期匯入失敗，但通過了')
  }
  return result.errors
}

function topologyOf(data: unknown): Topology {
  const result = toTopology(data)
  if (!result.ok) {
    throw new Error(`預期匯入成功：${result.errors.join('；')}`)
  }
  return result.topology
}

describe('合法的檔案', () => {
  it('原樣讀入節點和邊', () => {
    expect(topologyOf(validFile())).toEqual(validFile())
  })

  it('丟掉未知欄位和該類型用不到的參數', () => {
    const file = validFile() as Record<string, unknown> & File
    file.extra = true
    Object.assign(file.nodes[0], { color: 'red' })
    Object.assign(file.nodes[0].params, { instances: 3, callMode: 'SEQUENTIAL' })
    Object.assign(file.edges[0], { label: 'x' })

    const topology = topologyOf(file)
    expect(topology).toEqual(validFile())
  })

  it('邊省略的數值參數用預設值 1', () => {
    const topology = topologyOf({
      ...validFile(),
      edges: [{ id: 'e1', source: 'client', target: 'lb' }],
    })
    expect(topology.edges).toEqual([{ id: 'e1', source: 'client', target: 'lb', weight: 1, callsPerRequest: 1, latencyMs: 1 }])
  })
})

describe('格式錯誤', () => {
  it('不是 JSON', () => {
    expect(parseTopology('{ nodes: ')).toEqual({ ok: false, errors: ['不是合法的 JSON'] })
  })

  it('最外層不是物件', () => {
    expect(toTopology([])).toEqual({ ok: false, errors: ['最外層必須是物件'] })
    expect(toTopology(null)).toEqual({ ok: false, errors: ['最外層必須是物件'] })
  })

  it.each([2, '1', undefined])('不支援的版本 %j', (version) => {
    expect(errorsOf((f) => ({ ...f, version }))).toEqual([
      `不支援的版本 ${JSON.stringify(version)}，目前只支援 1`,
    ])
  })

  it('nodes 或 edges 不是陣列', () => {
    expect(errorsOf((f) => ({ ...f, nodes: {} }))).toEqual(['nodes 和 edges 必須是陣列'])
    expect(errorsOf((f) => ({ ...f, edges: undefined }))).toEqual(['nodes 和 edges 必須是陣列'])
  })

  describe('節點', () => {
    it('不是物件', () => {
      expect(errorsOf((f) => void f.nodes.push('db' as never))).toEqual(['nodes[5]：必須是物件'])
    })

    it.each([
      ['id', '缺少 id'],
      ['name', '缺少 name'],
      ['params', '缺少 params'],
    ] as const)('缺少 %s', (field, message) => {
      const errors = errorsOf((f) => {
        // 拿掉的是 Database，沒有出邊，連到它的邊只在缺 id 時另外報錯
        delete (f.nodes[4] as Partial<File['nodes'][4]>)[field]
      })
      const prefix = field === 'id' ? 'nodes[4]' : 'nodes[4]（id "db"）'
      expect(errors[0]).toBe(`${prefix}：${message}`)
    })

    it('type 不是已知的類型', () => {
      expect(errorsOf((f) => void (f.nodes[4].type = 'QUEUE'))).toEqual([
        'nodes[4]（id "db"）：type 必須是 CLIENT、LOAD_BALANCER、SERVICE、CACHE、DATABASE 其中之一',
      ])
    })

    it('缺少數值參數', () => {
      expect(errorsOf((f) => void delete (f.nodes[3].params as Partial<File['nodes'][3]['params']>).hitRatio)).toEqual([
        'nodes[3]（id "cache"）：缺少數值參數 params.hitRatio（或數值太大）',
      ])
    })

    it('數值參數型別不對', () => {
      expect(errorsOf((f) => void Object.assign(f.nodes[0].params, { rps: '1000' }))).toEqual([
        'nodes[0]（id "client"）：缺少數值參數 params.rps（或數值太大）',
      ])
    })

    it('數值溢位成 Infinity', () => {
      const text = JSON.stringify(validFile()).replace('"rps":1000', '"rps":1e400')
      expect(parseTopology(text)).toEqual({
        ok: false,
        errors: ['nodes[0]（id "client"）：缺少數值參數 params.rps（或數值太大）'],
      })
    })

    it('整數參數不是整數', () => {
      expect(errorsOf((f) => void (f.nodes[2].params.instances = 1.5))).toEqual([
        'nodes[2]（id "svc"）：params.instances 必須是整數',
      ])
    })

    it('Service 的 callMode 不合法', () => {
      expect(errorsOf((f) => void (f.nodes[2].params.callMode = 'ASYNC'))).toEqual([
        'nodes[2]（id "svc"）：params.callMode 必須是 SEQUENTIAL 或 PARALLEL',
      ])
    })

    it('state 不是 HEALTHY', () => {
      expect(errorsOf((f) => void (f.nodes[1].state = 'DOWN'))).toEqual(['nodes[1]（id "lb"）：state 只能是 HEALTHY'])
    })

    it.each([[{ x: 1 }], [{ x: '1', y: 2 }], [[1, 2]]])('ui 不是數字座標 %j', (ui) => {
      expect(errorsOf((f) => void Object.assign(f.nodes[0], { ui }))).toEqual([
        'nodes[0]（id "client"）：ui 必須是 { x, y } 數字座標',
      ])
    })

    it('id 重複', () => {
      expect(errorsOf((f) => void f.nodes.push({ ...f.nodes[4], name: 'DB 2' }))).toEqual(['nodes[5]：節點 id "db" 重複'])
    })
  })

  describe('邊', () => {
    it('不是物件', () => {
      expect(errorsOf((f) => void f.edges.push(null as never))).toEqual(['edges[5]：必須是物件'])
    })

    it.each(['id', 'source', 'target'] as const)('缺少 %s', (field) => {
      const errors = errorsOf((f) => void delete (f.edges[0] as Partial<File['edges'][0]>)[field])
      const prefix = field === 'id' ? 'edges[0]' : 'edges[0]（id "e1"）'
      expect(errors).toEqual([`${prefix}：缺少 ${field}`])
    })

    it.each(['weight', 'latencyMs', 'callsPerRequest'] as const)('%s 不是數字', (field) => {
      expect(errorsOf((f) => void Object.assign(f.edges[0], { [field]: '1' }))).toEqual([
        `edges[0]（id "e1"）：${field} 必須是數字（或數值太大）`,
      ])
    })

    it('callsPerRequest 不是整數', () => {
      expect(errorsOf((f) => void (f.edges[2].callsPerRequest = 1.5))).toEqual([
        'edges[2]（id "e3"）：callsPerRequest 必須是整數',
      ])
    })

    it('id 重複', () => {
      expect(errorsOf((f) => void f.edges.push({ ...f.edges[0], source: 'lb', target: 'cache' }))).toEqual([
        'edges[5]：邊 id "e1" 重複',
      ])
    })
  })

  it('所有錯誤一起回報', () => {
    const errors = errorsOf((f) => {
      f.nodes[2].params.instances = 0.5
      f.edges[0].latencyMs = 'slow' as never
    })
    expect(errors).toEqual([
      'nodes[2]（id "svc"）：params.instances 必須是整數',
      // svc 格式錯誤已經報過，連到它的 e2～e4 不再報「不存在的節點」
      'edges[0]（id "e1"）：latencyMs 必須是數字（或數值太大）',
    ])
  })
})

describe('畫不出來的邊', () => {
  it('連到不存在的節點', () => {
    expect(errorsOf((f) => void (f.edges[4].target = 'db-2'))).toEqual([
      'edges[4]（id "e5"）：target 指到不存在的節點 "db-2"',
    ])
    expect(errorsOf((f) => void (f.edges[4].source = 'cache-2'))).toEqual([
      'edges[4]（id "e5"）：source 指到不存在的節點 "cache-2"',
    ])
  })

  it('連回自己', () => {
    expect(errorsOf((f) => void (f.edges[2].target = 'svc'))).toEqual(['edges[2]（id "e3"）：不能連回自己'])
  })

  it('同一對節點有兩條邊', () => {
    expect(errorsOf((f) => void f.edges.push({ ...f.edges[3], id: 'e6' }))).toEqual([
      'edges[5]（id "e6"）：svc → db 已經有一條邊，同一對節點只能有一條',
    ])
  })

  it('反方向的邊不算重複', () => {
    // 會形成環，交給後端驗證
    const file = validFile()
    file.edges.push({ ...file.edges[4], id: 'e6', source: 'svc', target: 'lb' })
    expect(toTopology(file).ok).toBe(true)
  })

  it('連進 Client', () => {
    expect(errorsOf((f) => void (f.edges[1].target = 'client'))).toEqual([
      'edges[1]（id "e2"）：Client 不能有上游（target 是 "client"）',
    ])
  })

  it('從 Database 連出', () => {
    expect(errorsOf((f) => void Object.assign(f.edges[4], { source: 'db', target: 'cache' }))).toEqual([
      'edges[4]（id "e5"）：Database 不能有下游（source 是 "db"）',
    ])
  })
})

describe('沒有座標的節點', () => {
  it('排成一列，放在有座標的節點下方', () => {
    const file = validFile()
    delete (file.nodes[1] as Partial<File['nodes'][1]>).ui
    delete (file.nodes[2] as Partial<File['nodes'][2]>).ui
    file.nodes[0].ui = { x: -50, y: 0 }

    const positions = topologyOf(file).nodes.map((n) => n.ui)
    // 最低的節點 y = 100，往下 280；從最左邊的 x = -50 開始，間隔 280
    expect(positions).toEqual([
      { x: -50, y: 0 },
      { x: -50, y: 380 },
      { x: 230, y: 380 },
      { x: 900, y: -100 },
      { x: 900, y: 100 },
    ])
  })

  it('全部都沒有座標時從原點開始排', () => {
    const file = validFile()
    file.nodes.forEach((n) => delete (n as Partial<typeof n>).ui)

    const positions = topologyOf(file).nodes.map((n) => n.ui)
    expect(positions).toEqual([0, 280, 560, 840, 1120].map((x) => ({ x, y: 0 })))
  })

  it('有座標的節點都在右邊時，從 x = 0 開始排', () => {
    const file = validFile()
    delete (file.nodes[0] as Partial<File['nodes'][0]>).ui

    expect(topologyOf(file).nodes[0].ui).toEqual({ x: 0, y: 380 })
  })
})

describe('匯出再匯入', () => {
  it.each([
    ['合法檔案', topologyOf(validFile())],
    ['開啟時的畫布', initialTopology],
  ])('%s 得到相同的拓撲', (_, topology) => {
    expect(parseTopology(serializeTopology(topology))).toEqual({ ok: true, topology })
  })
})
