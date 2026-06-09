/**
 * PR-C01: Tauri Command权限模型
 * 方案C Tauri桌面集成核心安全组件
 *
 * 功能：
 * 1. Tauri Command白名单机制：仅允许定义范围内的命令
 * 2. 命令参数校验：类型/范围/格式三重校验
 * 3. 权限控制：禁止任意系统命令执行
 *
 * 高危攻击点C8：Tauri Command权限模型缺失 → P0必须实现
 *
 * 修复记录：
 * - #C01-001: 使用path.resolve()正确解析..路径，防止路径穿越
 * - #C01-002: 使用真正的async_hooks.AsyncLocalStorage，移除错误的fallback
 */
import path from 'path';
/**
 * 上下文存储
 * 使用async_hooks.AsyncLocalStorage在异步调用链中传递上下文
 */
let contextStorage;
try {
    const async_hooks = require('async_hooks');
    contextStorage = new async_hooks.AsyncLocalStorage();
}
catch (e) {
    // 不可用时抛出异常，不静默回退到错误实现
    throw new Error('async_hooks.AsyncLocalStorage is required but not available in this environment');
}
/**
 * 创建执行上下文
 */
export function createContext(userRole, sessionId) {
    return {
        userRole,
        sessionId,
        traceId: `tauri-${Date.now()}-${crypto.randomUUID().split('-')[0]}`,
    };
}
/**
 * 在上下文中执行函数
 */
export function runWithContext(context, fn) {
    return contextStorage.run(context, fn);
}
/**
 * 获取当前上下文
 */
export function getCurrentContext() {
    return contextStorage.getStore();
}
// ============================================================
// 白名单机制
// ============================================================
/**
 * 允许的Tauri命令列表
 * 只有在此白名单中的命令才能被执行
 */
export const ALLOWED_COMMANDS = [
    // 文件操作
    'file:read',
    'file:write',
    'file:select',
    'file:save',
    // 系统信息
    'system:info',
    'system:version',
    // 窗口操作
    'window:minimize',
    'window:maximize',
    'window:close',
    'window:restore',
    // 配置操作
    'config:get',
    'config:set',
    // 业务操作
    'course:list',
    'course:enroll',
    'course:drop',
];
/**
 * Tauri命令注册表
 */
export const COMMAND_REGISTRY = {
    // 文件操作
    'file:read': {
        description: '读取文件内容',
        params: [
            { name: 'path', type: 'string', required: true, maxLength: 512 },
        ],
        requiredPermissions: ['file:read'],
    },
    'file:write': {
        description: '写入文件内容',
        params: [
            { name: 'path', type: 'string', required: true, maxLength: 512 },
            { name: 'content', type: 'string', required: true, maxLength: 10 * 1024 * 1024 },
        ],
        requiredPermissions: ['file:write'],
    },
    'file:select': {
        description: '打开文件选择对话框',
        params: [
            { name: 'filters', type: 'array' },
        ],
        requiredPermissions: ['file:select'],
    },
    'file:save': {
        description: '保存文件对话框',
        params: [
            { name: 'defaultName', type: 'string', maxLength: 256 },
        ],
        requiredPermissions: ['file:save'],
    },
    // 系统信息
    'system:info': {
        description: '获取系统信息',
        params: [],
        requiredPermissions: ['system:read'],
    },
    'system:version': {
        description: '获取应用版本',
        params: [],
        requiredPermissions: ['system:read'],
    },
    // 窗口操作
    'window:minimize': {
        description: '最小化窗口',
        params: [],
        requiredPermissions: ['window:manage'],
    },
    'window:maximize': {
        description: '最大化窗口',
        params: [],
        requiredPermissions: ['window:manage'],
    },
    'window:close': {
        description: '关闭窗口',
        params: [],
        requiredPermissions: ['window:manage'],
    },
    'window:restore': {
        description: '恢复窗口',
        params: [],
        requiredPermissions: ['window:manage'],
    },
    // 配置操作
    'config:get': {
        description: '获取配置项',
        params: [
            { name: 'key', type: 'string', required: true, maxLength: 128 },
        ],
        requiredPermissions: ['config:read'],
    },
    'config:set': {
        description: '设置配置项',
        params: [
            { name: 'key', type: 'string', required: true, maxLength: 128 },
            { name: 'value', type: 'string', required: true },
        ],
        requiredPermissions: ['config:write'],
    },
    // 业务操作
    'course:list': {
        description: '获取课程列表',
        params: [
            { name: 'page', type: 'number', min: 1 },
            { name: 'pageSize', type: 'number', min: 1, max: 100 },
        ],
        requiredPermissions: ['course:read'],
    },
    'course:enroll': {
        description: '选修课程',
        params: [
            { name: 'courseId', type: 'string', required: true, maxLength: 64 },
        ],
        requiredPermissions: ['course:write'],
    },
    'course:drop': {
        description: '退选课程',
        params: [
            { name: 'courseId', type: 'string', required: true, maxLength: 64 },
        ],
        requiredPermissions: ['course:write'],
    },
};
/**
 * 权限到角色的映射
 */
