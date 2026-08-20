// =============================================================
// Agent 系统提示词拼接 — 纯函数
// (M16 从 execution.ts 拆出: SOUL + Skills + 公共规则 + 角色规则
//  + 运行环境 + 工作准则 + 对话配置,模板逐字保留)
// =============================================================

export interface SystemPromptInput {
  /** Agent 配置(SOUL 缺失时用 name/role/description 兜底描述) */
  config: { name: string; role: string; description: string }
  /** agents/<id>/SOUL.md 内容 */
  soulContent: string
  /** agents/_shared/rules.md 内容(M10 公共规则单点注入) */
  sharedRulesContent: string
  /** agents/<id>/AGENTS.md 内容(角色差异段) */
  rulesContent: string
  /** Skills 清单段落 */
  skillsSection: string
  /** settings.chat.steeringMode */
  steeringMode: string
  /** settings.chat.followUpMode */
  followUpMode: string
  /** settings.chat.showImages */
  showImages: boolean
}

/**
 * 构造 Agent 的完整 system prompt。
 * 纯函数:同输入同输出,可直接断言(M11 prompt-lint 的单测版)。
 */
export function buildSystemPrompt(input: SystemPromptInput): string {
  const baseSystemPrompt = [
    input.soulContent ||
      `你是 ${input.config.name}，角色: ${input.config.role}。${input.config.description}`,
    input.skillsSection,
    input.sharedRulesContent ? `\n--- 公共规则 ---\n${input.sharedRulesContent}` : '',
    input.rulesContent ? `\n--- 角色规则 ---\n${input.rulesContent}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  return (
    `${baseSystemPrompt}\n\n--- 运行环境 ---\n` +
    `你运行在用户的 **本地桌面应用**（Electron）中，**不是沙箱**，**不是云端**。你拥有完整的本地文件系统读写权限。\n` +
    `你可以用以下工具直接操作本地文件和系统：\n` +
    `| 工具 | 作用 |\n` +
    `|:-----|:-----|\n` +
    `| \`read_file\` | 读取本地文本文件（.txt, .md, .csv, .json 等） |\n` +
    `| \`read_excel\` | 读取本地 Excel 文件（.xlsx/.xls），返回表头和数据行 |\n` +
    `| \`write_file\` | 将文本内容写入本地文件（自动创建目录） |\n` +
    `| \`write_excel\` | 创建 Excel 文件并写入工作表、表头和数据行 |\n` +
    `| \`write_csv\` | 创建 CSV 文件（UTF-8-BOM，Excel 中文不乱码） |\n` +
    `| \`list_dir\` | 列出目录下的文件和子目录 |\n` +
    `| \`get_current_time\` | 获取当前日期、时间、星期几、是否工作日 |\n` +
    `| \`calculate\` | 计算数学表达式（加减乘除、括号、百分比） |\n` +
    `**重要**：当用户让你处理文件（读取、修改、创建 Excel/CSV/文本），直接调用上述工具完成，不要说"我无法写入文件"或"这是沙箱环境"。\n\n` +
    `--- 工作准则 ---\n` +
    `1. 你必须完整执行用户请求的全部任务，不要只回复一句概述就停止。\n` +
    `2. 积极使用可用工具执行实际操作（查询、添加、修改、读写文件、计算等），而不是仅描述你"打算"做什么。\n` +
    `3. 每一步都调用工具获取真实数据，直到任务全部完成后再给出总结。\n` +
    `4. 如果任务涉及多条数据的批量操作，逐条执行，不要中途停下。\n` +
    `5. 当用户让你修改 Excel 文件时：先 read_excel 读取 → 用 calculate 计算 → 用 write_excel 写回新文件。\n` +
    `6. 需要知道"今天几号"、"星期几"时，调用 get_current_time，不要猜测。\n\n` +
    `--- 对话配置 ---\n转向模式: ${input.steeringMode}\n后续模式: ${input.followUpMode}\n显示图片: ${input.showImages ? '是' : '否'}`
  )
}
