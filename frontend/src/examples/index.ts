import type { Topology } from '@/api/client'
import { toTopology } from '@/io/topologyFile'
import basicWebApp from './basic-web-app.json'
import fanOut from './fan-out.json'
import overload from './overload.json'
import readWriteSplit from './read-write-split.json'

export type Example = { id: string; label: string; topology: Topology }

// 工具列「範例」選單的內容。這個資料夾的範例檔也是後端 /simulate 整合測試的輸入（spec 第 7 節）
export const EXAMPLES: Example[] = [
  { id: 'basic-web-app', label: '基本 Web App', topology: builtIn(basicWebApp) },
  // LB 用 weight 分流，只有 Catalog 這條路徑有 Cache：DB 的 read 被擋下、write 穿透
  { id: 'read-write-split', label: '讀寫分流', topology: builtIn(readWriteSplit) },
  // Gateway 呼叫三個下游（含 callsPerRequest 3）：切換 Call mode 比較依序與平行的端到端延遲
  { id: 'fan-out', label: 'Fan-out', topology: builtIn(fanOut) },
  // Inventory DB 被 write 和 Cache miss 壓到過載：瓶頸通知、Dropped、Drop rate 和「延遲無定義」
  { id: 'overload', label: '過載', topology: builtIn(overload) },
]

// JSON import 的型別太寬（type 是 string），走和匯入檔案相同的檢查來取得 Topology
function builtIn(data: unknown): Topology {
  const parsed = toTopology(data)
  if (!parsed.ok) {
    throw new Error(`內建範例格式錯誤：${parsed.errors.join('；')}`)
  }
  return parsed.topology
}
