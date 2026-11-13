import type { Edge, Node, NodeType, Topology } from '@/api/client'
import { NODE_TYPES, type NodeParams } from '@/canvas/catalog'
import { NODE_NUMBER_PARAMS, NODE_PARAM_SPECS } from '@/canvas/params'

const SUPPORTED_VERSION = 1
const CALL_MODES = ['SEQUENTIAL', 'PARALLEL']
// 匯入的檔案沒有 ui 座標時，節點排成一列
const FALLBACK_SPACING = 280

export type ParseResult = { ok: true; topology: Topology } | { ok: false; errors: string[] }

// 匯入檔是第 5 節的 Request 格式。這裡只擋畫布畫不出來、或後端會回 400 的格式錯誤
// （缺欄位、型別不對、id 重複、邊連到不存在的節點）；參數範圍和拓撲規則交給後端驗證，
// 匯入後在錯誤分頁顯示，和使用者自己編輯出來的狀態一樣
export function parseTopology(text: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['不是合法的 JSON'] }
  }
  return toTopology(data)
}

export function toTopology(data: unknown): ParseResult {
  if (!isObject(data)) {
    return { ok: false, errors: ['最外層必須是物件'] }
  }
  if (data.version !== SUPPORTED_VERSION) {
    return { ok: false, errors: [`不支援的版本 ${JSON.stringify(data.version)}，目前只支援 ${SUPPORTED_VERSION}`] }
  }
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    return { ok: false, errors: ['nodes 和 edges 必須是陣列'] }
  }

  const errors: string[] = []
  const nodes: Node[] = []
  const nodeIds = new Set<string>()
  data.nodes.forEach((raw: unknown, i: number) => {
    const node = toNode(raw, i, (message) => errors.push(`nodes[${i}]${describeId(raw)}：${message}`))
    if (!node) return
    if (nodeIds.has(node.id)) {
      errors.push(`nodes[${i}]：節點 id "${node.id}" 重複`)
      return
    }
    nodeIds.add(node.id)
    nodes.push(node)
  })

  // 節點本身格式錯誤時已經報過一次，連到它的邊不再報「不存在的節點」
  const declaredIds = new Set(
    data.nodes.flatMap((raw: unknown) => (isObject(raw) && isNonEmptyString(raw.id) ? [raw.id] : [])),
  )
  const edges: Edge[] = []
  const edgeIds = new Set<string>()
  data.edges.forEach((raw: unknown, i: number) => {
    const edge = toEdge(raw, declaredIds, (message) => errors.push(`edges[${i}]${describeId(raw)}：${message}`))
    if (!edge) return
    if (edgeIds.has(edge.id)) {
      errors.push(`edges[${i}]：邊 id "${edge.id}" 重複`)
      return
    }
    edgeIds.add(edge.id)
    edges.push(edge)
  })

  return errors.length > 0 ? { ok: false, errors } : { ok: true, topology: { version: SUPPORTED_VERSION, nodes, edges } }
}

// 只留下該類型用得到的參數和已知欄位，其他欄位丟掉
function toNode(raw: unknown, index: number, fail: (message: string) => void): Node | null {
  if (!isObject(raw)) {
    fail('必須是物件')
    return null
  }
  const { id, type, name, params, state, ui } = raw
  if (!isNonEmptyString(id)) {
    fail('缺少 id')
    return null
  }
  if (!isNodeType(type)) {
    fail(`type 必須是 ${NODE_TYPES.join('、')} 其中之一`)
    return null
  }
  if (typeof name !== 'string') {
    fail('缺少 name')
    return null
  }
  if (!isObject(params)) {
    fail('缺少 params')
    return null
  }
  if (state !== undefined && state !== 'HEALTHY') {
    fail('state 只能是 HEALTHY')
    return null
  }

  const kept: NodeParams = {}
  for (const param of NODE_NUMBER_PARAMS[type]) {
    const value = params[param]
    if (typeof value !== 'number') {
      fail(`缺少數值參數 params.${param}`)
      return null
    }
    if (NODE_PARAM_SPECS[param].integer && !Number.isInteger(value)) {
      fail(`params.${param} 必須是整數`)
      return null
    }
    kept[param] = value
  }
  if (type === 'SERVICE') {
    if (typeof params.callMode !== 'string' || !CALL_MODES.includes(params.callMode)) {
      fail(`params.callMode 必須是 ${CALL_MODES.join(' 或 ')}`)
      return null
    }
    kept.callMode = params.callMode as NodeParams['callMode']
  }

  let position = { x: index * FALLBACK_SPACING, y: 0 }
  if (ui !== undefined) {
    if (!isObject(ui) || typeof ui.x !== 'number' || typeof ui.y !== 'number') {
      fail('ui 必須是 { x, y } 數字座標')
      return null
    }
    position = { x: ui.x, y: ui.y }
  }

  return { id, type, name, params: kept, ...(state === undefined ? {} : { state }), ui: position }
}

function toEdge(raw: unknown, nodeIds: ReadonlySet<string>, fail: (message: string) => void): Edge | null {
  if (!isObject(raw)) {
    fail('必須是物件')
    return null
  }
  const { id, source, target } = raw
  if (!isNonEmptyString(id)) {
    fail('缺少 id')
    return null
  }
  for (const [field, value] of [['source', source], ['target', target]] as const) {
    if (!isNonEmptyString(value)) {
      fail(`缺少 ${field}`)
      return null
    }
    if (!nodeIds.has(value)) {
      fail(`${field} 指到不存在的節點 "${value}"`)
      return null
    }
  }

  // 省略時為 spec 3.4 的預設值 1，和後端一致
  const numbers = { weight: 1, callsPerRequest: 1, latencyMs: 1 }
  for (const field of ['weight', 'callsPerRequest', 'latencyMs'] as const) {
    const value = raw[field]
    if (value === undefined) continue
    if (typeof value !== 'number') {
      fail(`${field} 必須是數字`)
      return null
    }
    if (field === 'callsPerRequest' && !Number.isInteger(value)) {
      fail('callsPerRequest 必須是整數')
      return null
    }
    numbers[field] = value
  }
  return { id, source: source as string, target: target as string, ...numbers }
}

// 錯誤訊息裡附上 id，使用者比較好在檔案裡找到是哪一個
function describeId(raw: unknown): string {
  return isObject(raw) && isNonEmptyString(raw.id) ? `（id "${raw.id}"）` : ''
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isNodeType(value: unknown): value is NodeType {
  return NODE_TYPES.includes(value as NodeType)
}

// 匯出目前畫布（含 ui 座標）為 JSON 檔下載
export function downloadTopology(topology: Topology, filename = 'topology.json') {
  const blob = new Blob([`${JSON.stringify(topology, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // 下載開始後才釋放
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
