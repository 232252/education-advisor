// 重置 EAA 数据目录 (清理所有累积的测试数据)
// 用户明确要求: "删除以前的测试数据以防混淆,不要用以前的"
const fs = require('fs')
const path = require('path')

const EAA_DATA_DIR = path.join(__dirname, '..', 'test-user-data', 'eaa-data')
const SCHEMA_DIR = path.join(__dirname, '..', 'test-user-data', 'schema')

console.log('=== 重置 EAA 数据目录 ===')
console.log('EAA 数据目录:', EAA_DATA_DIR)
console.log('Schema 目录:', SCHEMA_DIR)
console.log('')

// 1. 备份 schema (reason_codes.json)
const schemaFile = path.join(SCHEMA_DIR, 'reason_codes.json')
let schemaContent = null
if (fs.existsSync(schemaFile)) {
  schemaContent = fs.readFileSync(schemaFile, 'utf-8')
  console.log('1. 备份 schema:', schemaFile, `(${schemaContent.length} 字符)`)
} else {
  console.log('1. schema 不存在,将从 config/reason-codes.json 重建')
}

// 2. 删除 eaa-data 目录
if (fs.existsSync(EAA_DATA_DIR)) {
  console.log('2. 删除 eaa-data 目录...')
  fs.rmSync(EAA_DATA_DIR, { recursive: true, force: true })
  console.log('   已删除')
} else {
  console.log('2. eaa-data 目录不存在')
}

// 3. 重建空结构
console.log('3. 重建空结构...')
fs.mkdirSync(path.join(EAA_DATA_DIR, 'entities'), { recursive: true })
fs.mkdirSync(path.join(EAA_DATA_DIR, 'events'), { recursive: true })
fs.mkdirSync(path.join(EAA_DATA_DIR, 'logs'), { recursive: true })

// entities.json
fs.writeFileSync(
  path.join(EAA_DATA_DIR, 'entities', 'entities.json'),
  JSON.stringify({ version: '1.0', base_score: 100.0, entities: {} }, null, 2),
  'utf-8',
)
console.log('   entities.json 已重建')

// events.json
fs.writeFileSync(path.join(EAA_DATA_DIR, 'events', 'events.json'), '[]', 'utf-8')
console.log('   events.json 已重建 (空数组)')

// name_index.json
fs.writeFileSync(path.join(EAA_DATA_DIR, 'entities', 'name_index.json'), '{}', 'utf-8')
console.log('   name_index.json 已重建')

// 4. 恢复 schema
if (!fs.existsSync(SCHEMA_DIR)) {
  fs.mkdirSync(SCHEMA_DIR, { recursive: true })
}
if (schemaContent) {
  fs.writeFileSync(schemaFile, schemaContent, 'utf-8')
  console.log('4. schema 已恢复')
} else {
  // 从 config/reason-codes.json 重建
  const srcFile = path.join(__dirname, '..', 'config', 'reason-codes.json')
  if (fs.existsSync(srcFile)) {
    const src = JSON.parse(fs.readFileSync(srcFile, 'utf-8'))
    const out = { version: '1.0', codes: {} }
    for (const [code, def] of Object.entries(src)) {
      out.codes[code] = {
        label: def.label || code,
        category: def.category || 'deduct',
        score_delta: typeof def.score_delta === 'number' ? def.score_delta : (typeof def.delta === 'number' ? def.delta : 0),
      }
    }
    fs.writeFileSync(schemaFile, JSON.stringify(out, null, 2), 'utf-8')
    console.log('4. schema 从 config/reason-codes.json 重建')
  }
}

// 5. 验证
console.log('\n=== 验证 ===')
const ents = JSON.parse(fs.readFileSync(path.join(EAA_DATA_DIR, 'entities', 'entities.json'), 'utf-8'))
console.log('entities:', Object.keys(ents.entities).length, '个')
const evts = JSON.parse(fs.readFileSync(path.join(EAA_DATA_DIR, 'events', 'events.json'), 'utf-8'))
console.log('events:', evts.length, '个')
const idx = JSON.parse(fs.readFileSync(path.join(EAA_DATA_DIR, 'entities', 'name_index.json'), 'utf-8'))
console.log('name_index:', Object.keys(idx).length, '个')
console.log('schema exists:', fs.existsSync(schemaFile))
console.log('\n✓ EAA 数据已重置 (需要重启 Electron 生效)')
