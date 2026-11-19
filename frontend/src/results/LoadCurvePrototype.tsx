// PROTOTYPE（拋棄式）：負載曲線的三種畫法，用 ?variant=A|B|C 切換（見 PrototypeSwitcher）。
// 後端還沒做的兩件事在前端用 /simulate 模擬：0 rps 的無排隊延遲（用 0.1% 的流量近似）、過載前加密取樣
import { useEffect, useState } from 'react'
import { LineChart } from 'echarts/charts'
import {
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { simulate, type SweepPoint, type SweepResult, type Topology } from '@/api/client'
import type { Theme } from '@/theme'
import { formatMs, formatRps, formatRpsNumber, formatUtilization } from '@/canvas/format'
import { CURVE_COLORS, SANKEY_COLORS } from '@/canvas/status'
import { useECharts } from './useECharts'

echarts.use([
  LineChart,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  AxisPointerComponent,
  CanvasRenderer,
])

type Props = { sweep: SweepResult; topology: Topology; nodeName: (id: string) => string; theme: Theme; variant: string }

export function LoadCurvePrototype({ sweep, topology, nodeName, theme, variant }: Props) {
  const points = useDensePoints(sweep, topology)
  const curve = buildCurve(sweep, points, nodeName)
  if (variant === 'B') return <VariantB curve={curve} theme={theme} />
  if (variant === 'C') return <VariantC curve={curve} theme={theme} />
  return <VariantA curve={curve} theme={theme} />
}

// ---------- 資料 ----------

const DENSE_FRACTIONS = [0.9, 0.95, 0.98, 0.99, 0.995, 0.999]

function scaled(topology: Topology, multiplier: number): Topology {
  return {
    ...topology,
    nodes: topology.nodes.map((node) =>
      node.type === 'CLIENT' ? { ...node, params: { ...node.params, rps: (node.params.rps ?? 0) * multiplier } } : node,
    ),
  }
}

async function pointAt(topology: Topology, multiplier: number, currentRps: number): Promise<SweepPoint | null> {
  const result = await simulate(scaled(topology, multiplier))
  if (!result.summary) return null
  let busiest: SweepPoint['busiest'] = null
  for (const [nodeId, node] of Object.entries(result.nodes)) {
    if (node.utilization != null && (busiest == null || node.utilization > busiest.utilization)) {
      busiest = { nodeId, utilization: node.utilization }
    }
  }
  return {
    multiplier,
    totalRps: currentRps * multiplier,
    endToEndMs: { read: result.summary.avgEndToEndMs.read.ms, write: result.summary.avgEndToEndMs.write.ms },
    successRate: 1 - result.summary.dropRate,
    busiest,
  }
}

// 掃描結果再補上：0 rps 的延遲、過載門檻前的幾個點
function useDensePoints(sweep: SweepResult, topology: Topology): SweepPoint[] {
  const [extra, setExtra] = useState<{ key: SweepResult; points: SweepPoint[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    const overload = sweep.thresholds.overload?.multiplier
    const multipliers = [0.001, ...(overload ? DENSE_FRACTIONS.map((fraction) => overload * fraction) : [])]
    Promise.all(multipliers.map((m) => pointAt(topology, m, sweep.currentRps))).then((points) => {
      if (!cancelled) setExtra({ key: sweep, points: points.filter((p): p is SweepPoint => p != null) })
    })
    return () => {
      cancelled = true
    }
  }, [sweep, topology])

  const added = extra?.key === sweep ? extra.points : []
  const zero = added.find((point) => point.multiplier === 0.001)
  const rest = sweep.points
    .map((point) => (point.multiplier === 0 && zero ? { ...point, endToEndMs: zero.endToEndMs } : point))
    .concat(added.filter((point) => point !== zero))
  return rest.sort((a, b) => a.totalRps - b.totalRps)
}

type Band = { from: number; to: number; kind: 'warn' | 'over'; label: string }

type Curve = {
  points: SweepPoint[]
  merged: boolean
  read: [number, number | null][]
  write: [number, number | null][]
  success: [number, number][]
  maxRps: number
  currentRps: number
  bands: Band[]
  warn: { rps: number; node: string } | null
  over: { rps: number; node: string } | null
  baseMs: number | null
  peakMs: number | null
  headline: string
  nodeName: (id: string) => string
}

const times = (rps: number, current: number) => `${(rps / current).toFixed(1).replace(/\.0$/, '')} 倍`

function buildCurve(sweep: SweepResult, points: SweepPoint[], nodeName: (id: string) => string): Curve {
  const read = points.map((p): [number, number | null] => [p.totalRps, p.endToEndMs.read ?? null])
  const write = points.map((p): [number, number | null] => [p.totalRps, p.endToEndMs.write ?? null])
  const merged = read.every(([, r], i) => r === write[i][1] || (r != null && write[i][1] != null && Math.abs(r - write[i][1]!) < 1e-9))
  const maxRps = points.at(-1)?.totalRps ?? 0
  const { warn, overload } = sweep.thresholds
  const bands: Band[] = []
  if (warn) {
    bands.push({ from: warn.totalRps, to: overload?.totalRps ?? maxRps, kind: 'warn', label: `${nodeName(warn.nodeId)} 接近飽和（ρ ≥ 0.7）` })
  }
  if (overload) bands.push({ from: overload.totalRps, to: maxRps, kind: 'over', label: `${nodeName(overload.nodeId)} 過載` })

  const latencyOf = (p: SweepPoint) => {
    const values = [p.endToEndMs.read, p.endToEndMs.write].filter((v): v is number => v != null)
    return values.length ? Math.max(...values) : null
  }
  const defined = points.map(latencyOf).filter((v): v is number => v != null)
  const baseMs = defined[0] ?? null
  const peakMs = defined.length ? Math.max(...defined) : null
  const current = sweep.currentRps
  const headline = overload
    ? `流量放大到 ${formatRps(overload.totalRps)}（目前的 ${times(overload.totalRps, current)}）時 ${nodeName(overload.nodeId)} 過載；在那之前延遲從 ${formatMs(baseMs)} 升到 ${formatMs(peakMs)}。`
    : `放大到 ${formatRps(maxRps)}（目前的 ${times(maxRps, current)}）都沒有過載，延遲從 ${formatMs(baseMs)} 升到 ${formatMs(peakMs)}。`

  return {
    points,
    merged,
    read,
    write,
    success: points.map((p) => [p.totalRps, p.successRate * 100]),
    maxRps,
    currentRps: current,
    bands,
    warn: warn ? { rps: warn.totalRps, node: nodeName(warn.nodeId) } : null,
    over: overload ? { rps: overload.totalRps, node: nodeName(overload.nodeId) } : null,
    baseMs,
    peakMs,
    headline,
    nodeName,
  }
}

// ---------- 共用的圖表設定 ----------

const GRID_LINE: Record<Theme, string> = { dark: '#26324f', light: '#e4e6ef' }
const BAND_ALPHA = { warn: 0.14, over: 0.14 }

function hexAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function palette(theme: Theme) {
  const colors = SANKEY_COLORS[theme]
  return { ...colors, ...CURVE_COLORS[theme], grid: GRID_LINE[theme] }
}

function latencySeries(curve: Curve, theme: Theme, xAxisIndex = 0, yAxisIndex = 0) {
  const c = palette(theme)
  const common = { type: 'line' as const, showSymbol: false, xAxisIndex, yAxisIndex, connectNulls: false }
  return curve.merged
    ? [{ ...common, name: '延遲（read、write 相同）', data: curve.write, color: c.write }]
    : [
        { ...common, name: 'read 延遲', data: curve.read, color: c.read },
        { ...common, name: 'write 延遲', data: curve.write, color: c.write },
      ]
}

function tooltip(curve: Curve, theme: Theme) {
  const c = palette(theme)
  return {
    trigger: 'axis' as const,
    backgroundColor: c.tooltip,
    borderColor: c.tooltipBorder,
    textStyle: { color: c.text },
    axisPointer: { type: 'line' as const },
    formatter: (params: unknown) => {
      const first = (Array.isArray(params) ? params[0] : params) as { axisValue: number } | undefined
      if (!first) return ''
      const point = curve.points.reduce((best, p) =>
        Math.abs(p.totalRps - first.axisValue) < Math.abs(best.totalRps - first.axisValue) ? p : best,
      )
      const lines = [
        `總 rps：${formatRps(point.totalRps)}（目前的 ${times(point.totalRps, curve.currentRps)}）`,
        curve.merged
          ? `延遲：${formatMs(point.endToEndMs.write)}`
          : `read 延遲：${formatMs(point.endToEndMs.read)}　write 延遲：${formatMs(point.endToEndMs.write)}`,
        `成功率：${(point.successRate * 100).toFixed(1)}%`,
        point.busiest ? `最忙：${curve.nodeName(point.busiest.nodeId)} ρ ${formatUtilization(point.busiest.utilization)}` : '',
      ]
      return lines.filter(Boolean).map(echarts.format.encodeHTML).join('<br/>')
    },
  }
}

function xAxis(curve: Curve, theme: Theme, gridIndex: number, showLabels: boolean) {
  const c = palette(theme)
  return {
    type: 'value' as const,
    gridIndex,
    min: 0,
    max: curve.maxRps,
    name: showLabels ? '總 rps' : '',
    nameTextStyle: { color: c.text },
    axisLabel: { show: showLabels, color: c.text, formatter: (v: number) => formatRpsNumber(v) },
    axisLine: { lineStyle: { color: c.grid } },
    axisTick: { show: showLabels, lineStyle: { color: c.grid } },
    splitLine: { lineStyle: { color: c.grid } },
  }
}

function yStyle(theme: Theme) {
  const c = palette(theme)
  return {
    nameTextStyle: { color: c.text, align: 'left' as const },
    axisLabel: { color: c.text },
    axisLine: { show: false },
    splitLine: { lineStyle: { color: c.grid } },
  }
}

// 全高的背景色帶（A）：標籤橫排在色帶內的上緣
function bandArea(curve: Curve, theme: Theme, withLabels: boolean) {
  const c = palette(theme)
  return {
    silent: true,
    data: curve.bands.map((band) => [
      {
        xAxis: band.from,
        itemStyle: { color: hexAlpha(band.kind === 'warn' ? c.warn : c.over, BAND_ALPHA[band.kind]) },
        label: withLabels
          ? { show: true, position: 'insideTopLeft' as const, color: band.kind === 'warn' ? c.warn : c.over, formatter: band.label, fontSize: 11 }
          : { show: false },
      },
      { xAxis: band.to },
    ]),
  }
}

function currentLine(curve: Curve, theme: Theme, withLabel: boolean) {
  const c = palette(theme)
  return {
    symbol: 'none',
    silent: true,
    data: [
      {
        xAxis: curve.currentRps,
        lineStyle: { color: c.neutral, type: 'dashed' as const, width: 1 },
        label: withLabel
          ? { show: true, position: 'end' as const, color: c.neutral, formatter: `目前 ${formatRps(curve.currentRps)}`, fontSize: 11 }
          : { show: false },
      },
    ],
  }
}

function Chart({ option }: { option: echarts.EChartsCoreOption }) {
  const { containerRef, chartRef } = useECharts()
  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  })
  return <div ref={containerRef} className="size-full" />
}

