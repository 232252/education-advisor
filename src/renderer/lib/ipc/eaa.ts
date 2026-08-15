// =============================================================
// IPC API 类型 — EAA 域 (window.api.eaa)
// 方法名与 preload 脚本一一对应,不可改动
// =============================================================

import type {
  AddEventParams,
  EAACodesData,
  EAADoctorData,
  EAAHistoryData,
  EAAInfoData,
  EAARangeData,
  EAARankItem,
  EAARankingData,
  EAAResult,
  EAASearchData,
  EAAStatsData,
  EAAStudentList,
  EAAStudentScore,
  EAASummaryData,
  EAATagDetailData,
  EAATagListData,
  EAAValidateData,
  SetStudentMetaParams,
} from '@shared/types'

export interface EaaAPI {
  info: () => Promise<EAAResult<EAAInfoData>>
  score: (name: string) => Promise<EAAResult<EAAStudentScore>>
  ranking: (n?: number) => Promise<EAAResult<EAARankingData>>
  replay: () => Promise<EAAResult<{ ranking: EAARankItem[] }>>
  addEvent: (params: AddEventParams) => Promise<EAAResult<string>>
  revertEvent: (eventId: string, reason: string) => Promise<EAAResult<string>>
  history: (name: string) => Promise<EAAResult<EAAHistoryData>>
  search: (query: string, limit?: number) => Promise<EAAResult<EAASearchData>>
  range: (start: string, end: string, limit?: number) => Promise<EAAResult<EAARangeData>>
  tag: (tag?: string) => Promise<EAAResult<EAATagListData | EAATagDetailData>>
  stats: () => Promise<EAAResult<EAAStatsData>>
  validate: () => Promise<EAAResult<EAAValidateData>>
  export: (format: string, outputFile?: string) => Promise<EAAResult<string>>
  listStudents: () => Promise<EAAResult<EAAStudentList>>
  addStudent: (name: string) => Promise<EAAResult<string>>
  deleteStudent: (name: string, reason?: string) => Promise<EAAResult<string>>
  setStudentMeta: (params: SetStudentMetaParams) => Promise<EAAResult<string>>
  import: (filePath: string) => Promise<EAAResult<string>>
  codes: () => Promise<EAAResult<EAACodesData>>
  doctor: () => Promise<EAAResult<EAADoctorData>>
  summary: (since?: string, until?: string) => Promise<EAAResult<EAASummaryData>>
  dashboard: (outputDir?: string) => Promise<EAAResult<string>>
  exportFormats: () => Promise<string[]>
  invalidateCache: () => Promise<{ success: boolean }>
}
