// 手动创建 schema/reason_codes.json (与 EAA bridge convertReasonCodes 同样的格式)
const fs = require('fs')
const path = require('path')

const schemaDir = path.join('test-user-data', 'schema')
if (!fs.existsSync(schemaDir)) {
  fs.mkdirSync(schemaDir, { recursive: true })
  console.log('Created:', schemaDir)
}

const src = JSON.parse(fs.readFileSync('config/reason-codes.json', 'utf-8'))
const out = { version: '1.0', codes: {} }
for (const [code, def] of Object.entries(src)) {
  out.codes[code] = {
    label: def.label || code,
    category: def.category || 'deduct',
    score_delta: typeof def.score_delta === 'number' ? def.score_delta : (typeof def.delta === 'number' ? def.delta : 0)
  }
}
const dst = path.join(schemaDir, 'reason_codes.json')
fs.writeFileSync(dst, JSON.stringify(out, null, 2), 'utf-8')
console.log('Wrote:', dst, '(' + Object.keys(out.codes).length + ' codes)')

// 验证
const verify = JSON.parse(fs.readFileSync(dst, 'utf-8'))
console.log('Verified:', verify.version, Object.keys(verify.codes).length + ' codes')
console.log('Sample LATE:', JSON.stringify(verify.codes.LATE))