function Legend({ curve, theme }: { curve: Curve; theme: Theme }) {
  const c = palette(theme)
  const items = curve.merged
    ? [{ name: '延遲（read、write 相同）', color: c.write }]
    : [
        { name: 'read 延遲', color: c.read },
        { name: 'write 延遲', color: c.write },
      ]
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {[...items, { name: '成功率', color: c.success }].map((item) => (
        <span key={item.name} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: item.color }} />
          {item.name}
        </span>
      ))}
    </div>
  )
}

// ---------- A：結論一行＋兩張圖＋全高色帶，延遲軸封頂在無負載延遲的 3 倍 ----------

function niceCeil(value: number) {
  const step = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / step) * step
}

function VariantA({ curve, theme }: { curve: Curve; theme: Theme }) {
  const c = palette(theme)
  const cap = curve.baseMs != null ? niceCeil(curve.baseMs * 3) : undefined
  const overCap = cap != null && curve.peakMs != null && curve.peakMs > cap
  const firstOver = overCap ? curve.write.find(([, v]) => v != null && v > cap!) ?? curve.read.find(([, v]) => v != null && v > cap!) : undefined
  const option = {
    tooltip: tooltip(curve, theme),
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { outerBoundsMode: 'none' as const, left: 56, right: 48, top: 28, height: '52%' },
      { outerBoundsMode: 'none' as const, left: 56, right: 48, top: '70%', bottom: 28 },
    ],
    xAxis: [xAxis(curve, theme, 0, false), xAxis(curve, theme, 1, true)],
    yAxis: [
      { type: 'value', gridIndex: 0, name: '延遲 ms', min: 0, max: cap, ...yStyle(theme) },
      { type: 'value', gridIndex: 1, name: '成功率 %', min: 0, max: 100, interval: 50, ...yStyle(theme) },
    ],
    series: [
      ...latencySeries(curve, theme).map((series, i) =>
        i === 0
          ? {
              ...series,
              markArea: bandArea(curve, theme, true),
              markLine: currentLine(curve, theme, true),
              markPoint: firstOver
                ? {
                    symbol: 'pin',
                    symbolSize: 0,
                    data: [
                      {
                        coord: [firstOver[0], cap],
                        label: { show: true, position: 'bottom', color: c.text, fontSize: 11, formatter: `↑ 之後超出圖外（最高 ${formatMs(curve.peakMs)}）` },
                      },
                    ],
                  }
                : undefined,
            }
          : series,
      ),
      {
        type: 'line',
        name: '成功率',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: curve.success,
        showSymbol: false,
        color: c.success,
        markArea: bandArea(curve, theme, false),
        markLine: currentLine(curve, theme, false),
      },
    ],
  }
  return (
    <div className="flex h-full flex-col gap-1.5">
      <p className="shrink-0 text-sm font-medium">{curve.headline}</p>
      <Legend curve={curve} theme={theme} />
      <div className="min-h-72 flex-1">
        <Chart option={option} />
      </div>
    </div>
  )
}

