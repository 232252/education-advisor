(function () {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();

  function baseTextStyle() {
    return { color: ink, fontFamily: "'WorkSans','PingFang SC','Microsoft YaHei',sans-serif" };
  }

  // --- Chart: Agent 触发方式 ---
  var triggerEl = document.getElementById('chart-trigger');
  if (triggerEl) {
    var triggerChart = echarts.init(triggerEl, null, { renderer: 'svg' });
    triggerChart.setOption({
      animation: false,
      title: {
        text: '触发方式分布',
        left: 'center', top: 0,
        textStyle: { fontSize: 14, fontWeight: 700, color: ink, fontFamily: "'Outfit','PingFang SC','Microsoft YaHei',sans-serif" }
      },
      tooltip: { trigger: 'item', appendToBody: true, formatter: '{b}: {c} 个 Agent（{d}%）' },
      legend: { bottom: 0, textStyle: baseTextStyle(), itemWidth: 12, itemHeight: 12 },
      series: [{
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '54%'],
        label: { show: true, formatter: '{b}\n{c} 个', color: ink, fontSize: 12, lineHeight: 17 },
        labelLine: { lineStyle: { color: rule } },
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        data: [
          { value: 13, name: '定时任务（cron）', itemStyle: { color: accent2 } },
          { value: 5, name: '手动触发', itemStyle: { color: accent } }
        ]
      }]
    });
    window.addEventListener('resize', function () { triggerChart.resize(); });
  }

  // --- Chart: Agent 模型档位 ---
  var tierEl = document.getElementById('chart-tier');
  if (tierEl) {
    var tierChart = echarts.init(tierEl, null, { renderer: 'svg' });
    tierChart.setOption({
      animation: false,
      title: {
        text: '模型档位分布',
        left: 'center', top: 0,
        textStyle: { fontSize: 14, fontWeight: 700, color: ink, fontFamily: "'Outfit','PingFang SC','Microsoft YaHei',sans-serif" }
      },
      tooltip: { trigger: 'item', appendToBody: true, formatter: '{b}: {c} 个 Agent（{d}%）' },
      legend: { bottom: 0, textStyle: baseTextStyle(), itemWidth: 12, itemHeight: 12 },
      series: [{
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '54%'],
        label: { show: true, formatter: '{b}\n{c} 个', color: ink, fontSize: 12, lineHeight: 17 },
        labelLine: { lineStyle: { color: rule } },
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        data: [
          { value: 4, name: '高质量档', itemStyle: { color: accent } },
          { value: 14, name: '低成本档', itemStyle: { color: muted } }
        ]
      }]
    });
    window.addEventListener('resize', function () { tierChart.resize(); });
  }

  // --- Chart: IPC 通道分布 ---
  var ipcEl = document.getElementById('chart-ipc');
  if (ipcEl) {
    var ipcChart = echarts.init(ipcEl, null, { renderer: 'svg' });
    var ipcData = [
      ['EAA 操行', 24],
      ['AI/LLM', 11],
      ['Agent', 10],
      ['班级', 8],
      ['飞书', 8],
      ['隐私', 8],
      ['Cron', 8],
      ['MCP', 8],
      ['Ollama', 7],
      ['学业', 7],
      ['日志', 7],
      ['系统', 6],
      ['技能', 4],
      ['对话', 4],
      ['设置', 3],
      ['档案', 2]
    ].reverse();
    ipcChart.setOption({
      animation: false,
      grid: { left: 8, right: 42, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        trigger: 'axis', appendToBody: true, axisPointer: { type: 'shadow' },
        formatter: function (p) { return p[0].name + ': ' + p[0].value + ' 个通道'; }
      },
      xAxis: {
        type: 'value',
        axisLabel: { color: muted, fontSize: 11 },
        splitLine: { lineStyle: { color: rule, type: 'dashed' } }
      },
      yAxis: {
        type: 'category',
        data: ipcData.map(function (d) { return d[0]; }),
        axisLabel: { color: ink, fontSize: 12 },
        axisLine: { lineStyle: { color: rule } },
        axisTick: { show: false }
      },
      series: [{
        type: 'bar',
        barWidth: '62%',
        data: ipcData.map(function (d) {
          return {
            value: d[1],
            itemStyle: {
              color: d[1] >= 10 ? accent : (d[1] >= 7 ? accent2 : muted),
              borderRadius: [0, 4, 4, 0]
            }
          };
        }),
        label: { show: true, position: 'right', color: ink, fontSize: 11, fontFamily: "'Outfit',sans-serif" }
      }]
    });
    window.addEventListener('resize', function () { ipcChart.resize(); });
  }
})();
