#!/usr/bin/env node
/**
 * gen-signer.mjs — 生成 Tauri updater ed25519 密钥对。
 *
 * 用法:
 *   npm run signer:gen
 *
 * 行为:
 *   1. 调 `@tauri-apps/cli signer generate` 生成密钥对
 *   2. 私钥保存到 ~/.tauri/ea.key (含密码, 用 chmod 600 保护)
 *   3. 公钥 (base64 字符串) 打印到 stdout, 用户需手动替换到:
 *        src-tauri/tauri.conf.json → plugins.updater.pubkey
 *   4. 提示用户把私钥内容 (含 -----BEGIN/END PRIVATE KEY-----) 配到:
 *        GitHub Settings → Secrets → TAURI_SIGNING_PRIVATE_KEY
 *      和密码配到 TAURI_SIGNING_PRIVATE_KEY_PASSWORD
 *
 * 注意:
 *   - 私钥一旦丢失, 旧版本用户无法再收到自动更新 (需重新发布 + 新 pubkey)
 *   - 切勿把私钥提交到 git 或贴到 Issue
 *   - tauri-action 自动读 env 签名, 无需手动调 tauri signer sign
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const KEY_DIR = join(homedir(), '.tauri');
const KEY_PATH = join(KEY_DIR, 'ea.key');
const KEY_PASSWORD_PATH = join(KEY_DIR, 'ea.key.password');

async function main() {
  console.log('🔐 Tauri updater 密钥对生成');
  console.log('━'.repeat(60));

  // 检查 npx tauri 是否可用
  try {
    const probe = spawnSync('npx', ['--no-install', '@tauri-apps/cli', '--version'], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    if (probe.status !== 0) throw new Error('not installed');
  } catch {
    console.error('❌ 未找到 @tauri-apps/cli, 请先运行 npm install');
    process.exit(1);
  }

  // 检查现有密钥
  if (existsSync(KEY_PATH)) {
    const rl = createInterface({ input, output });
    const ans = await rl.question(
      `⚠️  密钥已存在: ${KEY_PATH}\n   覆盖将导致旧版本用户无法收到自动更新 (新发布的更新用新密钥签名)。\n   确认覆盖? [y/N] `,
    );
    rl.close();
    if (ans.trim().toLowerCase() !== 'y') {
      console.log('已取消');
      return;
    }
  }

  // 输入密码
  const rl = createInterface({ input, output });
  const password = await rl.question('请输入密码 (保护私钥, 留空则无密码): ');
  rl.close();

  console.log('\n⏳ 正在生成 ed25519 密钥对...');

  // 调用 tauri signer generate
  const args = ['@tauri-apps/cli', 'signer', 'generate', '-w', KEY_PATH];
  if (password.trim()) args.push('--password', password.trim());

  const result = spawnSync('npx', args, {
    stdio: 'inherit',
    env: { ...process.env, TAURI_SIGNING_TOOL_DEFAULT_PASSWORD: password.trim() || '' },
  });

  if (result.status !== 0) {
    console.error('❌ 生成失败');
    process.exit(result.status || 1);
  }

  // 加固私钥权限 (chmod 600)
  try {
    chmodSync(KEY_PATH, 0o600);
  } catch (e) {
    console.warn(`⚠️  无法设置文件权限: ${e.message}`);
  }

  // 提示提取公钥
  console.log('\n✅ 生成成功!');
  console.log('━'.repeat(60));
  console.log(`私钥: ${KEY_PATH} (chmod 600)`);
  if (password.trim()) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(KEY_PASSWORD_PATH, password.trim(), { mode: 0o600 });
    console.log(`密码: ${KEY_PASSWORD_PATH} (chmod 600, 仅本机备份)`);
  }
  console.log('\n📋 接下来 3 步:\n');
  console.log('1) 提取公钥 (下面命令会打印一行 base64)');
  console.log(`   node -e "console.log(require('fs').readFileSync('${KEY_PATH}.pub','utf-8').trim())"`);
  console.log('   或直接读私钥末尾的 "Public Key:" 行');
  console.log('\n2) 替换 tauri.conf.json 的 pubkey:');
  console.log('   编辑 src-tauri/tauri.conf.json → plugins.updater.pubkey');
  console.log('\n3) 配 GitHub Secrets (仓库 Settings → Secrets → Actions):');
  console.log('   TAURI_SIGNING_PRIVATE_KEY         ← 整个私钥文件内容 (含 BEGIN/END)');
  console.log('   TAURI_SIGNING_PRIVATE_KEY_PASSWORD ← 第 1 步输入的密码');
  console.log('\n   ⚠️  私钥丢失 = 旧版本用户无法升级, 请妥善备份!\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});