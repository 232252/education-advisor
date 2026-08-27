# 0003 — 官网(site-build)与桌面应用的分仓决策(记录)

**Status**: 决策已定,执行暂缓(择期迁移)
**Date**: 2026-08-27

## 背景

`site-build/` 是无构建链的纯静态营销站(Cloudflare Pages / wrangler.toml,
域名 eea.qdzwwqd.top),与桌面应用是两个交付物:发布节奏、受众、技术栈
互不引用。同仓收益仅是「一次 clone 全都有」,代价是本轮全部官网事故的
温床:版本手抄漂移(硬编码 v3.2.0 404)、双资源树漂移(js/css/img 与
assets/ 两套)、root 属主目录污染 git status、README 与官网口径矛盾。

## 决策

1. **迁移到独立仓库 `education-advisor-site`**(Cloudflare Pages 绑定即可),
   迁移前先完成: R2-01 下载动态化(已完成)、单资源树(已完成,
   js/css/img 死树已删);
2. 迁移只带走 `assets/` 树 + `index.html/download.html/legal.html` +
   `wrangler.toml` + `docs.html`(若有);
3. 版本展示继续用 GitHub API latest release(R2-01 方案),不在站内维护任何
   手抄版本号;演示视频引用 `releases/latest/download/eea-intro.mp4`
   (release.yml 已随发布上传该固定名资产);
4. 本仓库删除 site-build/ 目录并 git rm 跟踪(执行时机: 迁移仓库切好后,
   可回滚 — git 历史保留全部文件);

## 可选替代(若不想开新仓库)

保持同仓,但在根目录与 site-build 之间用 CONTRIBUTING.md 强约束
「官网任何改动必须以 2 个人审阅走 website/ 子目录」——收益低于独立仓库。

## 执行前置条件

- 拥有 GitHub 组织/账号创建新仓的权限;
- 确认 wrangler 登录态与 Pages 绑定方式。
