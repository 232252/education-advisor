// =============================================================
// 班级管理类型 — 班级记录 / 调班参数（本地管理，class_id 与 EAA 对齐）
// =============================================================

/** 班级记录（本地管理：存档/删除）。class_id 与 EAA 学生 class_id 对齐 */
export interface ClassEntity {
  id: string
  /** 班级编号，与 EAA 学生 class_id 对齐，如 "G7-3" */
  class_id: string
  /** 班级显示名称，如 "七年级3班" */
  name: string
  /** 年级，如 "七年级" */
  grade?: string
  /** 备注 */
  note?: string
  /** 班主任姓名 */
  teacher?: string
  /** 是否已存档（不再教这个班，默认隐藏该班学生） */
  archived: boolean
  created_at: number
  archived_at?: number
}

/** 新建/更新班级的参数 */
export interface ClassUpsertParams {
  class_id: string
  name: string
  grade?: string
  note?: string
  teacher?: string
}

/** 调班：把学生分到某个班级（EAA class_id 同步更新） */
export interface ClassAssignParams {
  class_id: string
  student_names: string[]
}

/** 调班：单个学生退出班级（清空 EAA class_id） */
export interface ClassRemoveStudentParams {
  student_name: string
}

/** 班级下学生列表返回 */
export interface ClassStudentsResult {
  class_id: string
  students: Array<{
    name: string
    entity_id: string
    status: string
    score: number
    risk: string
    events_count: number
  }>
}
