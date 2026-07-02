// Quick CDP reachability check
const http = require('http')
const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 8000 }, (res) => {
  let d = ''
  res.on('data', (c) => (d += c))
  res.on('end', () => {
    try {
      const j = JSON.parse(d)
      console.log('OK targets:', j.length)
      j.forEach((t) => console.log(' -', t.type, t.url?.slice(0, 80)))
    } catch (e) {
      console.log('PARSE ERR:', e.message)
    }
  })
})
req.on('error', (e) => console.log('ERR:', e.message))
req.on('timeout', () => { req.destroy(); console.log('TIMEOUT') })
