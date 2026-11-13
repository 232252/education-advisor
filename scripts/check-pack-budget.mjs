#!/usr/bin/env node
// Fail the pack when the Windows Setup or the dsh runtime zip leaves the
// slim layout. Prints the component inventory either way.
//
//   node scripts/check-pack-budget.mjs --output release-v11 --require-setup
//
// Exit 0 when the tree is inside the budget. Exit 1 when it is not.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateOutput, logInventory, readDirectoriesOutput } from './lib/pack-budget.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function fail(message) {
  console.error(`[pack-budget] FAIL ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
let outputDir = null
let requireSetup = false
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--require-setup') {
    requireSetup = true
    continue
  }
  if (arg === '--output') {
    outputDir = args[++i]
    if (!outputDir) fail('--output needs a directory')
    continue
  }
  fail(`unknown argument ${arg}`)
}

if (!outputDir) {
  const yml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
  const configured = readDirectoriesOutput(yml)
  if (!configured) fail('electron-builder.yml has no directories.output')
  outputDir = configured
}
if (!outputDir.startsWith('/') && !/^[A-Za-z]:/.test(outputDir)) {
  outputDir = join(ROOT, outputDir)
}

const report = evaluateOutput({ outputDir, requireSetup })
logInventory('check', report.rows)
if (!report.ok) {
  for (const failure of report.failures) console.error(`[pack-budget] FAIL ${failure}`)
  process.exit(1)
}
console.log('[pack-budget] ok')
