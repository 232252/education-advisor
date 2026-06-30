// Self-check script — validates the open-source preparation
const fs = require('node:fs')
const path = require('node:path')

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ✓ ${name}${detail ? '  — ' + detail : ''}`)
    pass++
  } else {
    console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`)
    fail++
  }
}

console.log('\n=== ROOT-LEVEL OPEN-SOURCE FILES ===')
const rootFiles = [
  ['LICENSE', 'MIT license'],
  ['README.md', '5-minute tour'],
  ['PROJECT_INTRO.md', '1-hour deep-dive'],
  ['CHANGELOG.md', 'version history'],
  ['CONTRIBUTING.md', 'contributor guide'],
  ['SECURITY.md', 'security policy'],
  ['ROADMAP.md', '24-month plan'],
  ['CODE_OF_CONDUCT.md', 'community standards'],
  ['DEPLOY_TO_AI.md', 'AI self-deploy guide'],
  ['BACKLOG.md', 'feature backlog'],
  ['.env.example', 'env template'],
  ['.editorconfig', 'editor config'],
  ['.gitignore', 'git ignore rules'],
]
for (const [f, desc] of rootFiles) {
  const exists = fs.existsSync(f)
  const size = exists ? fs.statSync(f).size : 0
  check(`${f} (${desc})`, exists && size > 200, `${size} bytes`)
}

console.log('\n=== docs/ ===')
const docFiles = [
  'QUICK_START.md', 'ARCHITECTURE.md', 'CONFIGURATION.md', 'EAA_BRIDGE.md',
  'AGENT_AUTHORING.md', 'DESKTOP_BUILD.md', 'DISTRIBUTION.md', 'DEVELOPMENT.md',
  'PRIVACY_ENGINE.md', 'CRON.md', 'FAQ.md', 'TROUBLESHOOTING.md', 'SOP.md',
]
for (const f of docFiles) {
  const p = path.join('docs', f)
  const exists = fs.existsSync(p)
  const size = exists ? fs.statSync(p).size : 0
  check(`${f}`, exists && size > 500, `${size} bytes`)
}

const adrs = fs.readdirSync(path.join('docs', 'decisions')).filter(f => f.endsWith('.md'))
check('7 ADRs in docs/decisions/', adrs.length === 7, `${adrs.length} found`)

console.log('\n=== .github/ ===')
const ghFiles = [
  'CODEOWNERS', 'FUNDING.yml', 'dependabot.yml', 'labeler.yml', 'PULL_REQUEST_TEMPLATE.md',
  'workflows/ci.yml', 'workflows/release.yml', 'workflows/codeql.yml', 'workflows/dependency-review.yml',
  'ISSUE_TEMPLATE/bug_report.yml', 'ISSUE_TEMPLATE/feature_request.yml',
  'ISSUE_TEMPLATE/question.yml', 'ISSUE_TEMPLATE/agent_request.yml', 'ISSUE_TEMPLATE/blank.yml',
]
for (const f of ghFiles) {
  const p = path.join('.github', f)
  const exists = fs.existsSync(p)
  const size = exists ? fs.statSync(p).size : 0
  check(`${f}`, exists && size > 200, `${size} bytes`)
}

console.log('\n=== scripts/ (build tooling) ===')
const scriptFiles = [
  'build-eaa.mjs',
  'generate-update-manifest.mjs',
  'analyze-links.mjs',
]
for (const f of scriptFiles) {
  const p = path.join('scripts', f)
  const exists = fs.existsSync(p)
  const size = exists ? fs.statSync(p).size : 0
  check(`${f}`, exists && size > 1000, `${size} bytes`)
}

console.log('\n=== package.json metadata ===')
const pj = require('../package.json')
check('name = education-advisor', pj.name === 'education-advisor')
check('version present', !!pj.version)
check('license = MIT', pj.license === 'MIT')
check('private = false (publishable)', pj.private === false)
check('author present', !!pj.author)
check('repository present', !!pj.repository)
check('bugs.url present', pj.bugs && !!pj.bugs.url)
check('keywords present', pj.keywords && pj.keywords.length >= 5)
check('engines.node >= 22', pj.engines && pj.engines.node.includes('22'))
check('build:eaa script', pj.scripts['build:eaa'] && !pj.scripts['build:eaa'].includes('TODO'))
check('package script', !!pj.scripts.package)
check('typecheck script', !!pj.scripts.typecheck)
check('test script', !!pj.scripts.test)
check('lint script', !!pj.scripts.lint)

console.log('\n=== IPC channels ===')
const ipcSrc = fs.readFileSync('src/shared/ipc-channels.ts', 'utf8')
const re = /export const (IPC_[A-Z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g
let m
const channels = []
while ((m = re.exec(ipcSrc)) !== null) channels.push(m[2])
check('>= 85 IPC channels defined', channels.length >= 85, `${channels.length} found`)

console.log('\n=== Agents ===')
const agentsDir = path.join('agents')
const agents = fs.readdirSync(agentsDir).filter((d) => fs.statSync(path.join(agentsDir, d)).isDirectory())
let valid = 0
let withSoul = 0
let withRules = 0
for (const a of agents) {
  const soul = path.join(agentsDir, a, 'SOUL.md')
  const rules = path.join(agentsDir, a, 'AGENTS.md')
  if (fs.existsSync(soul) && fs.existsSync(rules)) valid++
  if (fs.existsSync(soul)) withSoul++
  if (fs.existsSync(rules)) withRules++
}
check('18 agent directories', agents.length === 18, `${agents.length} found`)
check('all have SOUL.md', withSoul === agents.length, `${withSoul}/${agents.length}`)
check('all have AGENTS.md', withRules === agents.length, `${withRules}/${agents.length}`)
check('all have both', valid === agents.length, `${valid}/${agents.length}`)

console.log('\n=== Config / Skills ===')
check('config/agents.yaml', fs.existsSync('config/agents.yaml'))
check('config/reason-codes.json', fs.existsSync('config/reason-codes.json'))
check('config/default-settings.json', fs.existsSync('config/default-settings.json'))
check('config/SMALL_MODEL_RULES.md', fs.existsSync('config/SMALL_MODEL_RULES.md'))
check('skills/STUDENT_MANAGEMENT.md', fs.existsSync('skills/STUDENT_MANAGEMENT.md'))

console.log('\n=== Cleanup verification ===')
const verifyFiles = fs.readdirSync('.').filter((f) => /^verify-/i.test(f))
check('No verify-* files at root', verifyFiles.length === 0, `${verifyFiles.length} found`)
const checkFiles = fs.readdirSync('.').filter((f) => /^(check|test-cdp)/i.test(f))
check('No check-* / test-cdp-* files at root', checkFiles.length === 0, `${checkFiles.length} found`)
check('No e2e-test.mjs at root', !fs.existsSync('e2e-test.mjs'))
check('No logs/ directory', !fs.existsSync('logs'))

console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===\n`)
process.exit(fail > 0 ? 1 : 0)
