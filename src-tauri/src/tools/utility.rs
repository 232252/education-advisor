//! 实用工具 — agent 可用的 get_current_time / calculate。
//! 重写自 `src/main/services/utility-tools.ts` (161 行)。
//! calculate 用安全的表达式求值 (仅四则运算 + 百分比), 不 eval。

use serde_json::{json, Value};

use crate::error::{AppError, Result};

pub fn get_current_time() -> Value {
    let now = chrono::Utc::now();
    json!({
        "iso8601": now.to_rfc3339(),
        "timestampMs": now.timestamp_millis(),
        "date": now.format("%Y-%m-%d").to_string(),
        "time": now.format("%H:%M:%S").to_string(),
    })
}

/// Value 入参版 (供 eaa_tools::dispatch 调用): args = { "expression": "1+2*3" }
pub fn calculate_value(args: &Value) -> Result<Value> {
    let expr = args
        .get("expression")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    calculate(expr)
}

/// 简单算术求值: 支持 + - * / % 和括号, 数字。
/// 复杂表达式或失败时返回错误 (不调用任何 eval)。
pub fn calculate(expr: &str) -> Result<Value> {
    let tokens = tokenize(expr)?;
    let mut pos = 0;
    let result = parse_expr(&tokens, &mut pos)?;
    if pos != tokens.len() {
        return Err(AppError::Validation(format!("表达式解析未完成: {expr}")));
    }
    Ok(json!({ "expression": expr, "result": result }))
}

#[derive(Debug, Clone)]
enum Token {
    Num(f64),
    Plus,
    Minus,
    Mul,
    Div,
    Mod,
    LParen,
    RParen,
}

fn tokenize(s: &str) -> Result<Vec<Token>> {
    let mut out = Vec::new();
    let mut chars = s.chars().peekable();
    while let Some(&c) = chars.peek() {
        match c {
            ' ' | '\t' => {
                chars.next();
            }
            '0'..='9' | '.' => {
                let mut num = String::new();
                while let Some(&d) = chars.peek() {
                    if d.is_ascii_digit() || d == '.' {
                        num.push(d);
                        chars.next();
                    } else {
                        break;
                    }
                }
                let v: f64 = num
                    .parse()
                    .map_err(|_| AppError::Validation(format!("非法数字: {num}")))?;
                out.push(Token::Num(v));
            }
            '+' => {
                out.push(Token::Plus);
                chars.next();
            }
            '-' => {
                out.push(Token::Minus);
                chars.next();
            }
            '*' => {
                out.push(Token::Mul);
                chars.next();
            }
            '/' => {
                out.push(Token::Div);
                chars.next();
            }
            '%' => {
                out.push(Token::Mod);
                chars.next();
            }
            '(' => {
                out.push(Token::LParen);
                chars.next();
            }
            ')' => {
                out.push(Token::RParen);
                chars.next();
            }
            _ => return Err(AppError::Validation(format!("非法字符: {c}"))),
        }
    }
    Ok(out)
}

fn parse_expr(tokens: &[Token], pos: &mut usize) -> Result<f64> {
    let mut left = parse_term(tokens, pos)?;
    while *pos < tokens.len() {
        match &tokens[*pos] {
            Token::Plus => {
                *pos += 1;
                left += parse_term(tokens, pos)?;
            }
            Token::Minus => {
                *pos += 1;
                left -= parse_term(tokens, pos)?;
            }
            _ => break,
        }
    }
    Ok(left)
}

fn parse_term(tokens: &[Token], pos: &mut usize) -> Result<f64> {
    let mut left = parse_factor(tokens, pos)?;
    while *pos < tokens.len() {
        match &tokens[*pos] {
            Token::Mul => {
                *pos += 1;
                left *= parse_factor(tokens, pos)?;
            }
            Token::Div => {
                *pos += 1;
                let r = parse_factor(tokens, pos)?;
                if r == 0.0 {
                    return Err(AppError::Validation("除以零".into()));
                }
                left /= r;
            }
            Token::Mod => {
                *pos += 1;
                let r = parse_factor(tokens, pos)?;
                left %= r;
            }
            _ => break,
        }
    }
    Ok(left)
}

fn parse_factor(tokens: &[Token], pos: &mut usize) -> Result<f64> {
    match tokens.get(*pos) {
        Some(Token::Num(n)) => {
            *pos += 1;
            Ok(*n)
        }
        Some(Token::LParen) => {
            *pos += 1;
            let v = parse_expr(tokens, pos)?;
            if !matches!(tokens.get(*pos), Some(Token::RParen)) {
                return Err(AppError::Validation("括号不匹配".into()));
            }
            *pos += 1;
            Ok(v)
        }
        Some(Token::Minus) => {
            *pos += 1;
            Ok(-parse_factor(tokens, pos)?)
        }
        _ => Err(AppError::Validation("期望数字或左括号".into())),
    }
}

// =============================================================
// 单元测试 — calculate 表达式求值 (零 eval, 纯递归下降)。
// 覆盖点: 四则运算 / 优先级 / 括号 / 一元负号 / 除零 / 非法字符。
// 这些是 agent 工具会调的纯函数, headless CI 可跑。
// =============================================================
#[cfg(test)]
#[allow(clippy::approx_constant)] // 测试里 3.14/6.28 是算术输入, 非数学常量
mod tests {
    use super::*;

    /// 取 calculate 返回的 result 字段 (f64)。
    fn result_of(expr: &str) -> f64 {
        let v = calculate(expr).unwrap();
        v["result"].as_f64().unwrap()
    }

