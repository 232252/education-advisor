// =============================================================
// 智能体提问 API — dsh 运行时向教师提问，渲染进程弹出结构化问答
//
// 结构镜像 @deepseek-ai/dsh-user-questions 的公开类型，但教师端不直接
// 依赖该包（跨进程边界只做结构兼容，见 wire-types.ts 的约定）。
// 只承载「提问」（澄清类），不承载「审批」（危险工具授权）。
// =============================================================

/** 一个可选答案 */
export interface AgentQuestionOption {
  label: string
  description?: string
}

/** 一个问题 */
export interface AgentQuestionItem {
  /** 调用方给定的稳定问题 id，作答时原样回传 */
  id: string
  question: string
  detail?: string
  header?: string
  options?: AgentQuestionOption[]
  /** 是否多选，默认单选 */
  multiSelect?: boolean
}

/** 主进程推给渲染进程的一次提问请求 */
export interface AgentQuestionRequest {
  /** 关联取消与作答的唯一 id */
  requestId: string
  sessionId: string
  questions: AgentQuestionItem[]
}

/** 单个问题的作答 */
export interface AgentQuestionAnswerItem {
  id: string
  /** 选中的选项 label */
  selected: string[]
  /** 自由文本（「其它」） */
  custom?: string
}

/** 教师的整组作答 */
export interface AgentQuestionAnswer {
  answers: AgentQuestionAnswerItem[]
}

export interface AgentQuestionAPI {
  /** 教师作答或取消（cancelled=true 表示取消，绝不等于同意） */
  respond: (
    requestId: string,
    result: AgentQuestionAnswer | { cancelled: true },
  ) => Promise<{ success: boolean }>
  /** 订阅主进程弹出的提问，返回退订函数 */
  onRequest: (callback: (req: AgentQuestionRequest) => void) => () => void
}
