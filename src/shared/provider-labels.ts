// =============================================================
// pi 内置厂商的中文显示名与搜索别名
// 目录本身以 vendor/pi-ai builtinProviders() 为准,这里只翻译/可搜。
// =============================================================

/** 国内常用叫法;未列出的厂商沿用 pi 的英文 name */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  zai: '智谱 Z.AI（国际）',
  'zai-coding-cn': '智谱（中国）',
  minimax: 'MiniMax（国际）',
  'minimax-cn': 'MiniMax（中国）',
  moonshotai: 'Moonshot AI（国际）',
  'moonshotai-cn': 'Moonshot AI（中国）',
  'kimi-coding': 'Kimi For Coding',
  'qwen-token-plan': '通义千问 Token Plan（国际）',
  'qwen-token-plan-cn': '通义千问 Token Plan（中国）',
  'qwen-token-plan-individual': '通义千问 Token Plan（个人）',
  xiaomi: '小米 MiMo',
  'xiaomi-token-plan-cn': '小米 Token Plan（中国）',
  'xiaomi-token-plan-ams': '小米 Token Plan（阿姆斯特丹）',
  'xiaomi-token-plan-sgp': '小米 Token Plan（新加坡）',
  'ant-ling': '蚂蚁 Ant Ling',
  deepseek: 'DeepSeek 深度求索',
}

/** 搜索别名: 中文俗称对不上 pi 的英文 id/name */
export const PROVIDER_SEARCH_ALIASES: Record<string, string[]> = {
  zai: ['智谱', 'zhipu', 'glm', 'z.ai'],
  'zai-coding-cn': ['智谱', 'zhipu', 'glm', '中国版', '智谱中国版', 'bigmodel'],
  minimax: ['海螺', 'minimax'],
  'minimax-cn': ['海螺', 'minimax', '中国版'],
  moonshotai: ['月之暗面', 'kimi', 'moonshot'],
  'moonshotai-cn': ['月之暗面', 'kimi', 'moonshot', '中国版'],
  'kimi-coding': ['月之暗面', 'kimi', 'moonshot'],
  'qwen-token-plan': ['通义', '千问', 'qwen', '阿里'],
  'qwen-token-plan-cn': ['通义', '千问', 'qwen', '阿里', '中国版'],
  'qwen-token-plan-individual': ['通义', '千问', 'qwen', '阿里'],
  xiaomi: ['小米', 'mimo'],
  'xiaomi-token-plan-cn': ['小米', 'mimo', '中国版'],
  'xiaomi-token-plan-ams': ['小米', 'mimo'],
  'xiaomi-token-plan-sgp': ['小米', 'mimo'],
  'ant-ling': ['蚂蚁', '百灵'],
  deepseek: ['深度求索', 'deepseek'],
}

export function providerDisplayName(id: string, fallback: string): string {
  return PROVIDER_DISPLAY_NAMES[id] ?? fallback
}

export function providerSearchAliases(id: string): string[] {
  return PROVIDER_SEARCH_ALIASES[id] ?? []
}
