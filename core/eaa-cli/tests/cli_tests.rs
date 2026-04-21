use assert_cmd::Command;
use predicates::prelude::*;
use std::fs;

fn setup_test_env() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    fs::create_dir_all(data_dir.join("entities")).unwrap();
    fs::create_dir_all(data_dir.join("events")).unwrap();
    fs::create_dir_all(data_dir.join("logs")).unwrap();

    // Write minimal schema
    let schema_dir = dir.path().join("schema");
    fs::create_dir_all(&schema_dir).unwrap();
    fs::write(schema_dir.join("reason_codes.json"), r#"{"version":"2.0","codes":{"TEST_DEDUCT":{"score_delta":-2.0,"label":"测试扣分","category":"test"},"TEST_BONUS":{"score_delta":2.0,"label":"测试加分","category":"test"}}}"#).unwrap();

    // Write empty entities
    fs::write(data_dir.join("entities/entities.json"), r#"{"entities":{}}"#).unwrap();
    // Write empty name_index
    fs::write(data_dir.join("entities/name_index.json"), "{}").unwrap();
    // Write empty events
    fs::write(data_dir.join("events/events.json"), "[]").unwrap();

    dir
}

#[test]
fn test_info() {
    let dir = setup_test_env();
    let mut cmd = Command::cargo_bin("eaa").unwrap();
    cmd.env("EAA_DATA_DIR", dir.path().join("data"))
        .arg("info")
        .assert()
        .stdout(predicate::str::contains("EAA 事件溯源操行分系统"))
        .stdout(predicate::str::contains("学生总数:    0"));
}

#[test]
fn test_validate_empty() {
    let dir = setup_test_env();
    let mut cmd = Command::cargo_bin("eaa").unwrap();
    cmd.env("EAA_DATA_DIR", dir.path().join("data"))
        .arg("validate")
        .assert()
        .stdout(predicate::str::contains("All 0 events valid"));
}

#[test]
fn test_version() {
    let mut cmd = Command::cargo_bin("eaa").unwrap();
    cmd.arg("--version")
        .assert()
        .stdout(predicate::str::contains("eaa 2.0.0"));
}

#[test]
fn test_add_student() {
    let dir = setup_test_env();
    let data_dir = dir.path().join("data");
    let mut cmd = Command::cargo_bin("eaa").unwrap();
    cmd.env("EAA_DATA_DIR", &data_dir)
        .args(["add-student", "测试学生"])
        .assert()
        .stdout(predicate::str::contains("学生已添加"));

    // Verify student exists
    let entities: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(data_dir.join("entities/entities.json")).unwrap()
    ).unwrap();
    assert!(entities["entities"].as_object().unwrap().len() == 1);
}

#[test]
fn test_add_event_dry_run() {
    let dir = setup_test_env();
    let data_dir = dir.path().join("data");
    // Add student first
    let mut add_stu = Command::cargo_bin("eaa").unwrap();
    add_stu.env("EAA_DATA_DIR", &data_dir)
        .args(["add-student", "张三"])
        .assert().success();

    // Dry-run add event
    let mut cmd = Command::cargo_bin("eaa").unwrap();
    cmd.env("EAA_DATA_DIR", &data_dir)
        .args(["add", "张三", "TEST_DEDUCT", "--delta", "-2", "--note", "test", "--dry-run"])
        .assert()
        .stdout(predicate::str::contains("DRY-RUN"));

    // Events should still be empty (dry-run)
    let events: Vec<serde_json::Value> = serde_json::from_str(
        &fs::read_to_string(data_dir.join("events/events.json")).unwrap()
    ).unwrap();
    assert!(events.is_empty());
}

#[test]
fn test_revert_protection() {
    let dir = setup_test_env();
    let data_dir = dir.path().join("data");

    // Add student
    Command::cargo_bin("eaa").unwrap()
        .env("EAA_DATA_DIR", &data_dir)
        .args(["add-student", "李四"])
        .assert().success();

    // Add event
    Command::cargo_bin("eaa").unwrap()
        .env("EAA_DATA_DIR", &data_dir)
        .args(["add", "李四", "TEST_DEDUCT", "--delta", "-2", "--note", "test"])
        .assert().success();

    // Get event id
    let events: Vec<serde_json::Value> = serde_json::from_str(
        &fs::read_to_string(data_dir.join("events/events.json")).unwrap()
    ).unwrap();
    let original_id = events[0]["event_id"].as_str().unwrap();

    // Revert it
    Command::cargo_bin("eaa").unwrap()
        .env("EAA_DATA_DIR", &data_dir)
        .args(["revert", original_id, "--reason", "test revert"])
        .assert().success();

    // Get revert event id
    let events2: Vec<serde_json::Value> = serde_json::from_str(
        &fs::read_to_string(data_dir.join("events/events.json")).unwrap()
    ).unwrap();
    let revert_id = events2[1]["event_id"].as_str().unwrap();

    // Try to revert the revert - should fail
    Command::cargo_bin("eaa").unwrap()
        .env("EAA_DATA_DIR", &data_dir)
        .args(["revert", revert_id, "--reason", "should fail"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("撤销事件，不可再次撤销"));
}
