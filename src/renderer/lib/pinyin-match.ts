// =============================================================
// pinyin-match — 中文文本拼音匹配层(共享)
// 纯字母查询时按拼音命中: "zs"→张三(首字母) / "zhang"→全拼前缀 /
// "angs"→全拼子串。查询含汉字/数字/符号时用户意图即原样匹配,
// 本层不参与(原行为不变)。
// 消费方: 命令面板(palette-search) / 学生列表过滤(student-filters)。
// pinyin-pro 词典较重(~288KB),仅被异步 chunk 引用 — rolldown 自动
// 提为共享异步块,entry 零成本。
// =============================================================

import { pinyin } from 'pinyin-pro'

const ASCII_QUERY = /^[a-z]+$/

/** 文本拼音键缓存(姓名量级 ≤ 数千,会话内无淘汰必要) */
const pinyinCache = new Map<string, { initials: string; full: string }>()

function pinyinKeys(text: string): { initials: string; full: string } {
  let keys = pinyinCache.get(text)
  if (!keys) {
    keys = {
      initials: pinyin(text, { pattern: 'first', toneType: 'none' }).replace(/\s+/g, ''),
      full: pinyin(text, { toneType: 'none' }).replace(/\s+/g, ''),
    }
    pinyinCache.set(text, keys)
  }
  return keys
}

/**
 * 拼音命中评分: 首字母前缀 95 / 全拼前缀 85 / 全拼子串 75(随位置衰减)
 * — 介于直接文本命中(100)与次级字段(0.5~0.6x)之间。
 * 非纯小写字母查询或未命中返回 -1。
 */
export function pinyinScore(query: string, text: string): number {
  if (!ASCII_QUERY.test(query)) return -1
  const { initials, full } = pinyinKeys(text)
  if (initials.startsWith(query)) return 95
  if (full.startsWith(query)) return 85
  const idx = full.indexOf(query)
  return idx >= 0 ? 75 - Math.min(idx, 20) : -1
}
