// The installer ships the connection-center plugin as two archives so NSIS
// does not write hundreds of source files. pnpm's native executable can only
// link a real directory, so the first time the connection center opens we
// expand the source archive under userData and drop the dependency archive
// beside it. No network.

import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function materializeDshImTree(opts: {
  sourceAsar: string
  depsAsar: string
  dest: string
  extract: (archive: string, dest: string) => void
}): void {
  if (!existsSync(opts.sourceAsar)) return
  const source = statSync(opts.sourceAsar)
  const token = `${source.size}:${Math.trunc(source.mtimeMs)}`
  const stamp = join(opts.dest, '.eaa-source-stamp')
  const fresh =
    existsSync(join(opts.dest, 'package.json')) &&
    existsSync(stamp) &&
    readFileSync(stamp, 'utf8') === token
  if (!fresh) {
    rmSync(opts.dest, { recursive: true, force: true })
    opts.extract(opts.sourceAsar, opts.dest)
    writeFileSync(stamp, token)
  }
  if (existsSync(opts.depsAsar)) {
    const depsDest = join(opts.dest, 'node_modules.asar')
    if (!existsSync(depsDest)) copyFileSync(opts.depsAsar, depsDest)
  }
}
