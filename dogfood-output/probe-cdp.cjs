// CDP 探测脚本 — 检查 9222 是否可用
const http = require('http')

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path, timeout: 5000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 500) }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

;(async () => {
  try {
    console.log('[probe] checking /json/version ...')
    const v = await get('/json/version')
    console.log('  status:', v.status)
    console.log('  body:', v.body)
    console.log('[probe] checking /json ...')
    const t = await get('/json')
    console.log('  status:', t.status)
    try {
      const arr = JSON.parse(t.body + '..."'.slice(0, 0)) // body truncated above; re-fetch
    } catch (e) {}
    // 重新获取完整列表
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 5000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => {
        try {
          const arr = JSON.parse(d)
          console.log('  targets:', arr.length)
          arr.forEach((t, i) => {
            console.log(`    [${i}] type=${t.type} title=${(t.title || '').slice(0, 50)} url=${(t.url || '').slice(0, 60)}`)
          })
        } catch (e) {
          console.log('  parse err:', e.message)
        }
        process.exit(0)
      })
    })
    req.on('error', (e) => { console.log('  err:', e.message); process.exit(1) })
    req.on('timeout', () => { req.destroy(); console.log('  timeout'); process.exit(1) })
  } catch (e) {
    console.log('[probe] FAILED:', e.message)
    process.exit(1)
  }
})()
