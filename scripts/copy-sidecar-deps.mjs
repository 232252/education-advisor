// scripts/copy-sidecar-deps.mjs
// 把 sidecar 运行时需要的 node_modules 依赖（含传递依赖）复制到 dist/node_modules/
// 这样 Tauri 打包时只需包含 ../dist/node_modules，sidecar 的 ESM import 就能解析到。
//
// 运行时机: build:tauri 之前 (npm run build:sidecar 之后)
import { cpSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const srcModules = join(root, 'node_modules');
const dstModules = join(root, 'dist', 'node_modules');

// 1. 读取 package.json 的生产依赖
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const prodDeps = Object.keys(pkg.dependencies || {});

console.log(`[copy-sidecar-deps] Production deps: ${prodDeps.length}`);

// 2. 递归收集所有需要的包（含传递依赖）
const needed = new Set();

function collectDeps(name) {
    if (needed.has(name)) return;
    // 跳过 Node 内置模块和特殊引用
    if (name.startsWith('node:')) return;

    const pkgPath = join(srcModules, name, 'package.json');
    if (!existsSync(pkgPath)) {
        console.warn(`  [WARN] package.json not found for: ${name}`);
        return;
    }

    needed.add(name);

    let depPkg;
    try {
        depPkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
        console.warn(`  [WARN] could not parse package.json for: ${name}`);
        return;
    }

    const transitive = {
        ...(depPkg.dependencies || {}),
        ...(depPkg.peerDependencies || {}),
    };

    for (const dep of Object.keys(transitive)) {
        collectDeps(dep);
    }
}

for (const dep of prodDeps) {
    collectDeps(dep);
}

console.log(`[copy-sidecar-deps] Total packages to copy (incl. transitive): ${needed.size}`);

// 3. 清理旧目标目录
if (existsSync(dstModules)) {
    rmSync(dstModules, { recursive: true, force: true });
}
mkdirSync(dstModules, { recursive: true });

// 4. 复制每个包
let copied = 0;
let missing = 0;
for (const name of needed) {
    const src = join(srcModules, name);
    const dst = join(dstModules, name);

    if (existsSync(src)) {
        mkdirSync(dirname(dst), { recursive: true });
        cpSync(src, dst, { recursive: true, dereference: true });
        copied++;
    } else {
        console.warn(`  [MISSING] ${name}`);
        missing++;
    }
}

console.log(`[copy-sidecar-deps] Done: ${copied} copied, ${missing} missing`);

if (missing > 0) {
    console.error('[copy-sidecar-deps] ERROR: some packages are missing!');
    process.exit(1);
}
