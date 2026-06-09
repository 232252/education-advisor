/**
 * PR-A01: 用户生成内容Sanitize模块
 * 方案A前端架构核心安全组件
 *
 * 功能：
 * 1. XSS过滤（DOMPurify集成）
 * 2. SQL注入防护（输入校验）
 * 3. eaa-cli数据校验集成
 *
 * 铁律：所有数据流入流出必须经过eaa-cli校验
 */
/**
 * 转义HTML特殊字符
 * 用于纯文本场景，不允许任何HTML
 */
export declare function escapeHtml(text: string): string;
/**
 * Sanitize富文本内容
 * 使用DOMPurify进行XSS过滤
 */
export declare function sanitizeRichText(html: string): string;
/**
 * Sanitize纯文本内容
 * 移除所有HTML标签，只保留文本
 */
export declare function sanitizePlainText(text: string): string;
/**
 * 预清理：移除SQL注释字符
 * 防止注释干扰正则检测（例如 SEL 斜杠星 a 星斜杠 CT）
 */
declare function removeSqlComments(input: string): string;
/**
 * 验证输入是否包含SQL注入特征
 * @returns true 表示安全，false 表示检测到可疑特征
 */
export declare function validateSqlInjection(input: string): boolean;
/**
 * 清理输入中的SQL注入特征
 * 将可疑字符进行转义
 */
export declare function cleanSqlInjection(input: string): string;
/**
 * eaa-cli校验结果
 */
export interface EaaValidationResult {
    valid: boolean;
    errorCode?: string;
    errorMessage?: string;
    traceId: string;
}
/**
 * eaa-cli校验配置
 */
interface EaaConfig {
    endpoint: string;
    timeout: number;
}
/**
 * EaaValidator类
 * 封装eaa-cli数据校验调用
 */
export declare class EaaValidator {
    private config;
    constructor(config?: Partial<EaaConfig>);
    /**
     * 生成TraceID
     * 铁律：TraceID贯穿全链路，任何服务禁止清空
     */
    private generateTraceId;
    /**
     * 调用eaa-cli进行数据校验
     * @param data 待校验数据
     * @param context 校验上下文
     */
    validate(data: unknown, context?: Record<string, unknown>): Promise<EaaValidationResult>;
    /**
     * 异步校验（带超时）
     */
    validateWithTimeout(data: unknown, context?: Record<string, unknown>): Promise<EaaValidationResult>;
}
export declare const eaaValidator: EaaValidator;
/**
 * Sanitize配置
 */
export interface SanitizeOptions {
    allowHtml?: boolean;
    maxLength?: number;
    trim?: boolean;
    validateSql?: boolean;
}
/**
 * Sanitize结果
 */
export interface SanitizeResult {
    success: boolean;
    data: string;
    errorCode?: string;
    errorMessage?: string;
    traceId: string;
    sanitized: boolean;
}
/**
 * 用户生成内容Sanitize统一API
 *
 * 铁律：所有数据流入流出必须经过eaa-cli校验
 *
 * @param input 用户输入内容
 * @param options Sanitize配置
 * @returns SanitizeResult
 */
export declare function sanitizeUserContent(input: string, options?: SanitizeOptions): Promise<SanitizeResult>;
declare const _default: {
    escapeHtml: typeof escapeHtml;
    sanitizeRichText: typeof sanitizeRichText;
    sanitizePlainText: typeof sanitizePlainText;
    validateSqlInjection: typeof validateSqlInjection;
    cleanSqlInjection: typeof cleanSqlInjection;
    removeSqlComments: typeof removeSqlComments;
    EaaValidator: typeof EaaValidator;
    eaaValidator: EaaValidator;
    sanitizeUserContent: typeof sanitizeUserContent;
};
export default _default;
//# sourceMappingURL=sanitize.d.ts.map