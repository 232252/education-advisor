// =============================================================
// EChart — EChartImpl 的懒加载门面(对外 API 不变)
// echarts 是全库最大单一依赖且 dashboard 首页即有图表,
// React.lazy 把 vendor-echarts chunk 移出首屏关键路径;
// Suspense 占位与图表同高同类名,加载窗口内零布局位移。
// =============================================================

import { lazy, Suspense } from 'react'
import type { EChartProps } from './EChartImpl'

const EChartImpl = lazy(() => import('./EChartImpl').then((m) => ({ default: m.EChartImpl })))

export function EChart(props: EChartProps) {
  const { height = 260, className } = props
  return (
    <Suspense fallback={<div className={className} style={{ height }} />}>
      <EChartImpl {...props} />
    </Suspense>
  )
}
