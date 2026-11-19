import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'

// ECharts 實例只建一次，之後用 setOption 更新，數值才會有過渡動畫、重算時不會閃；容器大小變了跟著 resize
export function useECharts() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

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

  return { containerRef, chartRef }
}
