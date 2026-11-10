// Native files the OS loader has to map from a real path. Everything else in
// node_modules stays inside app.asar. Stock node reads that archive through
// scripts/asar-preload (asar-node + an ESM loader). NSIS then writes one
// archive instead of one file per module.

export const NATIVE_GLOBS = ['**/*.node', '**/*.dll', '**/*.exe', '**/*.dylib', '**/*.so']

export function asarUnpackPatterns() {
  return [...NATIVE_GLOBS]
}

export function patternCoversPackage(patterns, name) {
  const file = `node_modules/${name}/package.json`
  return patterns.some((pattern) => matchGlob(pattern, file))
}

function matchGlob(pattern, file) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE::/g, '.*')
  return new RegExp(`^${escaped}$`).test(file)
}

export function assertUnpackContract(patterns = asarUnpackPatterns()) {
  const problems = []
  if (patterns.includes('**/node_modules/**') || patterns.some((pattern) => pattern.startsWith('node_modules/'))) {
    problems.push('package trees are unpacked as loose files again')
  }
  for (const glob of NATIVE_GLOBS) {
    if (!patterns.includes(glob)) problems.push(`missing native glob ${glob}`)
  }
  for (const name of ['@deepseek-ai/dsh', 'pnpm', 'openai', 'pdfjs-dist', 'lxgw-wenkai-webfont']) {
    if (patternCoversPackage(patterns, name)) problems.push(`${name} would be written as loose files`)
  }
  return problems
}
