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
// ============================================================
// XSS过滤模块
// ============================================================
/**
 * URL Scheme白名单
 * 仅允许以下协议
 */
const ALLOWED_URL_SCHEMES = ['http', 'https', 'mailto'];
/**
 * URL校验：检查scheme是否在白名单内
 */
function isAllowedUrlScheme(url) {
    try {
        const parsed = new URL(url);
        return ALLOWED_URL_SCHEMES.includes(parsed.protocol.replace(':', ''));
    }
    catch {
        // 不是有效URL，允许通过（会被DOMPurify净化）
        return true;
    }
}
/**
 * 校验URL是否安全（无javascript:伪协议）
 */
function validateUrl(url) {
    const trimmed = url.trim().toLowerCase();
    // 检查是否以javascript:开头
    if (trimmed.startsWith('javascript:')) {
        return false;
    }
    // 检查是否包含协议伪指令
    if (/^[\w\s-]*:/i.test(trimmed) && !isAllowedUrlScheme(trimmed)) {
        return false;
    }
    return true;
}
/**
 * XSS配置
 */
const XSS_CONFIG = {
    ALLOWED_TAGS: ['b', 'i', 'u', 'em', 'strong', 'a', 'p', 'br', 'span', 'div', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: ['href', 'title', 'class'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover', 'onfocus', 'onblur'],
    ALLOW_URL_PROTOCOLS: ALLOWED_URL_SCHEMES,
};
/**
 * 转义HTML特殊字符
 * 用于纯文本场景，不允许任何HTML
 */
export function escapeHtml(text) {
    const escapeMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '`': '&#x60;',
    };
    return text.replace(/[&<>"'`]/g, (char) => escapeMap[char] || char);
}
/**
 * Sanitize富文本内容
 * 使用DOMPurify进行XSS过滤
 */
export function sanitizeRichText(html) {
    if (typeof window === 'undefined' || typeof window.DOMPurify === 'undefined') {
        // SSR环境或DOMPurify不可用，返回转义后的纯文本
        return escapeHtml(html);
    }
    return window.DOMPurify.sanitize(html, XSS_CONFIG);
}
/**
 * Sanitize纯文本内容
 * 移除所有HTML标签，只保留文本
 */
export function sanitizePlainText(text) {
    if (typeof window === 'undefined' || typeof window.DOMPurify === 'undefined') {
        return escapeHtml(text);
    }
    // 净化为纯文本，移除所有HTML
    return window.DOMPurify.sanitize(text, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}
// ============================================================
// SQL注入防护模块
// ============================================================
/**
 * SQL注释正则（用于预清理）
 */
const SQL_COMMENT_PATTERN = /(--|#|\/\*|\*\/)/g;
/**
 * 预清理：移除SQL注释字符
 * 防止注释干扰正则检测（例如 SEL 斜杠星 a 星斜杠 CT）
 */
function removeSqlComments(input) {
    return input.replace(SQL_COMMENT_PATTERN, '');
}
/**
 * SQL注入防护正则
 * 禁止可疑SQL关键字和符号组合
 */
const SQL_INJECTION_PATTERNS = [
    /\b(SELECT|UNION|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|XP_|SP_)\b/i,
    /(;| OR | AND )/i,
    /('|"|\\|\$\{|`)/,
    /\bINTO\s+OUTFILE\b/i,
    /\bLOAD_FILE\b/i,
];
/**
 * 验证输入是否包含SQL注入特征
 * @returns true 表示安全，false 表示检测到可疑特征
 */
export function validateSqlInjection(input) {
    if (!input || typeof input !== 'string') {
        return true;
    }
    // 预清理：移除注释字符后再检测
    const cleaned = removeSqlComments(input);
    for (const pattern of SQL_INJECTION_PATTERNS) {
        if (pattern.test(cleaned)) {
            return false;
        }
    }
    return true;
}
/**
 * 清理输入中的SQL注入特征
 * 将可疑字符进行转义
 */
export function cleanSqlInjection(input) {
    if (!input || typeof input !== 'string') {
        return '';
    }
    return input
        .replace(/'/g, "''")
        .replace(/\\/g, '\\\\')
        .replace(/\$/g, '\\$');
}
/**
 * 默认eaa-cli配置
 * 铁律：所有数据流入流出必须经过eaa-cli校验
 */
const DEFAULT_EAA_CONFIG = {
    endpoint: '/api/v1/eaa/validate',
    timeout: 100,
};
/**
 * EaaValidator类
 * 封装eaa-cli数据校验调用
 */
export class EaaValidator {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_EAA_CONFIG, ...config };
    }
    /**
     * 生成TraceID
     * 铁律：TraceID贯穿全链路，任何服务禁止清空
     */
    generateTraceId() {
        return `eaa-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    /**
     * 调用eaa-cli进行数据校验
     * @param data 待校验数据
     * @param context 校验上下文
     */
    async validate(data, context) {
        const traceId = this.generateTraceId();
        try {
            const response = await fetch(this.config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Trace-Id': traceId,
                },
                body: JSON.stringify({
                    data,
                    context: context || {},
                    traceId,
                }),
            });
            if (!response.ok) {
                return {
                    valid: false,
                    errorCode: `HTTP_${response.status}`,
                    errorMessage: `Validation service error: ${response.statusText}`,
                    traceId,
                };
            }
            const result = await response.json();
            return {
                valid: result.valid ?? false,
                errorCode: result.errorCode,
                errorMessage: result.errorMessage,
                traceId,
            };
        }
        catch (error) {
            return {
                valid: false,
                errorCode: 'NETWORK_ERROR',
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                traceId,
            };
        }
    }
    /**
     * 异步校验（带超时）
     */
    async validateWithTimeout(data, context) {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Validation timeout')), this.config.timeout);
        });
        return Promise.race([
            this.validate(data, context),
            timeoutPromise,
        ]).catch((error) => ({
            valid: false,
            errorCode: 'TIMEOUT',
            errorMessage: error instanceof Error ? error.message : 'Validation timeout',
            traceId: this.generateTraceId(),
        }));
    }
}
// 默认导出EaaValidator实例
export const eaaValidator = new EaaValidator();
/**
 * 默认Sanitize配置
 */
const DEFAULT_SANITIZE_OPTIONS = {
    allowHtml: false,
    maxLength: 10000,
    trim: true,
    validateSql: true,
    validateEaa: true, // 铁律：强制eaa-cli校验
};
/**
 * 用户生成内容Sanitize统一API
 *
 * 铁律：所有数据流入流出必须经过eaa-cli校验
 *
 * @param input 用户输入内容
 * @param options Sanitize配置
 * @returns SanitizeResult
 */
export async function sanitizeUserContent(input, options = {}) {
    const traceId = `sanitize-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const opts = { ...DEFAULT_SANITIZE_OPTIONS, ...options };
    // 空值处理
    if (!input || typeof input !== 'string') {
        return {
            success: false,
            data: '',
            errorCode: 'INVALID_INPUT',
            errorMessage: 'Input must be a non-empty string',
            traceId,
            sanitized: false,
        };
    }
    let data = input;
    // 1. Trim空白字符
    if (opts.trim) {
        data = data.trim();
    }
    // 2. 长度限制
    if (opts.maxLength && data.length > opts.maxLength) {
        data = data.substring(0, opts.maxLength);
    }
    // 3. SQL注入校验（预清理注释后再检测）
    if (opts.validateSql && !validateSqlInjection(data)) {
        return {
            success: false,
            data: '',
            errorCode: 'SQL_INJECTION_DETECTED',
            errorMessage: 'Potentially malicious SQL pattern detected',
            traceId,
            sanitized: false,
        };
    }
    // 4. XSS过滤
    data = opts.allowHtml ? sanitizeRichText(data) : sanitizePlainText(data);
    // 5. eaa-cli校验（铁律：强制校验）
    const eaaResult = await eaaValidator.validateWithTimeout(data, {
        source: 'sanitizeUserContent',
        allowHtml: opts.allowHtml,
    });
    if (!eaaResult.valid) {
        return {
            success: false,
            data: '',
            errorCode: eaaResult.errorCode || 'EAA_VALIDATION_FAILED',
            errorMessage: eaaResult.errorMessage || 'EAA validation failed',
            traceId: eaaResult.traceId,
            sanitized: true,
        };
    }
    return {
        success: true,
        data,
        traceId,
        sanitized: true,
    };
}
// ============================================================
// 导出所有模块
// ============================================================
export default {
    // XSS模块
    escapeHtml,
    sanitizeRichText,
    sanitizePlainText,
    // SQL注入模块
    validateSqlInjection,
    cleanSqlInjection,
    removeSqlComments,
    // eaa-cli模块
    EaaValidator,
    eaaValidator,
    // 统一API
    sanitizeUserContent,
};
//# sourceMappingURL=sanitize.js.map