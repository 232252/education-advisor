// R30 边界验证 — 确认 IPC handler throw 的边界场景确实被拒
const http = require('http')
const WebSocket = require('ws')

function getWsTarget() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: 9222, path: '/json', timeout: 10000 }, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { const j = JSON.parse(d); const p = j.find((x) => x.type === 'page'); resolve(p.webSocketDebuggerUrl) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
  })
}

class CdpClient {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.on('message', (data) => { try { const m = JSON.parse(data.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } } catch (e) {} }) }
  send(method, params = {}) { return new Promise((r, j) => { const id = ++this.id; this.pending.set(id, { resolve: r, reject: j }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); j(new Error('CDP timeout: ' + method)) } }, 30000) }) }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 25000 }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value }
}

async function main() {
  const ws = new WebSocket(await getWsTarget())
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j) })
  const cdp = new CdpClient(ws)

  let pass = 0, fail = 0
  const check = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? ' — ' + detail : '')) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) } }

  console.log('=== R30 边界验证 (IPC handler throw 场景) ===\n')

  // 先 init/load 确保有密码
  await cdp.eval('(async()=>{ try{ await window.api.privacy.init("R30Verify!2026"); }catch(e){ try{ await window.api.privacy.load("R30Verify!2026"); }catch(e2){} } })()')
  await new Promise((r) => setTimeout(r, 500))

  // 1. 短密码 — validatePassword 会 throw
  let r = await cdp.eval('(async()=>{ try{ await window.api.privacy.init("ab"); return "NOT_REJECTED"; }catch(e){ return "REJECTED:"+String(e.message||e).slice(0,80) } })()')
  check('短密码(<4)被拒', String(r).startsWith('REJECTED'), String(r).slice(0, 60))

  // 2. 超长密码
  const longPwd = 'x'.repeat(129)
  r = await cdp.eval('(async()=>{ try{ await window.api.privacy.init("' + longPwd + '"); return "NOT_REJECTED"; }catch(e){ return "REJECTED:"+String(e.message||e).slice(0,80) } })()')
  check('超长密码(>128)被拒', String(r).startsWith('REJECTED'), String(r).slice(0, 60))

  // 3. 非字符串密码
  r = await cdp.eval('(async()=>{ try{ await window.api.privacy.init(null); return "NOT_REJECTED"; }catch(e){ return "REJECTED:"+String(e.message||e).slice(0,80) } })()')
  check('非字符串密码被拒', String(r).startsWith('REJECTED'), String(r).slice(0, 60))

  // 4. 无效 receiver
  r = await cdp.eval('(async()=>{ try{ await window.api.privacy.filter("invalid", "test"); return "NOT_REJECTED"; }catch(e){ return "REJECTED:"+String(e.message||e).slice(0,80) } })()')
  check('无效 receiver 被拒', String(r).startsWith('REJECTED'), String(r).slice(0, 60))

  // 5. 无效 entityType
  r = await cdp.eval('(async()=>{ try{ await window.api.privacy.add("invalid_type", "test"); return "NOT_REJECTED"; }catch(e){ return "REJECTED:"+String(e.message||e).slice(0,80) } })()')
  check('无效 entityType 被拒', String(r).startsWith('REJECTED'), String(r).slice(0, 60))

  // 6. 空文本
  r = await cdp.eval('(async()=>{ try{ await window.api.privacy.anonymize(""); return "NOT_REJECTED"; }catch(e){ return "REJECTED:"+String(e.message||e).slice(0,80) } })()')
  check('空文本被拒', String(r).startsWith('REJECTED'), String(r).slice(0, 60))

  // 7. null字节
  r = await cdp.eval('(async()=>{ try{ await window.api.privacy.anonymize("test\\x00bad"); return "NOT_REJECTED"; }catch(e){ return "REJECTED:"+String(e.message||e).slice(0,80) } })()')
  check('null字节被拒', String(r).startsWith('REJECTED'), String(r).slice(0, 60))

  // 8. 以 -- 开头的文本 (命令注入防护)
  r = await cdp.eval('(async()=>{ try{ await window.api.privacy.anonymize("--malicious"); return "NOT_REJECTED"; }catch(e){ return "REJECTED:"+String(e.message||e).slice(0,80) } })()')
  check('以--开头文本被拒(命令注入防护)', String(r).startsWith('REJECTED'), String(r).slice(0, 60))

  // 9. 正常文本不应被拒 (对照)
  r = await cdp.eval('(async()=>{ try{ const r=await window.api.privacy.anonymize("正常文本测试"); return "OK:"+String(r.success); }catch(e){ return "REJECTED:"+String(e.message||e).slice(0,80) } })()')
  check('正常文本不被拒(对照)', String(r).startsWith('OK'), String(r).slice(0, 60))

  // 清理
  await cdp.eval('(async()=>{ await window.api.privacy.lock(); return "done"; })()')

  console.log('\n通过: ' + pass + ', 失败: ' + fail)
  ws.close()
  process.exit(fail > 0 ? 1 : 0)
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
