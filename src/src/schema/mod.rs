//! JSON Schema 导出——供 AI 平台使用
//!
//! 使用方式：copaw schema > school_event_schema.json
//! 然后喂给 AI 平台的 Structured Outputs / Tool Calling

use super::types::event::SchoolEvent;

/// 生成 SchoolEvent 的 JSON Schema
pub fn generate_schema() -> serde_json::Value {
    // 手动构建 schema（避免引入 schemars 依赖）
    serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "SchoolEvent",
        "description": "学校事件强类型定义",
        "oneOf": [
            {
                "type": "object",
                "title": "DisciplineEvent",
                "properties": {
                    "type": { "const": "Discipline" },
                    "payload": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["category", "score_delta", "location", "severity", "description", "evidence_refs", "operator"],
                        "properties": {
                            "category": {
                                "type": "string",
                                "enum": [
                                    "SPEAK_IN_CLASS", "SLEEP_IN_CLASS", "LATE", "SCHOOL_CAUGHT",
                                    "MAKEUP", "DESK_UNALIGNED", "PHONE_IN_CLASS", "SMOKING",
                                    "DRINKING_DORM", "OTHER_DEDUCT", "APPEARANCE_VIOLATION",
                                    "LAB_EQUIPMENT_DAMAGE", "LAB_SAFETY_VIOLATION",
                                    "LAB_UNSAFE_BEHAVIOR", "LAB_CLEAN_UP"
                                ]
                            },
                            "score_delta": {
                                "type": "number",
                                "exclusiveMinimum": -10,
                                "exclusiveMaximum": 10,
                                "not": { "const": 0 },
                                "description": "分值变化，范围 (-10, 10) 不含0"
                            },
                            "location": {
                                "type": "string",
                                "enum": ["classroom", "playground", "dormitory", "lab", "online", "other"]
                            },
                            "severity": {
                                "type": "string",
                                "enum": ["minor", "major", "critical"]
                            },
                            "description": { "type": "string", "minLength": 1 },
                            "opponent_id": { "type": "string", "description": "对方学生ID（打架/霸凌时必填）" },
                            "evidence_refs": {
                                "type": "array",
                                "items": { "type": "string" },
                                "minItems": 1,
                                "description": "证据引用，至少一个"
                            },
                            "operator": { "type": "string" },
                            "note": { "type": "string", "default": "" }
                        }
                    }
                },
                "required": ["type", "payload"]
            },
            {
                "type": "object",
                "title": "BonusEvent",
                "properties": {
                    "type": { "const": "Bonus" },
                    "payload": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["category", "score_delta", "description", "operator"],
                        "properties": {
                            "category": {
                                "type": "string",
                                "enum": [
                                    "BONUS_VARIABLE", "ACTIVITY_PARTICIPATION", "CLASS_MONITOR",
                                    "CLASS_COMMITTEE", "CIVILIZED_DORM", "MONTHLY_ATTENDANCE"
                                ]
                            },
                            "score_delta": {
                                "type": "number",
                                "minimum": 0.5,
                                "maximum": 10,
                                "description": "加分值，必须为正数"
                            },
                            "description": { "type": "string", "minLength": 1 },
                            "operator": { "type": "string" },
                            "note": { "type": "string", "default": "" }
                        }
                    }
                },
                "required": ["type", "payload"]
            },
            {
                "type": "object",
                "title": "AttendanceEvent",
                "properties": {
                    "type": { "const": "Attendance" },
                    "payload": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["status", "period", "description", "operator"],
                        "properties": {
                            "status": {
                                "type": "string",
                                "enum": ["late", "early_leave", "absent", "excused"]
                            },
                            "period": { "type": "string", "minLength": 1, "description": "时段：第一节/第二节/晚自习等" },
                            "description": { "type": "string", "minLength": 1 },
                            "reason": { "type": "string" },
                            "operator": { "type": "string" }
                        }
                    }
                },
                "required": ["type", "payload"]
            },
            {
                "type": "object",
                "title": "SystemEvent",
                "properties": {
                    "type": { "const": "System" },
                    "payload": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["action", "description", "operator"],
                        "properties": {
                            "action": { "type": "string" },
                            "description": { "type": "string" },
                            "operator": { "type": "string" }
                        }
                    }
                },
                "required": ["type", "payload"]
            }
        ]
    })
}

/// 生成并打印 schema
pub fn print_schema() {
    let schema = generate_schema();
    println!("{}", serde_json::to_string_pretty(&schema).unwrap());
}
