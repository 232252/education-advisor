# 0002 — Rust eaa-cli 在 monorepo 内(溯源决策记录)

**Status**: Accepted
**Date**: 2026-08-27
**Supersedes**: [0001-keep-rust-and-typescript-in-separate-repos](./0001-keep-rust-and-typescript-in-separate-repos.md)

## Context

0001 决定保持 Rust 与 TS 分仓,但 v0.1.0 起 `core/eaa-cli/` 实际随本仓
(23 个跟踪文件:Cargo.toml/lock + crates/* 源码),并服务于
`scripts/build-eaa.mjs` 的可复现构建(产物打包进 `resources/eaa-binaries/`)。
0001 的「分仓」判断与现状相反,标记 Superseded。

## Decision

- 源码随仓(单一 issue 跟踪、tag 内可完整复现构建);
- 用户安装用预编译二进制(resources/eaa-binaries/,三平台),
  源码构建面向开发者/审阅者(需 cargo ≥ 1.80);
- 跨仓库拆分需求若出现(如 Rust 引擎被其他产品复用时),再议 0003。

## Consequences

- 每次发版由 build-eaa.mjs 产生与源码 tag 对应的二进制;
- vendor 化依赖策略不变(见 scripts/verify-vendor.mjs)。
