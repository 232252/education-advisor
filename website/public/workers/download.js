/**
 * =============================================================
 * Cloudflare Worker — 下载智能分发
 *
 * 功能: /download 或 /download/<platform> 根据请求来源自动 302 跳转到
 *       GitHub Releases 对应平台的安装包。
 *
 * 部署:
 *   1. wrangler deploy workers/download.js --name ea-download
 *   2. 在 Cloudflare Dashboard 绑定路由: eea.qdzwwqd.top/download* → ea-download
 *   3. 或用 Pages Functions: 把此文件放到 website/functions/download/[[path]].js
 *
 * 设计原因:
 *   - 版本号变化时只需改 VERSION 常量, 不用重新构建前端
 *   - 边缘节点 (Cloudflare 300+ 全球 PoP) 做重定向, 延迟 <50ms
 *   - 访问日志可接入 Cloudflare Analytics 做下载量统计
 * =============================================================
 */

// GitHub Release 基础 URL (tag 改了只改这里)
const VERSION = 'v0.1.0'
const RELEASE_BASE = `https://github.com/232252/education-advisor/releases/download/${VERSION}`

// 各平台安装包文件名 (与 release-tauri.yml 的产物名一致)
const ARTIFACTS = {
  linux: ['education-advisor_0.1.0_amd64.deb', 'education-advisor_0.1.0_amd64.AppImage'],
  windows: ['Education-Advisor_0.1.0_x64-setup.exe', 'Education-Advisor_0.1.0_x64_en-US.msi'],
  macos: ['Education-Advisor_0.1.0_universal.dmg'],
}

/**
 * 根据 User-Agent 检测操作系统
 */
function detectOS(userAgent) {
  const ua = userAgent.toLowerCase()
  if (ua.includes('win')) return 'windows'
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  // 移动端不支持 (桌面应用)
  if (ua.includes('android') || ua.includes('iphone') || ua.includes('ipad')) {
    return 'unsupported'
  }
  return 'unknown'
}

/**
 * 主处理函数
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const userAgent = request.headers.get('User-Agent') || ''

    // --- 路由解析 ---
    // /download          → 自动检测 OS
    // /download/linux    → 强制 Linux
    // /download/windows  → 强制 Windows
    // /download/macos    → 强制 macOS
    const pathParts = url.pathname.split('/').filter(Boolean)
    const explicitPlatform = pathParts[1] // download/<platform> 的第二段

    let os
    if (explicitPlatform && ARTIFACTS[explicitPlatform]) {
      os = explicitPlatform
    } else {
      os = detectOS(userAgent)
    }

    // --- 不支持的设备 ---
    if (os === 'unsupported') {
      return new Response(
        `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h1>📱 Education Advisor 是桌面应用</h1>
        <p>请在 Linux / Windows / macOS 上下载。</p>
        <p><a href="https://github.com/232252/education-advisor">查看 GitHub →</a></p>
        </body></html>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      )
    }

    // --- 未知设备: 显示选择页 ---
    if (os === 'unknown') {
      return new Response(
        `<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h1>⬇️ 选择你的操作系统</h1>
        <div style="margin:30px 0">
          <a href="/download/linux" style="margin:0 10px;padding:10px 20px;border:1px solid #ccc;border-radius:8px;text-decoration:none">🐧 Linux</a>
          <a href="/download/windows" style="margin:0 10px;padding:10px 20px;border:1px solid #ccc;border-radius:8px;text-decoration:none">🪟 Windows</a>
          <a href="/download/macos" style="margin:0 10px;padding:10px 20px;border:1px solid #ccc;border-radius:8px;text-decoration:none">🍎 macOS</a>
        </div>
        </body></html>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      )
    }

    // --- 302 重定向到 GitHub Release ---
    const artifacts = ARTIFACTS[os]
    // 多个安装包时, 默认取第一个 (用户可在 Release 页看全部)
    const filename = artifacts[0]
    const downloadUrl = `${RELEASE_BASE}/${filename}`

    // 访问日志 (Cloudflare 控制台 Logs 可查)
    console.log(JSON.stringify({
      event: 'download',
      os,
      explicit: !!explicitPlatform,
      country: request.cf?.country,
      ua: userAgent.substring(0, 100),
      url: downloadUrl,
      ts: new Date().toISOString(),
    }))

    // 302 临时重定向 (版本号变了改 VERSION 即可, 不用 CDN 刷新)
    return Response.redirect(downloadUrl, 302)
  },
}