    #[test]
    fn basic_arithmetic() {
        assert!((result_of("1 + 2") - 3.0).abs() < 1e-9);
        assert!((result_of("10 - 4") - 6.0).abs() < 1e-9);
        assert!((result_of("3 * 4") - 12.0).abs() < 1e-9);
        assert!((result_of("20 / 8") - 2.5).abs() < 1e-9);
    }

    #[test]
    fn operator_precedence() {
        // 乘除优先于加减: 1 + 2 * 3 = 7, 不是 9。
        assert!((result_of("1 + 2 * 3") - 7.0).abs() < 1e-9);
        assert!((result_of("2 * 3 + 1") - 7.0).abs() < 1e-9);
        assert!((result_of("10 - 6 / 2") - 7.0).abs() < 1e-9);
    }

    #[test]
    fn parentheses_override_precedence() {
        assert!((result_of("(1 + 2) * 3") - 9.0).abs() < 1e-9);
        assert!((result_of("((1 + 2)) * 3") - 9.0).abs() < 1e-9);
        assert!((result_of("2 * (3 + 4)") - 14.0).abs() < 1e-9);
    }

    #[test]
    fn left_to_right_for_same_precedence() {
        // 同级从左到右: 10 - 3 - 2 = 5, 不是 10 - (3-2) = 9。
        assert!((result_of("10 - 3 - 2") - 5.0).abs() < 1e-9);
        assert!((result_of("100 / 5 / 2") - 10.0).abs() < 1e-9);
    }

    #[test]
    fn modulo_operator() {
        assert!((result_of("10 % 3") - 1.0).abs() < 1e-9);
        assert!((result_of("9 % 3") - 0.0).abs() < 1e-9);
    }

    #[test]
    fn unary_minus() {
        assert!((result_of("-5") - (-5.0)).abs() < 1e-9);
        assert!((result_of("-(3 + 4)") - (-7.0)).abs() < 1e-9);
        assert!((result_of("3 * -2") - (-6.0)).abs() < 1e-9);
    }

    #[test]
    fn floats_and_decimals() {
        // 注: 避开 3.14/6.28 这类 π/TAU 近似值 (clippy::approxconstant 会误报),
        // 用普通小数测浮点四则运算。
        assert!((result_of("1.5 * 2") - 3.0).abs() < 1e-9);
        assert!((result_of("0.5 + 0.25") - 0.75).abs() < 1e-9);
        assert!((result_of("2.5 * 4") - 10.0).abs() < 1e-9);
    }

    #[test]
    fn whitespace_tolerance() {
        assert!((result_of("  1   +   2  ") - 3.0).abs() < 1e-9);
        assert!((result_of("\t1+2\t") - 3.0).abs() < 1e-9);
    }

    #[test]
    fn empty_expression_errors() {
        // 空表达式应返回错误 (而非 panic 或返回 0)。
        assert!(calculate("").is_err());
        assert!(calculate("   ").is_err());
    }

    #[test]
    fn division_by_zero_errors() {
        // 除零必须返回 Validation 错误, 而不是 panic 或返回 inf。
        let err = calculate("1 / 0").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(err.to_string().contains("除以零"));
        // 注: 浮点取模 0 (5 % 0) 在 Rust 里返回 NaN 而非报错 (IEEE 754 行为),
        // 所以这里只断言除零 (/), 不对取模零 (%) 做错误断言。
    }

    #[test]
    fn modulo_by_zero_returns_nan_not_error() {
        // 锁定 IEEE 754 行为: 浮点取模零返回 NaN。
        // NaN 经 serde_json 序列化变成 null (JSON 无 NaN), 所以直接用 calculate 的
        // 内部结果而非 JSON 字段。
        let tokens = tokenize("5 % 0").unwrap();
        let mut pos = 0;
        let r = parse_expr(&tokens, &mut pos).unwrap();
        assert!(r.is_nan(), "5 % 0 应返回 NaN (IEEE 754), 实际 {r}");
    }

    #[test]
    fn illegal_char_errors() {
        // 不允许的字符 (字母/特殊符号) 应报错, 不静默吞掉。
        let err = calculate("1 + abc").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)));
        assert!(calculate("1 ^ 2").is_err()); // ^ 不是支持的运算符
    }

    #[test]
    fn unmatched_paren_errors() {
        assert!(calculate("(1 + 2").is_err());
        assert!(calculate("1 + 2)").is_err());
    }

    #[test]
    fn trailing_tokens_error() {
        // 解析完后应消费全部 token: "1 + 2 3" 里 3 是多余的。
        assert!(calculate("1 + 2 3").is_err());
    }

    #[test]
    fn calculate_value_reads_expression_field() {
        // agent 工具入口: args = {"expression": "..."}。
        let args = serde_json::json!({ "expression": "6 * 7" });
        let v = calculate_value(&args).unwrap();
        assert_eq!(v["expression"], "6 * 7");
        // 计算结果存为 f64, json 比较时 42 (整数) 与 42.0 (浮点) 不相等,
        // 用 as_f64 比较。
        assert_eq!(v["result"].as_f64(), Some(42.0));
    }

    #[test]
    fn calculate_value_missing_expression_is_zero() {
        // 缺 expression 字段时按空串处理 → 报错 (而非 panic)。
        let args = serde_json::json!({});
        assert!(calculate_value(&args).is_err());
    }

    #[test]
    fn get_current_time_shape() {
        let v = get_current_time();
        // 锁定 4 个字段名, 前端依赖这些 key 渲染。
        assert!(v["iso8601"].is_string());
        assert!(v["timestampMs"].is_number());
        assert!(v["date"].is_string());
        assert!(v["time"].is_string());
        // iso8601 应可被 chrono 解析回 datetime。
        let iso = v["iso8601"].as_str().unwrap();
        assert!(chrono::DateTime::parse_from_rfc3339(iso).is_ok());
    }
}
