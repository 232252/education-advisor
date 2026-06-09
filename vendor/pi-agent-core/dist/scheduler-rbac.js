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
import { createHmac } from 'crypto';
/**
 * Session存储（实际应使用Redis等外部存储）
 */
const sessionStore = new Map();
/**
 * 创建Session上下文
 */
export function createSessionContext(operator, role, sessionId) {
    return {
        operator,
        role,
        sessionId,
        traceId: `scheduler-${Date.now()}-${crypto.randomUUID().split('-')[0]}`,
    };
}
/**
 * 注册Session
 */
export function registerSession(ctx) {
    sessionStore.set(ctx.sessionId, ctx);
}
/**
 * 获取Session
 */
export function getSession(sessionId) {
    return sessionStore.get(sessionId);
}
/**
 * 清除Session
 */
export function clearSession(sessionId) {
    sessionStore.delete(sessionId);
}
/**
 * 敏感操作类型（需要二次确认）
 * #G01-003修复：加入job:update
 */
export const SENSITIVE_ACTIONS = [
    'job:delete',
    'job:execute', // 手动触发执行
    'job:update', // 修改任务配置
];
/**
 * 角色权限映射
 */
const ROLE_PERMISSIONS = {
    admin: new Set([
        'job:create', 'job:read', 'job:update',
        'job:delete', 'job:execute', 'job:pause', 'job:resume',
    ]),
    operator: new Set([
        'job:create', 'job:read', 'job:update',
        'job:execute', 'job:pause', 'job:resume',
    ]),
    viewer: new Set([
        'job:read',
    ]),
};
/**
 * 检查权限（基于上下文）
 */
export function hasSchedulerPermission(action, role) {
    const permissions = ROLE_PERMISSIONS[role];
    return permissions.has(action);
}
/**
 * 检查是否为敏感操作
 */
export function isSensitiveAction(action) {
    return SENSITIVE_ACTIONS.includes(action);
}
/**
 * 确认token存储
 * 使用crypto.randomUUID()作为key
 */
const pendingConfirmations = new Map();
/**
 * 确认token有效期（5分钟）
 */
const CONFIRMATION_TOKEN_TTL = 5 * 60 * 1000;
/**
 * HMAC签名密钥（实际应从KMS加载）
 * #G01-004修复：强密钥要求
 */
const HMAC_SECRET = process.env.SCHEDULER_HMAC_SECRET;
if (!HMAC_SECRET) {
    throw new Error('SCHEDULER_HMAC_SECRET environment variable is required');
}
/**
 * 生成HMAC签名
 * #G01-003修复：使用crypto.createHmac实现真正的HMAC-SHA256
 * 绑定 token 与 (operator, action, jobId, timestamp)
 */
function generateSignature(token, operator, action, jobId, timestamp) {
    const hmac = createHmac('sha256', HMAC_SECRET);
    hmac.update(`${token}:${operator}:${action}:${jobId}:${timestamp}`);
    return hmac.digest('hex');
}
/**
 * 验证HMAC签名
 */
function verifySignature(token, operator, action, jobId, timestamp, signature) {
    const expected = generateSignature(token, operator, action, jobId, timestamp);
    return expected === signature;
}
/**
 * 请求二次确认
 * #G01-001修复：使用crypto.randomUUID()，签名绑定操作上下文
 * @returns 确认token
 */
export function requestConfirmation(action, jobId, operator, payload) {
    if (!isSensitiveAction(action)) {
        throw new Error(`Action '${action}' does not require confirmation`);
    }
    const token = crypto.randomUUID();
    const timestamp = Date.now();
    const signature = generateSignature(token, operator, action, jobId, timestamp);
    pendingConfirmations.set(token, {
        action,
        jobId,
        operator,
        timestamp,
        payload,
        signature,
    });
    // 5分钟后自动过期
    setTimeout(() => {
        pendingConfirmations.delete(token);
    }, CONFIRMATION_TOKEN_TTL);
    return token;
}
/**
 * 确认操作
 * #G01-002修复：通过sessionContext自动获取operator，不接受外部参数
 * @returns 是否确认成功
 */
export function confirmOperation(token, sessionId) {
    const confirmation = pendingConfirmations.get(token);
    if (!confirmation) {
        return false;
    }
    // 从session上下文获取operator，不接受外部传入
    const session = getSession(sessionId);
    if (!session) {
        return false; // 无效session
    }
    // 操作者必须与请求确认时一致
    if (confirmation.operator !== session.operator) {
        return false;
    }
    // 验证签名
    if (!verifySignature(token, confirmation.operator, confirmation.action, confirmation.jobId, confirmation.timestamp, confirmation.signature)) {
        return false; // 签名不匹配
    }
    // 检查过期
    if (Date.now() - confirmation.timestamp > CONFIRMATION_TOKEN_TTL) {
        pendingConfirmations.delete(token);
        return false;
    }
    pendingConfirmations.delete(token);
    return true;
}
/**
 * 取消确认
 * #G01-002修复：通过sessionContext验证
 */
export function cancelConfirmation(token, sessionId) {
    const confirmation = pendingConfirmations.get(token);
    if (!confirmation) {
        return false;
    }
    const session = getSession(sessionId);
    if (!session || confirmation.operator !== session.operator) {
        return false;
    }
    pendingConfirmations.delete(token);
    return true;
}
/**
 * 获取待确认操作信息（用于展示）
 */
