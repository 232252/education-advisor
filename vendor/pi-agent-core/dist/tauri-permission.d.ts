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
/**
 * 执行上下文
 * 替代全局状态，避免状态污染
 */
export interface ExecutionContext {
    userRole: UserRole;
    sessionId?: string;
    traceId: string;
}
/**
 * 创建执行上下文
 */
export declare function createContext(userRole: UserRole, sessionId?: string): ExecutionContext;
/**
 * 在上下文中执行函数
 */
export declare function runWithContext<T>(context: ExecutionContext, fn: () => T): T;
/**
 * 获取当前上下文
 */
export declare function getCurrentContext(): ExecutionContext | undefined;
/**
 * 允许的Tauri命令列表
 * 只有在此白名单中的命令才能被执行
 */
export declare const ALLOWED_COMMANDS: readonly ["file:read", "file:write", "file:select", "file:save", "system:info", "system:version", "window:minimize", "window:maximize", "window:close", "window:restore", "config:get", "config:set", "course:list", "course:enroll", "course:drop"];
export type AllowedCommand = typeof ALLOWED_COMMANDS[number];
/**
 * 命令注册表
 * 用于存储命令的元数据和校验规则
 */
interface CommandRegistry {
    [command: string]: {
        description: string;
        params?: ParamSchema[];
        requiredPermissions?: string[];
    };
}
/**
 * 参数模式定义
 */
interface ParamSchema {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    required?: boolean;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: RegExp;
    allowedValues?: unknown[];
}
/**
 * Tauri命令注册表
 */
export declare const COMMAND_REGISTRY: CommandRegistry;
/**
 * 用户权限角色
 */
export type UserRole = 'admin' | 'teacher' | 'student' | 'guest';
/**
 * 检查用户是否有指定权限（基于上下文）
 */
export declare function hasPermission(permission: string): boolean;
/**
 * 检查命令是否有指定权限（基于上下文）
 */
export declare function commandHasPermission(command: string): boolean;
/**
 * 验证路径是否在允许的根目录下
 * 防止路径穿越攻击（如 ../../../etc/passwd）
 *
 * #C01-001修复：使用path.resolve()正确解析..路径
 */
export declare function isPathSafe(inputPath: string): boolean;
/**
 * 校验文件路径参数
 */
export declare function validateFilePath(inputPath: string): boolean;
/**
 * 参数校验结果
 */
export interface ParamValidationResult {
    valid: boolean;
    errors: string[];
}
/**
 * 校验单个参数
 */
export declare function validateParam(paramName: string, value: unknown, schema: ParamSchema): string[];
/**
 * 校验命令所有参数
 */
export declare function validateCommandParams(command: string, params?: Record<string, unknown>): ParamValidationResult;
/**
 * 命令执行结果
 */
export interface CommandExecutionResult {
    success: boolean;
    errorCode?: string;
    errorMessage?: string;
    traceId: string;
    data?: unknown;
}
/**
 * Tauri Command执行器
 *
 * @param command 命令名称
 * @param params 命令参数
 * @param executor 实际命令执行函数
 */
export declare function executeTauriCommand(command: string, params: Record<string, unknown>, executor: (params: Record<string, unknown>) => Promise<unknown>): Promise<CommandExecutionResult>;
/**
 * 装饰器：自动包装Tauri Command
 * 用于在Rust层自动应用权限校验
 */
export declare function tauriCommand(commandName: string, schema?: ParamSchema[]): MethodDecorator;
declare const _default: {
    createContext: typeof createContext;
    runWithContext: typeof runWithContext;
    getCurrentContext: typeof getCurrentContext;
    ALLOWED_COMMANDS: readonly ["file:read", "file:write", "file:select", "file:save", "system:info", "system:version", "window:minimize", "window:maximize", "window:close", "window:restore", "config:get", "config:set", "course:list", "course:enroll", "course:drop"];
    COMMAND_REGISTRY: CommandRegistry;
    hasPermission: typeof hasPermission;
    commandHasPermission: typeof commandHasPermission;
    isPathSafe: typeof isPathSafe;
    validateFilePath: typeof validateFilePath;
    validateCommandParams: typeof validateCommandParams;
    validateParam: typeof validateParam;
    executeTauriCommand: typeof executeTauriCommand;
    tauriCommand: typeof tauriCommand;
};
export default _default;
//# sourceMappingURL=tauri-permission.d.ts.map