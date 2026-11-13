import { useEffect, useRef } from 'react'
import { SankeyChart, type SankeySeriesOption } from 'echarts/charts'
import { TooltipComponent, type TooltipComponentOption } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { totalRps, type SimulationResult, type Topology } from '@/api/client'
import type { Theme } from '@/theme'
import { formatRps } from '@/canvas/format'
import { STATUS_HEX } from '@/canvas/status'

// 只載入用到的部分，避免把整個 ECharts 打包進來
echarts.use([SankeyChart, TooltipComponent, CanvasRenderer])

type SankeyOption = echarts.ComposeOption<SankeySeriesOption | TooltipComponentOption>

// Client 沒有狀態，用中性灰
const NEUTRAL_HEX = '#a3a3a3'

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
  const links = topology.edges.flatMap((edge) => {
    const rps = result.edges[edge.id]?.rps
    // 0 流量的邊在 Sankey 上沒有寬度，只會留下孤立的節點
    if (!rps || totalRps(rps) <= 0) return []
    return [{ source: edge.source, target: edge.target, value: totalRps(rps), read: rps.read, write: rps.write }]
  })
  const linked = new Set(links.flatMap((link) => [link.source, link.target]))
  const nodes = topology.nodes
    .filter((node) => linked.has(node.id))
    .map((node) => {
      const status = result.nodes[node.id]?.status
      // 用 id 對應連線，名稱重複也不會混在一起
      return { id: node.id, name: node.name, itemStyle: { color: status ? STATUS_HEX[status] : NEUTRAL_HEX } }
    })
  const names = new Map(topology.nodes.map((node) => [node.id, node.name]))

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
