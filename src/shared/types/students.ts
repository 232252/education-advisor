// =============================================================
// 学生 Excel 批量导入类型（M30）
// 主进程解析 xlsx（renderer bundle 不引入 xlsx），
// parse-excel 返回预览 + 冲突检测，确认后 import-excel 逐条 add-student
// =============================================================

/** Excel 导入：预览表格中的单行（已通过解析与冲突检测，可导入） */
export interface StudentImportRow {
  /** Excel 行号（1-based，含表头；表头为第 1 行，数据从第 2 行起） */
  row: number
  /** 学生姓名（name 必填列） */
  name: string
  /** 学号（student_id 可选列，仅预览展示，EAA 无对应字段） */
  studentId: string
  /** 班级名（class_name 可选列，原文） */
  className: string
  /** className 解析出的 class_id（匹配本地班级列表的名称或编号；未填为 null） */
  classId: string | null
}

/** Excel 导入：行级问题（不导入的行） */
export interface StudentImportRowError {
  /** Excel 行号（1-based，含表头） */
  row: number
  /** 学生姓名（可能为空） */
  name: string
  /** 机器可读原因码，渲染层翻译展示 */
  reason:
    | 'empty_row'
    | 'missing_name'
    | 'duplicate_in_file'
    | 'already_exists'
    | 'class_not_found'
    | 'invalid_name'
}

/** students/parse-excel 返回：解析 + 冲突检测结果 */
export interface StudentImportPreview {
  success: boolean
  error?: string
  /** 合法可导入行 */
  rows: StudentImportRow[]
  /** 行级问题清单（空行/缺姓名/文件内重名/已存在/班级不存在） */
  errors: StudentImportRowError[]
  /** 数据区总行数（不含表头，含空行与问题行） */
  totalRows: number
}

/** students/import-excel 入参：预览确认后的待导入行 */
export interface StudentImportParams {
  rows: Array<{
    /** Excel 行号（用于失败清单回溯） */
    row: number
    name: string
    classId?: string | null
  }>
}

/** students/import-excel 单行失败明细 */
export interface StudentImportFailure {
  /** Excel 行号（入参回传，0 表示未知） */
  row: number
  name: string
  /** 失败原因（EAA stderr 或本地校验错误） */
  error: string
}

/** students/import-excel 返回 */
export interface StudentImportResult {
  success: boolean
  error?: string
  /** 本次尝试导入的总行数 */
  total: number
  imported: number
  failed: StudentImportFailure[]
}

/** students/import-progress 推送（主→渲染，复用 class:assign-progress 模式） */
export interface StudentImportProgress {
  current: number
  total: number
  imported: number
  lastName: string
}

/** students/import-template 返回 */
export interface StudentImportTemplateResult {
  success: boolean
  error?: string
  filePath?: string
}
