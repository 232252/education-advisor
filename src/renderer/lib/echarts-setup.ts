// =============================================================
// echarts-setup — 集中 ECharts 组件注册
// 三个页面（Dashboard/Academics/StudentProfile）原本各自 echarts.use([...])，
// 容易漏注册导致运行时 "series type unknown" 错误。集中到本文件，
// 任何页面只需 `import { echarts } from '../../lib/echarts-setup'`。
//
// 注册并集（来自原三个页面的 echarts.use 调用）：
//   Charts:     BarChart, LineChart, PieChart, RadarChart
//   Components: GridComponent, TooltipComponent, LegendComponent,
//               TitleComponent, RadarComponent
//   Renderers:  CanvasRenderer
// =============================================================

import { BarChart, LineChart, PieChart, RadarChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  RadarChart,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
])

export { echarts }
