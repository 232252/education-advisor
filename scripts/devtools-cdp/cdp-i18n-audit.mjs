// CDP i18n UI 审计 — 连接运行中的 Electron 实例,按语言逐路由收集
// 可见文本与 aria-label/title,输出"等于字典 zh 值的渲染"(en 模式下
// 即硬编码/未接线嫌疑)与统计,供 i18n 清理轮取证。
//
// 前置: 应用以 CDP 启动(npm run dev 或 electron .,默认端口 9222,
// EA_CDP_PORT 可覆盖;.env 里 ENABLE_CDP=0 时需显式 ENABLE_CDP=1)。
// 用法:
//   EA_CDP_PORT=9444 node scripts/devtools-cdp/cdp-i18n-audit.mjs [en|zh] [每路由等待ms]
// 说明:
//   - localhost 解析到 ::1 而 CDP 只绑 IPv4,这里统一重写 127.0.0.1
//   - zh 模式的价值是回归: t() 返回裸 key(字典缺键)会与字典值同帧可见
import { connectCdp, fetchTargets, sleep } from '../lib/cdp-client.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const realFetch = globalThis.fetch
globalThis.fetch = (url, ...a) => realFetch(String(url).replace('localhost', '127.0.0.1'), ...a)

const LANG = process.argv[2] === 'zh' ? 'zh' : 'en'
const WAIT = Number.parseInt(process.argv[3] || '1400', 10) || 1400
const ROUTES = [
  '#/dashboard', '#/students', '#/classes', '#/academics', '#/chat', '#/agents',
  '#/models', '#/skills', '#/scheduler', '#/privacy', '#/settings', '#/reports',
]
const LANG_KEY = 'education-advisor.lang'

const targets = await fetchTargets()
if (!targets || targets.length === 0) {
  console.log('[cdp-i18n-audit] no CDP target — 启动应用并开启 CDP 后再跑')
  process.exit(0)
}
const { evl, close } = await connectCdp()

// 语言切换用 setItem + i18n-changed 事件(与 SettingsPage 真实路径同语义)。
// 不用 location.reload(): 跨 reload 的 storage 写入存在间歇丢失
// (Chromium app:// 分区语义,见 ADR 0008),会让审计结果不确定。
await evl(`localStorage.setItem('${LANG_KEY}', '${LANG}'); location.hash = '#/dashboard'; window.dispatchEvent(new CustomEvent('i18n-changed', { detail: '${LANG}' }))`)
await sleep(3000)

const findings = []
for (const r of ROUTES) {
  await evl(`location.hash = '${r}'`)
  await sleep(WAIT)
  const res = await evl(`(() => {
    const els = document.querySelectorAll('body *')
    const out = []
    for (const el of els) {
      const txt = (el.children.length === 0 ? el.textContent : '').trim()
      if (txt && txt.length < 80) out.push({ t: txt, tag: el.tagName, ai: !!el.closest('.markdown-body') })
      const a = el.getAttribute('aria-label') || ''
      const ti = el.getAttribute('title') || ''
      if (a) out.push({ t: a, tag: el.tagName + '[aria]' })
      if (ti) out.push({ t: ti, tag: el.tagName + '[title]' })
    }
    return JSON.stringify(out.slice(0, 1500))
  })()`)
  let items = []
  try { items = JSON.parse(res) } catch { console.log('[audit] eval fail', r, String(res).slice(0, 100)) }
  for (const it of items) {
    if (/[\u4e00-\u9fff]/.test(it.t)) findings.push({ route: r, tag: it.tag, text: it.t.slice(0, 60), ai: !!it.ai })
  }
}

// =============================================================
// 数据文本豁免清单(ADR 0008)——en 模式下"渲染出中文"的预期来源。
// 原则: 反查 zh 字典值只能当线索;下方清单之外的命中才算真嫌疑。
// 四类(新增豁免必须注明来源依据):
//   1. EAA CLI 表格列头/统计词 —— Rust 二进制 --format table 输出
//   2. agent 角色名 —— config/agents.yaml 的 name 字段(运行时读取)
//   3. 班级/学生/事件名形态 —— 用户业务数据(正则形态识别)
//   4. settings 语言名 —— 国际惯例语言自称(如 '中文')
// =============================================================
const DATA_EXEMPT_EXACT = new Set([
  // —— 1. EAA CLI 表格列头与统计词(经 DOM 来源甄别,见 R17–R19 审计)——
  '序号', '姓名', '分数', '班级', '类型', '风险', '风险等级',
  '变动', '总分变化', '扣分', '撤销事件', '有效事件',
  '添加事件', '添加学生', '学生总数', '中', '低',
  // —— 4. settings 语言自称(语言列表里 zh 选项显示 '中文' 是特性)——
  '中文',
])

