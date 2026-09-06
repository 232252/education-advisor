// =============================================================
// 班级上下文提供者 — system prompt 的「当前班级」段(R2-05)
//
// 目的:AI 开场即知"你的班"(名称/年级/人数/班主任/科目构成),
// 否则教师问"我们班最近怎么样"模型只能泛泛而谈。
// 数据全部来自既有服务(classes 表 + EAA list-students + academics 配置),
// 本模块只做拼装与 5 分钟 TTL 缓存(班级元数据变更频率极低,学期初设置一次)。
// 无班级/查询失败时返回空 —— 调用方整段省略,绝不输出占位垃圾。
// =============================================================

import { academicService } from '../academic-service'
import { classService } from '../class-service'
import { eaaBridge } from '../eaa-bridge'

interface ClassContextInfo {
  className: string
  grade?: string
  teacher?: string
  studentCount?: number
  subjects?: string[]
}

const CACHE_TTL_MS = 5 * 60_000

let cached: { at: number; info: ClassContextInfo | null } | null = null

/** 从既有数据源拼装班级信息;拿不到班级时返回 null */
export async function getClassContext(): Promise<ClassContextInfo | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.info
  const info = await loadClassContext()
  cached = { at: Date.now(), info }
  return info
}

/** 测试与调用方需要强制刷新时使用 */
export function invalidateClassContextCache(): void {
  cached = null
}

async function loadClassContext(): Promise<ClassContextInfo | null> {
  try {
    // 当前活跃班 = 第一个未存档班级(产品主线是单班主任单班;多班留待会话级选择)
    const cls = classService.list().find((c) => !c.archived)
    if (!cls) return null

    const info: ClassContextInfo = {
      className: cls.name || cls.class_id,
      grade: cls.grade || undefined,
      teacher: cls.teacher || undefined,
    }

    // 学生数: EAA 学生列表按 class_id 过滤;任何异常都降级为不注入该行
    try {
      const result = await eaaBridge.execute({ command: 'list-students', args: [] })
      if (result.success) {
        const data = result.data as unknown
        const students = Array.isArray(data)
          ? data
          : Array.isArray((data as { students?: unknown[] })?.students)
            ? (data as { students: unknown[] }).students
            : []
        if (students.length > 0) {
          const inClass = students.filter(
            (s) =>
              typeof s === 'object' &&
              s !== null &&
              (s as { class_id?: string }).class_id === cls.class_id,
          )
          // 只在过滤命中时才注入人数 — 过滤为空(班级数据错位)时兜底成
          // 全库学生数会往 system prompt 塞一个错误锚定数字,宁缺勿错
          if (inClass.length > 0) info.studentCount = inClass.length
        }
      }
    } catch {
      // list-students 失败不阻断其余字段
    }

    // 科目构成: academics 配置(DEFAULT 兜底),只取科目显示名
    try {
      const config = await academicService.getConfig()
      if (config.subjects?.length) info.subjects = config.subjects.map((s) => s.name)
    } catch {
      // config 读取失败不阻断
    }

    return info
  } catch {
    return null
  }
}

/**
 * 构建「当前班级」prompt 段;无信息时返回空串(整段省略)。
 * 纯函数便于单测(M16 惯例)。
 */
export function buildClassContextSection(info: ClassContextInfo | null): string {
  if (!info?.className) return ''
  const lines: string[] = ['--- 当前班级 ---']
  lines.push(`- 班级：${info.className}`)
  if (info.grade) lines.push(`- 年级：${info.grade}`)
  if (info.teacher) lines.push(`- 班主任：${info.teacher}`)
  if (typeof info.studentCount === 'number') lines.push(`- 学生人数：${info.studentCount}`)
  if (info.subjects?.length) lines.push(`- 考试科目：${info.subjects.join('、')}`)
  lines.push('- 回答"我们班"相关问题时以此班级为准；人数等统计数字仍应经工具实时核实。')
  return lines.join('\n')
}

/** execution.ts 消费入口:取数 + 拼段一体化;失败静默为空段 */
export async function getClassContextSection(): Promise<string> {
  try {
    return buildClassContextSection(await getClassContext())
  } catch {
    return ''
  }
}
