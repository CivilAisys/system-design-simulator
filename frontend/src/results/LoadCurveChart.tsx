import { useEffect, useRef } from 'react'
import { LineChart, type LineSeriesOption } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  type GridComponentOption,
  type LegendComponentOption,
  type MarkLineComponentOption,
  type TooltipComponentOption,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { SweepResult } from '@/api/client'
import type { Theme } from '@/theme'
import { formatRpsNumber } from '@/canvas/format'
import { SANKEY_COLORS } from '@/canvas/status'
import { curveSeries, pointTooltip, referenceLines, type ReferenceLine } from './loadCurve'

// 只載入用到的部分，避免把整個 ECharts 打包進來
echarts.use([LineChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer])

type CurveOption = echarts.ComposeOption<
  LineSeriesOption | GridComponentOption | LegendComponentOption | MarkLineComponentOption | TooltipComponentOption
>

// 三條線的顏色；門檻線用狀態色（WARN 黃、過載紅），和 Sankey、畫布一致
const LINE_COLORS: Record<Theme, { read: string; write: string; success: string }> = {
  dark: { read: '#60a5fa', write: '#c084fc', success: '#34d399' },
  light: { read: '#2563eb', write: '#9333ea', success: '#059669' },
}

type LoadCurveChartProps = {
  sweep: SweepResult
  nodeName: (id: string) => string
  theme: Theme
}

export function LoadCurveChart({ sweep, nodeName, theme }: LoadCurveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  // 實例只建一次，之後用 setOption 更新，重算時不會閃（同 FlowSankey）
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
    // notMerge：門檻線消失時（例如加了 Rate Limiter）舊的線不能留著
    chartRef.current?.setOption(curveOption(sweep, nodeName, theme), { notMerge: true })
  }, [sweep, nodeName, theme])

  return <div ref={containerRef} className="size-full" />
}

function curveOption(sweep: SweepResult, nodeName: (id: string) => string, theme: Theme): CurveOption {
  const colors = SANKEY_COLORS[theme]
  const lineColors = LINE_COLORS[theme]
  const series = curveSeries(sweep.points)
  const referenceColor: Record<ReferenceLine['kind'], string> = {
    current: colors.neutral,
    warn: colors.warn,
    overload: colors.over,
  }
  const markLine: MarkLineComponentOption = {
    symbol: 'none',
    silent: true,
    data: referenceLines(sweep, nodeName).map((line) => ({
      xAxis: line.totalRps,
      // 用函式：字串的 formatter 會把名稱裡的 {a} 之類當成樣板
      label: { formatter: () => line.label, color: referenceColor[line.kind], position: 'insideEndTop' },
      lineStyle: { color: referenceColor[line.kind], type: line.kind === 'current' ? 'dashed' : 'solid' },
    })),
  }
  const axisStyle = { axisLabel: { color: colors.text }, nameTextStyle: { color: colors.text } }

  return {
    legend: { top: 0, textStyle: { color: colors.text } },
    grid: { left: 56, right: 56, top: 40, bottom: 32 },
    tooltip: {
      trigger: 'axis',
      // ECharts 預設白底，深色主題要自己給
      backgroundColor: colors.tooltip,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.text },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params
        const point = first ? sweep.points[first.dataIndex] : undefined
        // 提示是 HTML，節點名稱是使用者輸入的，要跳脫
        return point ? pointTooltip(point, nodeName).map(echarts.format.encodeHTML).join('<br/>') : ''
      },
    },
    xAxis: {
      type: 'value',
      name: '總 rps',
      min: 0,
      max: sweep.points.at(-1)?.totalRps,
      ...axisStyle,
      axisLabel: { color: colors.text, formatter: (value: number) => formatRpsNumber(value) },
    },
    yAxis: [
      { type: 'value', name: '延遲 ms', min: 0, ...axisStyle },
      { type: 'value', name: '成功率 %', min: 0, max: 100, ...axisStyle, splitLine: { show: false } },
    ],
    series: [
      {
        name: 'read 延遲',
        type: 'line',
        data: series.read,
        yAxisIndex: 0,
        showSymbol: false,
        color: lineColors.read,
        markLine,
      },
      {
        name: 'write 延遲',
        type: 'line',
        data: series.write,
        yAxisIndex: 0,
        showSymbol: false,
        color: lineColors.write,
      },
      {
        name: '成功率',
        type: 'line',
        data: series.success,
        yAxisIndex: 1,
        showSymbol: false,
        color: lineColors.success,
      },
    ],
  }
}
