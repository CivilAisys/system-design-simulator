import { useEffect } from 'react'
import { LineChart, type LineSeriesOption } from 'echarts/charts'
import {
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  type AxisPointerComponentOption,
  type GridComponentOption,
  type LegendComponentOption,
  type MarkAreaComponentOption,
  type MarkLineComponentOption,
  type MarkPointComponentOption,
  type TooltipComponentOption,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { SweepResult } from '@/api/client'
import { formatMs, formatRps, formatRpsNumber } from '@/canvas/format'
import { CURVE_COLORS, SANKEY_COLORS } from '@/canvas/status'
import { curveBands, latencyAxis, pointTooltip, successSeries, type LatencyLine } from './loadCurve'
import { useECharts } from './useECharts'

// 只載入用到的部分，避免把整個 ECharts 打包進來
echarts.use([
  LineChart,
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  CanvasRenderer,
])

type CurveOption = echarts.ComposeOption<
  | LineSeriesOption
  | AxisPointerComponentOption
  | GridComponentOption
  | LegendComponentOption
  | MarkAreaComponentOption
  | MarkLineComponentOption
  | MarkPointComponentOption
  | TooltipComponentOption
>

type LoadCurveChartProps = {
  sweep: SweepResult
  lines: LatencyLine[]
  nodeName: (id: string) => string
}

export function LoadCurveChart({ sweep, lines, nodeName }: LoadCurveChartProps) {
  const { containerRef, chartRef } = useECharts()

  useEffect(() => {
    // notMerge：色帶消失時（例如加了 Rate Limiter）舊的不能留著。
    // nodeName 只在名稱改了時才換（見 LoadCurvePanel），拖動節點不會重畫、不會重置 legend
    chartRef.current?.setOption(curveOption(sweep, lines, nodeName), { notMerge: true })
  }, [chartRef, sweep, lines, nodeName])

  return <div ref={containerRef} className="size-full" />
}

// 色帶的透明度：淡淡一層，不蓋過線
const BAND_ALPHA = 0.14
// 色帶標籤一行的高度（字級 11）：第二行的標籤往下移這麼多
const BAND_LABEL_ROW = 15
// 上下兩張圖的左右邊界要一樣，X 軸才對得齊
const GRID_SIDES = { left: 56, right: 48 }

function curveOption(
  sweep: SweepResult,
  lines: LatencyLine[],
  nodeName: (id: string) => string,
): CurveOption {
  const colors = SANKEY_COLORS
  const curve = CURVE_COLORS
  const bands = curveBands(sweep, nodeName)
  const axis = latencyAxis(sweep.points, lines)
  const bandColor = { warn: colors.warn, overload: colors.over }

  // 色帶畫滿兩張圖的高度；標籤只在上面那張寫
  const markArea = (withLabels: boolean): MarkAreaComponentOption => ({
    silent: true,
    data: bands.map((band) => [
      {
        xAxis: band.from,
        itemStyle: { color: withAlpha(bandColor[band.kind], BAND_ALPHA) },
        // 用函式：字串的 formatter 會把名稱裡的 {a} 之類當成樣板
        label: withLabels
          ? {
              position: 'insideTopLeft',
              offset: [0, band.row * BAND_LABEL_ROW],
              color: bandColor[band.kind],
              fontSize: 11,
              formatter: () => band.label,
            }
          : { show: false },
      },
      { xAxis: band.to },
    ]),
  })
  const current = (withLabel: boolean): MarkLineComponentOption => ({
    symbol: 'none',
    silent: true,
    data: [
      {
        xAxis: sweep.currentRps,
        lineStyle: { color: colors.neutral, type: 'dashed', width: 1 },
        label: withLabel
          ? { position: 'end', color: colors.neutral, fontSize: 11, formatter: () => `目前 ${formatRps(sweep.currentRps)}` }
          : { show: false },
      },
    ],
  })
  // 延遲超過軸的上限時，在開始超出的地方標出最高值
  const { max: latencyMax, overflow } = axis
  const overflowMark: MarkPointComponentOption | undefined =
    overflow && latencyMax != null
      ? {
          symbolSize: 0,
          silent: true,
          data: [
            {
              name: 'overflow',
              coord: [overflow.totalRps, latencyMax],
              label: {
                // 往下讓開兩行色帶標籤
                position: 'bottom',
                distance: 22 + BAND_LABEL_ROW,
                color: colors.text,
                fontSize: 11,
                formatter: () => `↑ 之後超出圖外（最高 ${formatMs(overflow.peakMs)}）`,
              },
            },
          ],
        }
      : undefined

  const xAxis = (gridIndex: number, showLabels: boolean) => ({
    type: 'value' as const,
    gridIndex,
    min: 0,
    max: sweep.points.at(-1)?.totalRps,
    name: showLabels ? '總 rps' : '',
    nameTextStyle: { color: colors.text },
    axisLabel: { show: showLabels, color: colors.text, formatter: (value: number) => formatRpsNumber(value) },
    axisLine: { lineStyle: { color: curve.grid } },
    axisTick: { show: showLabels, lineStyle: { color: curve.grid } },
    splitLine: { lineStyle: { color: curve.grid } },
  })
  const yStyle = {
    nameTextStyle: { color: colors.text, align: 'left' as const },
    axisLabel: { color: colors.text },
    splitLine: { lineStyle: { color: curve.grid } },
  }

  return {
    // 只列線；放色帶和「目前」的系列不進 legend
    legend: { top: 0, data: [...lines.map((line) => line.name), '成功率'], textStyle: { color: colors.text } },
    // 滑過其中一張圖時，兩張圖的指示線一起動
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    // ECharts 6 預設會依軸名稱縮放 grid（outerBoundsMode: 'auto'），上下兩張就對不齊
    grid: [
      { ...GRID_SIDES, outerBoundsMode: 'none', top: 48, bottom: '42%' },
      { ...GRID_SIDES, outerBoundsMode: 'none', top: '70%', bottom: 28 },
    ],
    tooltip: {
      trigger: 'axis',
      // ECharts 預設純白底，改成卡片的紙色
      backgroundColor: colors.tooltip,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.text },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params
        const point = first ? sweep.points[first.dataIndex] : undefined
        // 提示是 HTML，節點名稱是使用者輸入的，要跳脫
        return point ? pointTooltip(point, lines, nodeName).map(echarts.format.encodeHTML).join('<br/>') : ''
      },
    },
    xAxis: [xAxis(0, false), xAxis(1, true)],
    yAxis: [
      { type: 'value', gridIndex: 0, name: '延遲 ms', min: 0, max: latencyMax, ...yStyle },
      { type: 'value', gridIndex: 1, name: '成功率 %', min: 0, max: 100, interval: 50, ...yStyle },
    ],
    series: [
      ...lines.map((line): LineSeriesOption => ({
        name: line.name,
        type: 'line',
        data: line.data,
        showSymbol: false,
        color: curve[line.color],
      })),
      {
        name: '成功率',
        type: 'line',
        data: successSeries(sweep.points),
        xAxisIndex: 1,
        yAxisIndex: 1,
        showSymbol: false,
        color: curve.success,
      },
      // 色帶、「目前」、超出圖外的標註放在沒有資料的系列上：在 legend 關掉某條線時，它們不會跟著消失
      {
        name: 'reference',
        type: 'line',
        data: [],
        tooltip: { show: false },
        markArea: markArea(true),
        markLine: current(true),
        markPoint: overflowMark,
      },
      {
        name: 'reference-success',
        type: 'line',
        data: [],
        tooltip: { show: false },
        xAxisIndex: 1,
        yAxisIndex: 1,
        markArea: markArea(false),
        markLine: current(false),
      },
    ],
  }
}

// #rrggbb 加上透明度
function withAlpha(hex: string, alpha: number) {
  const value = parseInt(hex.slice(1), 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}
