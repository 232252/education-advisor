// 检查 CDP 端点
const http = require('http')

const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 8000 }, (res) => {
  let d = ''
  res.on('data', (c) => (d += c))
  res.on('end', () => {
    console.log('STATUS:', res.statusCode)
    console.log('LENGTH:', d.length)
    try {
      const arr = JSON.parse(d)
      console.log('PAGES:', arr.length)
      arr.forEach((p, i) => console.log(' #' + i, p.type, p.url?.slice(0, 80), p.webSocketDebuggerUrl?.slice(0, 80)))
    } catch (e) {
      console.log('PARSE_ERR:', e.message)
      console.log('FIRST 400:', d.slice(0, 400))
    }
    process.exit(0)
  })
})
req.on('error', (e) => { console.log('ERR:', e.message); process.exit(1) })
req.on('timeout', () => { console.log('TIMEOUT'); req.destroy(); process.exit(2) })
