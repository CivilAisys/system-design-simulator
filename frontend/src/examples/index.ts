import type { Topology } from '@/api/client'
import { toTopology } from '@/io/topologyFile'
import basicWebApp from './basic-web-app.json'

export type Example = { id: string; label: string; topology: Topology }

// 工具列「範例」選單的內容。basic-web-app.json 也是後端 /simulate 整合測試的輸入（spec 第 7 節）
export const EXAMPLES: Example[] = [{ id: 'basic-web-app', label: '基本 Web App', topology: builtIn(basicWebApp) }]

// JSON import 的型別太寬（type 是 string），走和匯入檔案相同的檢查來取得 Topology
function builtIn(data: unknown): Topology {
  const parsed = toTopology(data)
  if (!parsed.ok) {
    throw new Error(`內建範例格式錯誤：${parsed.errors.join('；')}`)
  }
  return parsed.topology
}
