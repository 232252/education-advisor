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
    let expr = args.get("expression").and_then(|v| v.as_str()).unwrap_or("");
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
                let v: f64 = num.parse().map_err(|_| AppError::Validation(format!("非法数字: {num}")))?;
                out.push(Token::Num(v));
            }
            '+' => { out.push(Token::Plus); chars.next(); }
            '-' => { out.push(Token::Minus); chars.next(); }
            '*' => { out.push(Token::Mul); chars.next(); }
            '/' => { out.push(Token::Div); chars.next(); }
            '%' => { out.push(Token::Mod); chars.next(); }
            '(' => { out.push(Token::LParen); chars.next(); }
            ')' => { out.push(Token::RParen); chars.next(); }
            _ => return Err(AppError::Validation(format!("非法字符: {c}"))),
        }
    }
    Ok(out)
}

fn parse_expr(tokens: &[Token], pos: &mut usize) -> Result<f64> {
    let mut left = parse_term(tokens, pos)?;
    while *pos < tokens.len() {
        match &tokens[*pos] {
            Token::Plus => { *pos += 1; left += parse_term(tokens, pos)?; }
            Token::Minus => { *pos += 1; left -= parse_term(tokens, pos)?; }
            _ => break,
        }
    }
    Ok(left)
}

fn parse_term(tokens: &[Token], pos: &mut usize) -> Result<f64> {
    let mut left = parse_factor(tokens, pos)?;
    while *pos < tokens.len() {
        match &tokens[*pos] {
            Token::Mul => { *pos += 1; left *= parse_factor(tokens, pos)?; }
            Token::Div => {
                *pos += 1;
                let r = parse_factor(tokens, pos)?;
                if r == 0.0 { return Err(AppError::Validation("除以零".into())); }
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
        Some(Token::Num(n)) => { *pos += 1; Ok(*n) }
        Some(Token::LParen) => {
            *pos += 1;
            let v = parse_expr(tokens, pos)?;
            if !matches!(tokens.get(*pos), Some(Token::RParen)) {
                return Err(AppError::Validation("括号不匹配".into()));
            }
            *pos += 1;
            Ok(v)
        }
        Some(Token::Minus) => { *pos += 1; Ok(-parse_factor(tokens, pos)?) }
        _ => Err(AppError::Validation("期望数字或左括号".into())),
    }
}