const ROLE_PERMISSIONS = {
    admin: new Set([
        'file:read', 'file:write', 'file:select', 'file:save',
        'system:read', 'window:manage',
        'config:read', 'config:write',
        'course:read', 'course:write',
    ]),
    teacher: new Set([
        'file:read', 'file:select',
        'system:read', 'window:manage',
        'config:read', 'course:read', 'course:write',
    ]),
    student: new Set([
        'file:read', 'file:select',
        'system:read', 'window:manage',
        'config:read', 'course:read', 'course:write',
    ]),
    guest: new Set([
        'system:read', 'window:manage',
    ]),
};
/**
 * 检查用户是否有指定权限（基于上下文）
 */
export function hasPermission(permission) {
    const ctx = getCurrentContext();
    if (!ctx) {
        return false; // 无上下文则拒绝
    }
    const rolePermissions = ROLE_PERMISSIONS[ctx.userRole];
    return rolePermissions.has(permission);
}
/**
 * 检查命令是否有指定权限（基于上下文）
 */
export function commandHasPermission(command) {
    const registry = COMMAND_REGISTRY[command];
    if (!registry || !registry.requiredPermissions) {
        return false;
    }
    for (const perm of registry.requiredPermissions) {
        if (!hasPermission(perm)) {
            return false;
        }
    }
    return true;
}
// ============================================================
// 路径安全（防路径穿越）
// ============================================================
/**
 * 允许的根目录
 * 配置为应用数据目录，禁止访问系统关键路径
 * #C01-004修复：确保默认值，避免环境变量未定义时白名单为空
 */
const ALLOWED_ROOT_DIRS = [
    process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Public', 'AppData', 'Roaming'),
    process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Public', 'AppData', 'Local'),
    process.env.USERPROFILE || process.env.HOME || '',
    process.env.HOME || '',
    '/tmp',
    '/var/tmp',
].filter(Boolean);
/**
 * 系统关键路径黑名单（大小写不敏感）
 */
const BLOCKED_PATH_PREFIXES = [
    '/etc/',
    '/root/',
    '/boot/',
    '/sys/',
    '/proc/',
    '/dev/',
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
];
/**
 * 检查路径是否在黑名单中（大小写不敏感）
 */
function isBlockedPath(normalizedPath) {
    const lower = normalizedPath.toLowerCase();
    return BLOCKED_PATH_PREFIXES.some(prefix => lower.startsWith(prefix.toLowerCase()));
}
/**
 * 验证路径是否在允许的根目录下
 * 防止路径穿越攻击（如 ../../../etc/passwd）
 *
 * #C01-001修复：使用path.resolve()正确解析..路径
 */
export function isPathSafe(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
        return false;
    }
    // 使用path.normalize解析..和.，然后转绝对路径
    const normalized = path.normalize(inputPath).replace(/\\/g, '/');
    const resolved = path.resolve(normalized);
    const resolvedLower = resolved.toLowerCase();
    // 黑名单检查
    if (isBlockedPath(resolvedLower)) {
        return false;
    }
    // 检查是否在允许的根目录下
    for (const rootDir of ALLOWED_ROOT_DIRS) {
        if (rootDir) {
            const normalizedRoot = path.normalize(rootDir).replace(/\\/g, '/');
            const resolvedRoot = path.resolve(normalizedRoot);
            if (resolvedLower.startsWith(resolvedRoot.toLowerCase())) {
                return true;
            }
        }
    }
    // 允许临时目录
    const tmpLower = resolvedLower;
    if (tmpLower.startsWith('/tmp/') || tmpLower.startsWith('/var/tmp/')) {
        return true;
    }
    return false;
}
/**
 * 校验文件路径参数
 */
export function validateFilePath(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') {
        return false;
    }
    // 使用path.normalize解析掉..
    const normalized = path.normalize(inputPath);
    // 检查..解析后是否仍在允许范围内
    return isPathSafe(normalized);
}
/**
 * 校验参数类型
 */
