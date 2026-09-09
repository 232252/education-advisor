// =============================================================
// 测试域对象工厂单一来源 —— EAAStudent/GradeRecord/ExamDef/
// EAAEventRecord/AgentListItem 的标准构造器。
// 历史上各测试文件默认字面值不同:与这里一致的直接导入使用;
// 不同的文件用一行适配器覆盖默认值(见各测试文件顶部)。
// =============================================================
import type {
  AgentListItem,
  EAAEventRecord,
  EAAStudent,
  ExamDef,
  GradeRecord,
} from '@shared/types'

export function makeStudent(overrides: Partial<EAAStudent> = {}): EAAStudent {
  return {
    name: '张三',
    entity_id: 'ent-1',
    score: 100,
    delta: 0,
    risk: '低',
    status: 'Active',
    events_count: 0,
    groups: [],
    roles: [],
    class_id: null,
    ...overrides,
  }
}

export function makeGrade(overrides: Partial<GradeRecord> = {}): GradeRecord {
  return {
    examId: 'exam-1',
    subjectId: 'chinese',
    studentName: '张三',
    score: 90,
    fullMark: 150,
    updatedAt: '2025-11-02T00:00:00Z',
    ...overrides,
  }
}

export function makeExam(overrides: Partial<ExamDef> = {}): ExamDef {
  return {
    id: 'exam-1',
    name: '期中考试',
    type: 'midterm',
    date: '2025-11-01',
    semester: '2025-2026-1',
    subjects: ['chinese', 'math'],
    createdAt: '2025-11-02T00:00:00Z',
    ...overrides,
  }
}

export function makeEvent(overrides: Partial<EAAEventRecord> = {}): EAAEventRecord {
  return {
    event_id: 'ev1',
    name: '学生',
    entity_id: 'e1',
    timestamp: '2026-01-01T00:00:00Z',
    event_type: 'ConductBonus',
    reason_code: 'R1',
    original_reason: 'r',
    score_delta: 1,
    note: '',
    tags: [],
    operator: 'op',
    is_valid: true,
    reverted_by: null,
    ...overrides,
  }
}

export function makeAgent(overrides: Partial<AgentListItem> = {}): AgentListItem {
  return {
    id: 'a1',
    name: 'A1',
    role: 'tester',
    description: 'unit test agent',
    enabled: true,
    modelTier: 'low_cost',
    schedule: [],
    capabilities: [],
    status: 'idle',
    ...overrides,
  }
}
