// asar-node's fs patch rejects URL objects. Node's ESM loader passes URLs
// into readFileSync, so wrap the patched methods and hand them a path.
const fs = require('node:fs')
const { fileURLToPath } = require('node:url')

if (!fs.readFileSync.__asarUrlFix) {
  const norm = (p) => {
    if (p instanceof URL) return fileURLToPath(p)
    if (typeof p === 'string' && p.startsWith('file:')) {
      try {
        return fileURLToPath(p)
      } catch {
        return p
      }
    }
    return p
  }
  for (const name of [
    'readFileSync',
    'statSync',
    'lstatSync',
    'existsSync',
    'accessSync',
    'realpathSync',
    'readdirSync',
    'openSync',
  ]) {
    const prev = fs[name]
    if (typeof prev !== 'function') continue
    const wrapped = function (p, ...rest) {
      return prev.call(this, norm(p), ...rest)
    }
    wrapped.__asarUrlFix = true
    fs[name] = wrapped
  }
  if (fs.promises) {
    for (const name of ['readFile', 'stat', 'lstat', 'realpath', 'readdir', 'access', 'open']) {
      const prev = fs.promises[name]
      if (typeof prev !== 'function') continue
      fs.promises[name] = function (p, ...rest) {
        return prev.call(this, norm(p), ...rest)
      }
    }
  }
}