function validateParamType(value, expectedType) {
    switch (expectedType) {
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && !isNaN(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'array':
            return Array.isArray(value);
        case 'object':
            return typeof value === 'object' && value !== null && !Array.isArray(value);
        default:
            return false;
    }
}
/**
 * 校验单个参数
 */
export function validateParam(paramName, value, schema) {
    const errors = [];
    // 必填检查
    if (schema.required && (value === undefined || value === null || value === '')) {
        errors.push(`Parameter '${paramName}' is required`);
        return errors;
    }
    // 可选参数为空时不校验
    if (value === undefined || value === null || value === '') {
        return errors;
    }
    // 类型校验
    if (!validateParamType(value, schema.type)) {
        errors.push(`Parameter '${paramName}' must be of type '${schema.type}'`);
        return errors;
    }
    const strValue = String(value);
    // 字符串长度校验
    if (schema.type === 'string') {
        if (schema.minLength && strValue.length < schema.minLength) {
            errors.push(`Parameter '${paramName}' must be at least ${schema.minLength} characters`);
        }
        if (schema.maxLength && strValue.length > schema.maxLength) {
            errors.push(`Parameter '${paramName}' must be at most ${schema.maxLength} characters`);
        }
    }
    // 数字范围校验
    if (schema.type === 'number' && typeof value === 'number') {
        if (schema.min !== undefined && value < schema.min) {
            errors.push(`Parameter '${paramName}' must be at least ${schema.min}`);
        }
        if (schema.max !== undefined && value > schema.max) {
            errors.push(`Parameter '${paramName}' must be at most ${schema.max}`);
        }
    }
    // 正则校验
    if (schema.pattern && schema.type === 'string') {
        if (!schema.pattern.test(strValue)) {
            errors.push(`Parameter '${paramName}' format is invalid`);
        }
    }
    // 枚举值校验
    if (schema.allowedValues && !schema.allowedValues.includes(value)) {
        errors.push(`Parameter '${paramName}' must be one of: ${schema.allowedValues.join(', ')}`);
    }
    return errors;
}
/**
 * 校验命令所有参数
 */
export function validateCommandParams(command, params = {}) {
    const registry = COMMAND_REGISTRY[command];
    if (!registry) {
        return {
            valid: false,
            errors: [`Command '${command}' is not registered`],
        };
    }
    if (!registry.params || registry.params.length === 0) {
        return { valid: true, errors: [] };
    }
    const errors = [];
    for (const schema of registry.params) {
        const paramErrors = validateParam(schema.name, params[schema.name], schema);
        errors.push(...paramErrors);
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}
/**
 * 生成TraceID
 * 铁律：TraceID贯穿全链路，任何服务禁止清空
 */
function generateTraceId() {
    return `tauri-${Date.now()}-${crypto.randomUUID().split('-')[0]}`;
}
/**
 * Tauri Command执行器
 *
 * @param command 命令名称
 * @param params 命令参数
 * @param executor 实际命令执行函数
 */
export async function executeTauriCommand(command, params, executor) {
    const traceId = generateTraceId();
    // 0. 上下文检查
    const ctx = getCurrentContext();
    if (!ctx) {
        return {
            success: false,
            errorCode: 'NO_CONTEXT',
            errorMessage: 'Execution context is required',
            traceId,
        };
    }
    // 1. 白名单校验
    if (!ALLOWED_COMMANDS.includes(command)) {
        return {
            success: false,
            errorCode: 'COMMAND_NOT_ALLOWED',
            errorMessage: `Command '${command}' is not in the whitelist`,
            traceId,
        };
    }
    // 2. 权限校验（基于上下文）
    if (!commandHasPermission(command)) {
        return {
            success: false,
            errorCode: 'PERMISSION_DENIED',
            errorMessage: `User role '${ctx.userRole}' does not have permission to execute '${command}'`,
            traceId,
        };
    }
    // 3. 文件路径安全校验（针对文件操作命令）
    if (command.startsWith('file:') && params.path) {
        if (!validateFilePath(params.path)) {
            return {
                success: false,
                errorCode: 'PATH_NOT_ALLOWED',
                errorMessage: `Path is outside allowed directory`,
                traceId,
            };
        }
    }
    // 4. 参数校验
    const paramValidation = validateCommandParams(command, params);
    if (!paramValidation.valid) {
        return {
            success: false,
            errorCode: 'INVALID_PARAMS',
            errorMessage: paramValidation.errors.join('; '),
            traceId,
        };
    }
    // 5. 执行命令
    try {
        const data = await executor(params);
        return {
            success: true,
            traceId,
            data,
        };
    }
    catch (error) {
        return {
            success: false,
            errorCode: 'EXECUTION_ERROR',
            errorMessage: error instanceof Error ? error.message : 'Unknown execution error',
            traceId,
        };
    }
}
/**
 * 装饰器：自动包装Tauri Command
 * 用于在Rust层自动应用权限校验
 */
export function tauriCommand(commandName, schema) {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (...args) {
            const params = (args[0] || {});
            const result = await executeTauriCommand(commandName, params, () => originalMethod.apply(this, args));
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
    // Context/DI
    createContext,
    runWithContext,
    getCurrentContext,
    // 白名单
    ALLOWED_COMMANDS,
    COMMAND_REGISTRY,
    // 权限
    hasPermission,
    commandHasPermission,
    // 路径安全
    isPathSafe,
    validateFilePath,
    // 参数校验
    validateCommandParams,
    validateParam,
    // 执行器
    executeTauriCommand,
    tauriCommand,
};
//# sourceMappingURL=tauri-permission.js.map