// —— 3. 业务数据形态: 班级名(R76班级-…/高一A班/3班)、学生名(何刚1fe)、
//         事件名(迟到/课堂睡觉/文明寝室)、AI 会话默认标题(对话 2026/…)——
const DATA_EXEMPT_PATTERNS = [
  /^(R\d+|R\d+[\u4e00-\u9fff]|[0-9A-Z]*-?cls|r\d+|G\d)/i,
  /班$|\(r?\d|（r?\d/i,
  /^[\u4e00-\u9fff]{1,3}[0-9a-z]{2,4}$/,
  /^\d+月\d+日$/,
  /^[\u4e00-\u9fff 0-9]*（共?\d+[人条个]）?$/,
]

// —— 2. agent 角色名: 运行时从 agents.yaml 提取 name 字段 ——
function loadAgentNames() {
  const set = new Set()
  try {
    const yaml = fs.readFileSync(path.join(ROOT, 'config/agents.yaml'), 'utf-8')
    for (const m of yaml.matchAll(/^\s*(?:- )?name:\s*['"]?([\u4e00-\u9fff][^'"\n]*)/gm)) {
      set.add(m[1].trim())
    }
  } catch {
    /* agents.yaml 不可读时跳过该豁免(多报不漏报) */
  }
  return set
}
const agentNames = loadAgentNames()

function classify(text, inAiContent) {
  if (inAiContent) return 'expected:ai-content'
  if (DATA_EXEMPT_EXACT.has(text)) return 'expected:cli-table'
  if (agentNames.has(text)) return 'expected:agent-name'
  if (DATA_EXEMPT_PATTERNS.some((re) => re.test(text))) return 'expected:business-data'
  return 'SUSPECT'
}

// 字典 zh 值反查: en 模式下渲染出 zh 字典值 = 硬编码渲染线索
const zhDict = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/i18n/zh.json'), 'utf-8'))
const zhVals = new Set(Object.values(zhDict))
const uniq = [...new Set(findings.map((f) => f.text))]
const hardcoded = uniq.filter((t) => LANG === 'en' && zhVals.has(t))

console.log(`[cdp-i18n-audit] lang=${LANG} 路由=${ROUTES.length}`)
console.log(`  中文文本: ${findings.length} 处 / 唯一 ${uniq.length}`)
if (LANG === 'en') {
  const buckets = { SUSPECT: [], 'expected:ai-content': [], 'expected:cli-table': [], 'expected:agent-name': [], 'expected:business-data': [] }
  const aiSet = new Set(findings.filter((f) => f.ai).map((f) => f.text))
  for (const t of hardcoded) buckets[classify(t, aiSet.has(t))].push(t)
  console.log(`  == zh 字典值: ${hardcoded.length} → 真嫌疑 ${buckets.SUSPECT.length} / 预期数据 ${hardcoded.length - buckets.SUSPECT.length}`)
  if (buckets.SUSPECT.length > 0) {
    console.log('  ⚠ 真嫌疑(需接线或豁免并注明依据):')
    for (const t of buckets.SUSPECT) console.log('   ⚠', t)
    const byRoute = {}
    for (const f of findings) {
      if (buckets.SUSPECT.includes(f.text)) byRoute[f.route] = (byRoute[f.route] || 0) + 1
    }
    console.log('  嫌疑分布:', JSON.stringify(byRoute))
  } else {
    console.log('  ✓ 无真嫌疑: UI 层零硬编码')
  }
  for (const k of ['expected:ai-content', 'expected:cli-table', 'expected:agent-name', 'expected:business-data']) {
    if (buckets[k].length > 0) console.log(`  [${k}] ${buckets[k].length}:`, buckets[k].slice(0, 10).join(' / '))
  }
  console.log('  依据: ADR 0008(EAA CLI 输出保持单语中文,数据文本非 UI 文案)')
}
close()