// ---------- B：上方三張重點卡＋流量尺（區段都在尺上），下方兩張圖不畫色帶，延遲軸貼合資料 ----------

function VariantB({ curve, theme }: { curve: Curve; theme: Theme }) {
  const c = palette(theme)
  const pct = (rps: number) => `${(rps / curve.maxRps) * 100}%`
  const okEnd = curve.warn?.rps ?? curve.over?.rps ?? curve.maxRps
  const option = {
    tooltip: tooltip(curve, theme),
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { outerBoundsMode: 'none' as const, left: 56, right: 48, top: 24, height: '50%' },
      { outerBoundsMode: 'none' as const, left: 56, right: 48, top: '72%', bottom: 28 },
    ],
    xAxis: [xAxis(curve, theme, 0, false), xAxis(curve, theme, 1, true)],
    yAxis: [
      { type: 'value', gridIndex: 0, name: '延遲 ms', scale: true, ...yStyle(theme) },
      { type: 'value', gridIndex: 1, name: '成功率 %', min: 0, max: 100, interval: 50, ...yStyle(theme) },
    ],
    series: [
      ...latencySeries(curve, theme).map((series, i) => (i === 0 ? { ...series, markLine: currentLine(curve, theme, false) } : series)),
      { type: 'line', name: '成功率', xAxisIndex: 1, yAxisIndex: 1, data: curve.success, showSymbol: false, color: c.success, markLine: currentLine(curve, theme, false) },
    ],
  }
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="grid shrink-0 grid-cols-3 gap-2">
        <Card title="目前" value={formatRps(curve.currentRps)} note={`延遲 ${formatMs(curve.baseMs)} 起`} />
        <Card
          title="開始吃緊（ρ 0.7）"
          value={curve.warn ? formatRps(curve.warn.rps) : '範圍內沒有'}
          note={curve.warn ? `${curve.warn.node}・目前的 ${times(curve.warn.rps, curve.currentRps)}` : ''}
          color={c.warn}
        />
        <Card
          title="過載"
          value={curve.over ? formatRps(curve.over.rps) : '範圍內沒有'}
          note={curve.over ? `${curve.over.node}・目前的 ${times(curve.over.rps, curve.currentRps)}・延遲最高 ${formatMs(curve.peakMs)}` : ''}
          color={c.over}
        />
      </div>
      <div className="relative ml-[56px] mr-[48px] h-5 shrink-0">
        <div className="absolute inset-y-1 left-0 rounded-l" style={{ width: pct(okEnd), background: hexAlpha(c.ok, 0.35) }} />
        {curve.warn && (
          <div
            className="absolute inset-y-1"
            style={{ left: pct(curve.warn.rps), width: pct((curve.over?.rps ?? curve.maxRps) - curve.warn.rps), background: hexAlpha(c.warn, 0.45) }}
          />
        )}
        {curve.over && (
          <div className="absolute inset-y-1 right-0 rounded-r" style={{ left: pct(curve.over.rps), background: hexAlpha(c.over, 0.45) }} />
        )}
        <div className="absolute -top-0.5 -translate-x-1/2 text-[10px] leading-none" style={{ left: pct(curve.currentRps), color: c.text }}>
          ▼
        </div>
      </div>
      <Legend curve={curve} theme={theme} />
      <div className="min-h-64 flex-1">
        <Chart option={option} />
      </div>
    </div>
  )
}

