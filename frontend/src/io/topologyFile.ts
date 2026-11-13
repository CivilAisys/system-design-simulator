import type { Edge, Node, NodeType, Topology } from '@/api/client'
import { hasInput, hasOutput, NODE_KINDS, NODE_TYPES, type NodeParams } from '@/canvas/catalog'
import { NODE_NUMBER_PARAMS, NODE_PARAM_SPECS } from '@/canvas/params'

const SUPPORTED_VERSION = 1
const CALL_MODES = ['SEQUENTIAL', 'PARALLEL']
// 匯入的檔案沒有 ui 座標時，這些節點排成一列，放在有座標的節點下方
const FALLBACK_SPACING = 280

export type ParseResult = { ok: true; topology: Topology } | { ok: false; errors: string[] }

// 匯入檔是第 5 節的 Request 格式。這裡擋三種錯誤：
// - 後端會回 400 的格式錯誤（缺欄位、型別不對、數值溢位成 Infinity、id 重複）
// - 畫布畫不出來或選不到的邊（連到不存在的節點、連回自己、重複的邊、連進 Client、從 Database 連出），
//   編輯器本身也不允許建立這些邊
// 參數範圍和其他拓撲規則交給後端驗證，匯入後在錯誤分頁顯示，和使用者自己編輯出來的狀態一樣
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
  // 檔案裡出現過的節點 id → 類型（節點本身格式錯誤時是 null）。
  // 格式錯誤的節點已經報過一次，連到它的邊不再報「不存在的節點」
  const declared = new Map<string, NodeType | null>()
  data.nodes.forEach((raw: unknown, i: number) => {
    const id = rawId(raw)
    if (id != null && declared.has(id)) {
      errors.push(`nodes[${i}]：節點 id "${id}" 重複`)
      return
    }
    const node = toNode(raw, (message) => errors.push(`nodes[${i}]${describeId(id)}：${message}`))
    if (id != null) declared.set(id, node?.type ?? null)
    if (node) nodes.push(node)
  })

  const edges: Edge[] = []
  const edgeIds = new Set<string>()
  const connected = new Set<string>()
  data.edges.forEach((raw: unknown, i: number) => {
    const id = rawId(raw)
    if (id != null && edgeIds.has(id)) {
      errors.push(`edges[${i}]：邊 id "${id}" 重複`)
      return
    }
    if (id != null) edgeIds.add(id)
    const edge = toEdge(raw, declared, (message) => errors.push(`edges[${i}]${describeId(id)}：${message}`))
    if (!edge) return
    // 疊在一起的邊畫布上只看得到一條
    const pair = JSON.stringify([edge.source, edge.target])
    if (connected.has(pair)) {
      errors.push(`edges[${i}]${describeId(id)}：${edge.source} → ${edge.target} 已經有一條邊，同一對節點只能有一條`)
      return
    }
    connected.add(pair)
    edges.push(edge)
  })

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, topology: { version: SUPPORTED_VERSION, nodes: placeUnpositioned(nodes), edges } }
}

