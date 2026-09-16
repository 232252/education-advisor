// npm postinstall 钩子:把 git hooks 指向仓库内 .githooks/ 目录
// (克隆后执行 npm install 即自动启用隐私门禁等钩子)
import { execSync } from 'node:child_process'

try {
  execSync('git rev-parse --git-dir', { stdio: 'pipe' })
  execSync('git config core.hooksPath .githooks')
  console.log('[setup-hooks] git core.hooksPath -> .githooks (隐私门禁已启用)')
} catch {
  console.log('[setup-hooks] 当前目录不是 git 仓库,跳过钩子安装')
}
