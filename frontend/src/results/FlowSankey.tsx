import { useEffect, useRef } from 'react'
import { SankeyChart, type SankeySeriesOption } from 'echarts/charts'
import { TooltipComponent, type TooltipComponentOption } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { totalRps, type NodeResult, type SimulationResult, type Topology } from '@/api/client'
import type { Theme } from '@/theme'
import { formatRps } from '@/canvas/format'
import { isReplicationSource } from '@/canvas/catalog'
import { NEUTRAL_HEX, STATUS_HEX } from '@/canvas/status'

// 只載入用到的部分，避免把整個 ECharts 打包進來
echarts.use([SankeyChart, TooltipComponent, CanvasRenderer])

type SankeyOption = echarts.ComposeOption<SankeySeriesOption | TooltipComponentOption>

// 沒被送往下游的流量各自流進一個終點：過載的丟棄和 Rate Limiter／External API 的拒絕分開顯示。
// id 用 \u0000 開頭，不會和使用者的節點 id 撞在一起
// consumer 處理不完、留在 queue 裡的訊息（spec 4.2.4）也是一個終點，數值是到達 − 處理 − 丟棄。
// 邊的 backlog 還包含 consumer 處理了、但下游失敗的訊息，那些已經流到下游、算在下游的丟棄裡，不再畫一次
const SINKS = [
  { id: '\u0000dropped', name: '丟棄', color: STATUS_HEX.OVERLOADED, rps: (node: NodeResult) => node.droppedRps },
  { id: '\u0000rejected', name: '拒絕', color: NEUTRAL_HEX, rps: (node: NodeResult) => node.rejectedRps },
  { id: '\u0000backlog', name: '積壓', color: STATUS_HEX.CRITICAL, rps: queuedExcess },
]

function queuedExcess(node: NodeResult) {
  if (!node.warnings.includes('BACKLOG')) return 0
  // 浮點誤差可能留下極小的值
  const excess = totalRps(node.arrivalRps) - node.throughputRps - node.droppedRps - node.rejectedRps
  return excess > 1e-9 ? excess : 0
}

type FlowSankeyProps = {
  topology: Topology
  result: SimulationResult
  theme: Theme
}

export function FlowSankey({ topology, result, theme }: FlowSankeyProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  // 實例只建一次，之後用 setOption 更新，數值才會有過渡動畫、重算時不會閃
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = echarts.init(container)
    chartRef.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(container)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(sankeyOption(topology, result, theme))
  }, [topology, result, theme])

  return <div ref={containerRef} className="size-full" />
}

function sankeyOption(topology: Topology, result: SimulationResult, theme: Theme): SankeyOption {
  const dark = theme === 'dark'
  const textColor = dark ? '#e5e5e5' : '#171717'
  // 流量和邊上的 label 用同一個數字：read + write
  const types = new Map(topology.nodes.map((node) => [node.id, node.type]))
  const edgeLinks = topology.edges.flatMap((edge) => {
    const rps = result.edges[edge.id]?.rps
    // 0 流量的邊在 Sankey 上沒有寬度，只會留下孤立的節點
    if (!rps || totalRps(rps) <= 0) return []
    // 複製不是請求的流向：畫出來會讓 primary 看起來處理了好幾倍的流量。
    // Message Queue 送給 consumer 的訊息是真的要處理的流量，照畫
    const sourceType = types.get(edge.source)
    if (sourceType && isReplicationSource(sourceType)) return []
    return [{ source: edge.source, target: edge.target, value: totalRps(rps), read: rps.read, write: rps.write }]
  })
  // 丟棄、拒絕和積壓都是依 read／write 的比例發生（spec 4.2），用到達率的比例拆開
  const sinkLinks = topology.nodes.flatMap((node) => {
    const metrics = result.nodes[node.id]
    if (!metrics) return []
    const arrival = totalRps(metrics.arrivalRps)
    return SINKS.flatMap((sink) => {
      const value = sink.rps(metrics)
      if (value <= 0 || arrival <= 0) return []
      const share = value / arrival
      return [
        {
          source: node.id,
          target: sink.id,
          value,
          read: metrics.arrivalRps.read * share,
          write: metrics.arrivalRps.write * share,
        },
      ]
    })
  })
  const links = [...edgeLinks, ...sinkLinks]
  const linked = new Set(links.flatMap((link) => [link.source, link.target]))
  const nodes = [
    ...topology.nodes
      .filter((node) => linked.has(node.id))
      .map((node) => {
        const status = result.nodes[node.id]?.status
        // 用 id 對應連線，名稱重複也不會混在一起
        return { id: node.id, name: node.name, itemStyle: { color: status ? STATUS_HEX[status] : NEUTRAL_HEX } }
      }),
    ...SINKS.filter((sink) => linked.has(sink.id)).map((sink) => ({
      id: sink.id,
      name: sink.name,
      itemStyle: { color: sink.color },
    })),
  ]
  const names = new Map([
    ...topology.nodes.map((node) => [node.id, node.name] as const),
    ...SINKS.map((sink) => [sink.id, sink.name] as const),
  ])

  return {
    tooltip: {
      trigger: 'item',
      // ECharts 預設白底，深色主題要自己給
      backgroundColor: dark ? '#262626' : '#ffffff',
      borderColor: dark ? '#404040' : '#e5e5e5',
      textStyle: { color: textColor },
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params
        if (item?.dataType !== 'edge') return `${item?.name ?? ''}：${formatRps(Number(item?.value ?? 0))}`
        const link = item.data as (typeof links)[number]
        return (
          `${names.get(link.source)} → ${names.get(link.target)}<br/>` +
          `${formatRps(link.value)}（read ${formatRps(link.read)}／write ${formatRps(link.write)}）`
        )
      },
    },
    series: [
      {
        type: 'sankey',
        data: nodes,
        links,
        left: 16,
        right: 96,
        top: 16,
        bottom: 16,
        nodeGap: 16,
        emphasis: { focus: 'adjacency' },
        // 預設標籤是用來對應連線的 id，要明確指定顯示 name
        label: { color: textColor, formatter: '{b}' },
        lineStyle: { color: 'gradient', opacity: 0.35 },
      },
    ],
  }
}