// 只留下該類型用得到的參數和已知欄位，其他欄位丟掉。沒有 ui 時先不給座標，見 placeUnpositioned
function toNode(raw: unknown, fail: (message: string) => void): Node | null {
  if (!isObject(raw)) {
    fail('必須是物件')
    return null
  }
  const id = rawId(raw)
  const { type, name, params, state, ui } = raw
  if (id == null) {
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
    if (!isFiniteNumber(value)) {
      fail(`缺少數值參數 params.${param}（或數值太大）`)
      return null
    }
    if (NODE_PARAM_SPECS[param].integer) {
      const error = checkInteger(value)
      if (error) {
        fail(`params.${param} ${error}`)
        return null
      }
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

  let position: Node['ui']
  if (ui !== undefined) {
    if (!isObject(ui) || !isFiniteNumber(ui.x) || !isFiniteNumber(ui.y)) {
      fail('ui 必須是 { x, y } 數字座標')
      return null
    }
    position = { x: ui.x, y: ui.y }
  }

  return {
    id,
    type,
    name,
    params: kept,
    ...(state === undefined ? {} : { state }),
    ...(position === undefined ? {} : { ui: position }),
  }
}

function toEdge(
  raw: unknown,
  declared: ReadonlyMap<string, NodeType | null>,
  fail: (message: string) => void,
): Edge | null {
  if (!isObject(raw)) {
    fail('必須是物件')
    return null
  }
  const id = rawId(raw)
  if (id == null) {
    fail('缺少 id')
    return null
  }
  const source = endpoint(raw, 'source', declared, fail)
  const target = source == null ? null : endpoint(raw, 'target', declared, fail)
  if (source == null || target == null) {
    return null
  }
  // 和編輯器的連線規則一致（useTopologyEditor 的 isValidConnection、SimNode 的 handle）。
  // 只有經過其他節點的環例外：可以匯入，Run 之後顯示 CYCLE_DETECTED，刪掉邊就能修好
  if (source === target) {
    fail('不能連回自己')
    return null
  }
  const sourceType = declared.get(source)
  const targetType = declared.get(target)
  if (sourceType != null && !hasOutput(sourceType)) {
    fail(`${NODE_KINDS[sourceType].label} 不能有下游（source 是 "${source}"）`)
    return null
  }
  if (targetType != null && !hasInput(targetType)) {
    fail(`${NODE_KINDS[targetType].label} 不能有上游（target 是 "${target}"）`)
    return null
  }

  // 省略時為 spec 3.4 的預設值 1，和後端一致
  const numbers = { weight: 1, callsPerRequest: 1, latencyMs: 1 }
  for (const field of ['weight', 'callsPerRequest', 'latencyMs'] as const) {
    const value = raw[field]
    if (value === undefined) continue
    if (!isFiniteNumber(value)) {
      fail(`${field} 必須是數字（或數值太大）`)
      return null
    }
    if (field === 'callsPerRequest') {
      const error = checkInteger(value)
      if (error) {
        fail(`callsPerRequest ${error}`)
        return null
      }
    }
    numbers[field] = value
  }
  return { id, source, target, ...numbers }
}

function endpoint(
  raw: Record<string, unknown>,
  field: 'source' | 'target',
  declared: ReadonlyMap<string, NodeType | null>,
  fail: (message: string) => void,
): string | null {
  const value = raw[field]
  if (!isNonEmptyString(value)) {
    fail(`缺少 ${field}`)
    return null
  }
  if (!declared.has(value)) {
    fail(`${field} 指到不存在的節點 "${value}"`)
    return null
  }
  return value
}

// 沒有座標的節點排在所有有座標的節點下方一列，不會和它們重疊
function placeUnpositioned(nodes: Node[]): Node[] {
  const placedYs = nodes.flatMap((n) => (n.ui ? [n.ui.y] : []))
  const y = placedYs.length > 0 ? Math.max(...placedYs) + FALLBACK_SPACING : 0
  const minX = Math.min(0, ...nodes.flatMap((n) => (n.ui ? [n.ui.x] : [])))
  let column = 0
  return nodes.map((n) => (n.ui ? n : { ...n, ui: { x: minX + column++ * FALLBACK_SPACING, y } }))
}

// 節點和邊的 id 規則只寫在這裡：重複檢查、錯誤訊息和 toNode／toEdge 共用
function rawId(raw: unknown): string | null {
  return isObject(raw) && isNonEmptyString(raw.id) ? raw.id : null
}

// 錯誤訊息裡附上 id，使用者比較好在檔案裡找到是哪一個
function describeId(id: string | null): string {
  return id == null ? '' : `（id "${id}"）`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

// JSON.parse 會把 1e400 這類溢位的數字變成 Infinity，送出時又變成 null
const INT32_MAX = 2 ** 31 - 1

// 整數參數在 API 是 32 位元整數，超出時後端整份拒絕（HTTP 400），沒辦法在錯誤分頁指出是哪個節點，
// 所以和 Infinity 一樣當成格式錯誤。範圍內但超過上限的值照樣讀入，由 Run 回報（spec 4.5）
function checkInteger(value: number): string | null {
  if (!Number.isInteger(value)) {
    return '必須是整數'
  }
  return Math.abs(value) > INT32_MAX ? `數值太大（整數最多 ${INT32_MAX.toLocaleString('en-US')}）` : null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNodeType(value: unknown): value is NodeType {
  return NODE_TYPES.includes(value as NodeType)
}

// 下載完成前不能釋放 URL，Safari 太早釋放會取消下載
const REVOKE_DELAY_MS = 10_000

// 匯出檔的內容，parseTopology 讀回來會得到相同的拓撲
export function serializeTopology(topology: Topology): string {
  return `${JSON.stringify(topology, null, 2)}\n`
}

// 匯出目前畫布（含 ui 座標）為 JSON 檔下載
export function downloadTopology(topology: Topology, filename = 'topology.json') {
  const blob = new Blob([serializeTopology(topology)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  // 舊版 Firefox 只接受頁面上的連結
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
