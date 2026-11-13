// electron-builder afterAllArtifactBuild.
// The Setup file exists here. Publishing is a separate step: the pack
// wrapper forces --publish never because uploads are scheduled as each
// artifact is created, which can be before this hook returns.
import { evaluateOutput, logInventory } from './lib/pack-budget.mjs'

export default async function afterAllArtifactBuild(result) {
  const outDir = result?.outDir
  if (!outDir) {
    throw new Error('[pack-budget] FAIL afterAllArtifactBuild did not receive outDir')
  }
  const artifactPaths = result.artifactPaths ?? []
  const requireSetup = artifactPaths.some((artifact) => artifact.toLowerCase().endsWith('.exe'))
  const report = evaluateOutput({ outputDir: outDir, artifactPaths, requireSetup })
  logInventory('afterAllArtifactBuild', report.rows)
  if (!report.ok) {
    for (const failure of report.failures) console.error(`[pack-budget] FAIL ${failure}`)
    throw new Error(`[pack-budget] FAIL ${report.failures.join('; ')}`)
  }
  console.log('[pack-budget] ok')
  return []
}
