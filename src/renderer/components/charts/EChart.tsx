// =============================================================
// EChart — ECharts 原生 React 包装(替代 echarts-for-react)
// 项目内 4 处图表渲染只用到 option/height 两个能力,
// 自持 40 行包装即可: init/dispose 生命周期 + ResizeObserver
// 自适应 + option 更新 setOption(合并模式,与原库默认一致)。
// 注册来源统一为 lib/echarts-setup(见其头注释)。
// =============================================================

import type { EChartsType } from 'echarts/core'
import { useEffect, useRef } from 'react'
import { echarts } from '../../lib/echarts-setup'

interface EChartProps {
  option: Record<string, unknown>
  /** 图表高度 px */
  height?: number
  className?: string
}

export function EChart({ option, height = 260, className }: EChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<EChartsType | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chart = echarts.init(el)
    chartRef.current = chart
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option)
  }, [option])

  return <div ref={containerRef} className={className} style={{ height }} />
}