function Card({ title, value, note, color }: { title: string; value: string; note: string; color?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2" style={color ? { borderLeft: `3px solid ${color}` } : undefined}>
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="text-lg font-semibold">{value}</div>
      <div className="truncate text-xs text-muted-foreground">{note}</div>
    </div>
  )
}

// ---------- C：對數延遲軸，兩張圖下方一條細色條標區段，結論改成條列放在圖下 ----------

function VariantC({ curve, theme }: { curve: Curve; theme: Theme }) {
  const c = palette(theme)
  const strip = {
    type: 'line',
    xAxisIndex: 2,
    yAxisIndex: 2,
    data: [],
    markArea: {
      silent: true,
      data: [
        [{ xAxis: 0, itemStyle: { color: hexAlpha(c.ok, 0.5) } }, { xAxis: curve.warn?.rps ?? curve.over?.rps ?? curve.maxRps }],
        ...curve.bands.map((band) => [
          {
            xAxis: band.from,
            itemStyle: { color: hexAlpha(band.kind === 'warn' ? c.warn : c.over, 0.6) },
          },
          { xAxis: band.to },
        ]),
      ],
    },
  }
  const option = {
    tooltip: tooltip(curve, theme),
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { outerBoundsMode: 'none' as const, left: 56, right: 48, top: 24, height: '50%' },
      { outerBoundsMode: 'none' as const, left: 56, right: 48, top: '66%', height: '18%' },
      { outerBoundsMode: 'none' as const, left: 56, right: 48, bottom: 24, height: 8 },
    ],
    xAxis: [xAxis(curve, theme, 0, false), xAxis(curve, theme, 1, false), { ...xAxis(curve, theme, 2, true), splitLine: { show: false } }],
    yAxis: [
      { type: 'log', gridIndex: 0, name: '延遲 ms（對數）', logBase: 10, ...yStyle(theme) },
      { type: 'value', gridIndex: 1, name: '成功率 %', min: 0, max: 100, interval: 50, ...yStyle(theme) },
      { type: 'value', gridIndex: 2, show: false, min: 0, max: 1 },
    ],
    series: [
      ...latencySeries(curve, theme).map((series, i) => (i === 0 ? { ...series, markLine: currentLine(curve, theme, true) } : series)),
      { type: 'line', name: '成功率', xAxisIndex: 1, yAxisIndex: 1, data: curve.success, showSymbol: false, color: c.success },
      strip,
    ],
  }
  return (
    <div className="flex h-full flex-col gap-1.5">
      <Legend curve={curve} theme={theme} />
      <div className="min-h-72 flex-1">
        <Chart option={option} />
      </div>
      <ul className="shrink-0 list-disc space-y-0.5 pl-5 text-sm">
        <li>
          目前 {formatRps(curve.currentRps)}，延遲 {formatMs(curve.baseMs)}。
        </li>
        {curve.warn && (
          <li>
            <span style={{ color: c.warn }}>■</span> {formatRps(curve.warn.rps)}（目前的 {times(curve.warn.rps, curve.currentRps)}）起 {curve.warn.node}{' '}
            使用率超過 0.7，接近飽和。
          </li>
        )}
        {curve.over ? (
          <li>
            <span style={{ color: c.over }}>■</span> {formatRps(curve.over.rps)}（目前的 {times(curve.over.rps, curve.currentRps)}）起 {curve.over.node}{' '}
            過載，開始丟請求；過載前延遲最高 {formatMs(curve.peakMs)}。
          </li>
        ) : (
          <li>放大到 {formatRps(curve.maxRps)} 都沒有過載。</li>
        )}
      </ul>
    </div>
  )
}
