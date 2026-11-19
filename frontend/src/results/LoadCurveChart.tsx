import { useEffect } from 'react'
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
import { CURVE_COLORS, SANKEY_COLORS } from '@/canvas/status'
import { curveSeries, pointTooltip, referenceLines, type ReferenceLine } from './loadCurve'
import { useECharts } from './useECharts'

// 只載入用到的部分，避免把整個 ECharts 打包進來
echarts.use([LineChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer])

type CurveOption = echarts.ComposeOption<
  LineSeriesOption | GridComponentOption | LegendComponentOption | MarkLineComponentOption | TooltipComponentOption
>

type LoadCurveChartProps = {
  sweep: SweepResult
  nodeName: (id: string) => string
  theme: Theme
}

export function LoadCurveChart({ sweep, nodeName, theme }: LoadCurveChartProps) {
  const { containerRef, chartRef } = useECharts()

  useEffect(() => {
    // notMerge：門檻線消失時（例如加了 Rate Limiter）舊的線不能留著。
    // nodeName 只在名稱改了時才換（見 LoadCurvePanel），拖動節點不會重畫、不會重置 legend
    chartRef.current?.setOption(curveOption(sweep, nodeName, theme), { notMerge: true })
  }, [chartRef, sweep, nodeName, theme])

  return <div ref={containerRef} className="size-full" />
}

function curveOption(sweep: SweepResult, nodeName: (id: string) => string, theme: Theme): CurveOption {
  const colors = SANKEY_COLORS[theme]
  const lineColors = CURVE_COLORS[theme]
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
    // 只列三條線；放參考線的那個系列不進 legend
    legend: { top: 0, data: ['read 延遲', 'write 延遲', '成功率'], textStyle: { color: colors.text } },
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
      nameTextStyle: { color: colors.text },
      axisLabel: { color: colors.text, formatter: (value: number) => formatRpsNumber(value) },
    },
    yAxis: [
      { type: 'value', name: '延遲 ms', min: 0, ...axisStyle },
      { type: 'value', name: '成功率 %', min: 0, max: 100, ...axisStyle, splitLine: { show: false } },
    ],
    series: [
      { name: 'read 延遲', type: 'line', data: series.read, yAxisIndex: 0, showSymbol: false, color: lineColors.read },
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
      // 參考線放在一個沒有資料的系列上：在 legend 關掉 read 延遲時，參考線不會跟著消失
      { name: 'reference', type: 'line', data: [], yAxisIndex: 0, markLine, tooltip: { show: false } },
    ],
  }
}