export function getPendingConfirmation(token, sessionId) {
    const confirmation = pendingConfirmations.get(token);
    if (!confirmation) {
        return null;
    }
    const session = getSession(sessionId);
    if (!session || confirmation.operator !== session.operator) {
        return null;
    }
    if (Date.now() - confirmation.timestamp > CONFIRMATION_TOKEN_TTL) {
        pendingConfirmations.delete(token);
        return null;
    }
    return {
        action: confirmation.action,
        jobId: confirmation.jobId,
        operator: confirmation.operator,
        timestamp: confirmation.timestamp,
    };
}
/**
 * 日志存储（实际应发送到Loki）
 */
const auditLogs = [];
/**
 * 生成日志ID
 */
function generateLogId() {
    return `log-${Date.now()}-${crypto.randomUUID().split('-')[0]}`;
}
/**
 * 生成TraceID
 */
function generateTraceId() {
    return `scheduler-${Date.now()}-${crypto.randomUUID().split('-')[0]}`;
}
/**
 * 记录审计日志
 */
export function logSchedulerOperation(operation, jobId, operator, operatorRole, result, options) {
    const log = {
        logId: generateLogId(),
        timestamp: new Date().toISOString(),
        level: result === 'failure' ? 'ERROR' : 'AUDIT',
        operation,
        jobId,
        operator,
        operatorRole,
        result,
        errorCode: options.errorCode,
        errorMessage: options.errorMessage,
        duration: options.duration,
        traceId: generateTraceId(),
        ip: options.ip,
        userAgent: options.userAgent,
    };
    auditLogs.push(log);
    // 实际应发送到Loki/ELK
    console.log(JSON.stringify(log));
    return log;
}
/**
 * 查询审计日志
 */
export function queryAuditLogs(filters) {
    let results = [...auditLogs];
    if (filters.jobId) {
        results = results.filter(log => log.jobId === filters.jobId);
    }
    if (filters.operator) {
        results = results.filter(log => log.operator === filters.operator);
    }
    if (filters.operation) {
        results = results.filter(log => log.operation === filters.operation);
    }
    if (filters.startTime) {
        results = results.filter(log => log.timestamp >= filters.startTime);
    }
    if (filters.endTime) {
        results = results.filter(log => log.timestamp <= filters.endTime);
    }
    if (filters.limit) {
        results = results.slice(-filters.limit);
    }
    return results;
}
/**
 * 执行调度器操作（含权限校验）
 */
export async function executeSchedulerOperation(action, jobId, sessionId, executor, options = {}) {
    const traceId = generateTraceId();
    const startTime = Date.now();
    // 0. 获取Session上下文
    const session = getSession(sessionId);
    if (!session) {
        return {
            success: false,
            errorCode: 'INVALID_SESSION',
            errorMessage: 'Invalid or expired session',
            traceId,
        };
    }
    // 1. 权限校验（基于session上下文）
    if (!hasSchedulerPermission(action, session.role)) {
        const result = {
            success: false,
            errorCode: 'PERMISSION_DENIED',
            errorMessage: `Role '${session.role}' cannot perform action '${action}'`,
            traceId,
        };
        logSchedulerOperation(action, jobId, session.operator, session.role, 'failure', {
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
            duration: Date.now() - startTime,
            ip: options.ip,
            userAgent: options.userAgent,
        });
        return result;
    }
    // 2. 敏感操作二次确认校验
    if (isSensitiveAction(action)) {
        if (!options.confirmationToken || !confirmOperation(options.confirmationToken, sessionId)) {
            const result = {
                success: false,
                errorCode: 'CONFIRMATION_REQUIRED',
                errorMessage: `Sensitive action '${action}' requires confirmation`,
                traceId,
            };
            logSchedulerOperation(action, jobId, session.operator, session.role, 'failure', {
                errorCode: result.errorCode,
                errorMessage: result.errorMessage,
                duration: Date.now() - startTime,
                ip: options.ip,
                userAgent: options.userAgent,
            });
            return result;
        }
    }
    // 3. 执行操作
    try {
        const data = await executor();
        logSchedulerOperation(action, jobId, session.operator, session.role, 'success', {
            duration: Date.now() - startTime,
            ip: options.ip,
            userAgent: options.userAgent,
        });
        return {
            success: true,
            traceId,
            data,
        };
    }
    catch (error) {
        const result = {
            success: false,
            errorCode: 'EXECUTION_ERROR',
            errorMessage: error instanceof Error ? error.message : 'Unknown execution error',
            traceId,
        };
        logSchedulerOperation(action, jobId, session.operator, session.role, 'failure', {
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
            duration: Date.now() - startTime,
            ip: options.ip,
            userAgent: options.userAgent,
        });
        return result;
    }
}
/**
 * 调度器操作装饰器
 */
export function schedulerAction(action) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (jobId, sessionId, options) {
            const result = await executeSchedulerOperation(action, jobId, sessionId, () => originalMethod.apply(this, [jobId, sessionId, options]), options || {});
            if (!result.success) {
                throw new Error(result.errorMessage);
            }
            return result.data;
        };
        return descriptor;
    };
}
// ============================================================
// 导出所有模块
// ============================================================
export default {
    // Session Context
    SessionContext,
    createSessionContext,
    registerSession,
    getSession,
    clearSession,
    // RBAC
    SchedulerRole,
    SchedulerAction,
    hasSchedulerPermission,
    isSensitiveAction,
    // 二次确认
    requestConfirmation,
    confirmOperation,
    cancelConfirmation,
    getPendingConfirmation,
    // 审计日志
    logSchedulerOperation,
    queryAuditLogs,
    // 执行器
    executeSchedulerOperation,
    schedulerAction,
};
//# sourceMappingURL=scheduler-rbac.js.map