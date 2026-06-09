/**
 * PR-G01: 定时任务权限控制
 * 方案G定时任务核心安全组件
 *
 * 功能：
 * 1. 基于RBAC的任务执行权限校验
 * 2. 敏感任务二次确认：删除/审批等高危操作需二次确认
 * 3. 任务执行日志：完整记录操作者/时间/操作/结果
 *
 * 高危攻击点G7：定时任务权限控制缺失 → P0必须实现
 *
 * 修复记录：
 * - #G01-003: 使用crypto.createHmac实现真正的HMAC签名
 */
/**
 * Session上下文
 * 用于在异步调用链中传递操作者身份
 */
export interface SessionContext {
    operator: string;
    role: SchedulerRole;
    sessionId: string;
    traceId: string;
}
/**
 * 创建Session上下文
 */
export declare function createSessionContext(operator: string, role: SchedulerRole, sessionId: string): SessionContext;
/**
 * 注册Session
 */
export declare function registerSession(ctx: SessionContext): void;
/**
 * 获取Session
 */
export declare function getSession(sessionId: string): SessionContext | undefined;
/**
 * 清除Session
 */
export declare function clearSession(sessionId: string): void;
/**
 * 定时任务操作类型
 */
export type SchedulerAction = 'job:create' | 'job:read' | 'job:update' | 'job:delete' | 'job:execute' | 'job:pause' | 'job:resume';
/**
 * 敏感操作类型（需要二次确认）
 * #G01-003修复：加入job:update
 */
export declare const SENSITIVE_ACTIONS: SchedulerAction[];
/**
 * 定时任务RBAC角色
 */
export type SchedulerRole = 'admin' | 'operator' | 'viewer';
/**
 * 检查权限（基于上下文）
 */
export declare function hasSchedulerPermission(action: SchedulerAction, role: SchedulerRole): boolean;
/**
 * 检查是否为敏感操作
 */
export declare function isSensitiveAction(action: SchedulerAction): boolean;
/**
 * 请求二次确认
 * #G01-001修复：使用crypto.randomUUID()，签名绑定操作上下文
 * @returns 确认token
 */
export declare function requestConfirmation(action: SchedulerAction, jobId: string, operator: string, payload?: unknown): string;
/**
 * 确认操作
 * #G01-002修复：通过sessionContext自动获取operator，不接受外部参数
 * @returns 是否确认成功
 */
export declare function confirmOperation(token: string, sessionId: string): boolean;
/**
 * 取消确认
 * #G01-002修复：通过sessionContext验证
 */
export declare function cancelConfirmation(token: string, sessionId: string): boolean;
/**
 * 获取待确认操作信息（用于展示）
 */
export declare function getPendingConfirmation(token: string, sessionId: string): {
    action: SchedulerAction;
    jobId: string;
    operator: string;
    timestamp: number;
} | null;
/**
 * 日志级别
 */
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'AUDIT';
/**
 * 任务执行日志
 */
export interface SchedulerAuditLog {
    logId: string;
    timestamp: string;
    level: LogLevel;
    operation: SchedulerAction;
    jobId: string;
    operator: string;
    operatorRole: SchedulerRole;
    result: 'success' | 'failure';
    errorCode?: string;
    errorMessage?: string;
    duration: number;
    traceId: string;
    ip?: string;
    userAgent?: string;
}
/**
 * 记录审计日志
 */
export declare function logSchedulerOperation(operation: SchedulerAction, jobId: string, operator: string, operatorRole: SchedulerRole, result: 'success' | 'failure', options: {
    errorCode?: string;
    errorMessage?: string;
    duration: number;
    ip?: string;
    userAgent?: string;
}): SchedulerAuditLog;
/**
 * 查询审计日志
 */
export declare function queryAuditLogs(filters: {
    jobId?: string;
    operator?: string;
    operation?: SchedulerAction;
    startTime?: string;
    endTime?: string;
    limit?: number;
}): SchedulerAuditLog[];
/**
 * 调度器操作结果
 */
export interface SchedulerOperationResult {
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
    traceId: string;
    data?: unknown;
}
/**
 * 执行调度器操作（含权限校验）
 */
export declare function executeSchedulerOperation(action: SchedulerAction, jobId: string, sessionId: string, executor: () => Promise<unknown>, options?: {
    ip?: string;
    userAgent?: string;
    confirmationToken?: string;
}): Promise<SchedulerOperationResult>;
/**
 * 调度器操作装饰器
 */
export declare function schedulerAction(action: SchedulerAction): (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => PropertyDescriptor;
declare const _default: {
    SessionContext: any;
    createSessionContext: typeof createSessionContext;
    registerSession: typeof registerSession;
    getSession: typeof getSession;
    clearSession: typeof clearSession;
    SchedulerRole: any;
    SchedulerAction: any;
    hasSchedulerPermission: typeof hasSchedulerPermission;
    isSensitiveAction: typeof isSensitiveAction;
    requestConfirmation: typeof requestConfirmation;
    confirmOperation: typeof confirmOperation;
    cancelConfirmation: typeof cancelConfirmation;
    getPendingConfirmation: typeof getPendingConfirmation;
    logSchedulerOperation: typeof logSchedulerOperation;
    queryAuditLogs: typeof queryAuditLogs;
    executeSchedulerOperation: typeof executeSchedulerOperation;
    schedulerAction: typeof schedulerAction;
};
export default _default;
//# sourceMappingURL=scheduler-rbac.d.ts.map