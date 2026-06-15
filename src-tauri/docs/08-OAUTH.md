# 08 — OAuth (Notion + Discord) 接入指南

> 本文档记录 Tauri 桌面端 OAuth 接入的完整流程、provider 注册步骤与 troubleshooting。
>
> **范围**: 仅 Notion + Discord。其他 provider 用 API Key 方式 (不走 OAuth)。

---

## 1. 流程总览

```
用户点 "用 Notion 登录"
   │
   ▼ invoke('ai_oauth_login', { providerId: 'notion' })
[后端 OAuthFlow::start_flow]
   - 生成 state (32B) + PKCE code_verifier (64B)
   - 计算 code_challenge = base64url(sha256(code_verifier))
   - 存进 state → (provider, verifier, client_id, created_at) Map
   - 构造 authorize URL (含 code_challenge, state)
   ▼
[tauri-plugin-opener] 打开系统浏览器
   │
   ▼ 用户在 Notion 完成授权
[Notion 重定向] educationadvisor://oauth/callback?code=xxx&state=yyy
   │
   ▼ [tauri-plugin-deep-link] 捕获
[main.rs::handle_oauth_callback]
   - 校验 scheme/host, 解析 code + state
   - emit('oauth-callback', {code, state})
   ▼
[前端 authStore] listen('oauth-callback')
   - 调 invoke('ai_oauth_exchange', {code, state, providerId})
   ▼
[后端 OAuthFlow::exchange]
   - 校验 state 在 Map 中且 <5min
   - POST Notion/Discord token endpoint (含 code_verifier)
   - 拿 access_token → keystore.set('notion', token)
   ▼
[前端] toast 提示登录成功, 后续 ai_chat 自动用此 token
```

---

## 2. 配置 client_id

OAuth 需要 provider 给的 `client_id` (Notion 还需 client_secret, 但 Notion 是公开 client 不需要)。

### Notion (推荐先试)

1. 访问 <https://www.notion.so/my-integrations>
2. 「New integration」 → Type: **Public** → Capabilities: 勾选所需
3. **Redirect URIs** 添加: `educationadvisor://oauth/callback`
4. 复制 "OAuth client ID" (格式: `xxxx-yyyy`)
5. 填到: `settings.models.oauth.notion.clientId` (在 Settings → 模型 → 高级配置, 或 settings.json)

### Discord

1. 访问 <https://discord.com/developers/applications>
2. 「New Application」 → 左侧 OAuth2 → Redirects 添加 `educationadvisor://oauth/callback`
3. 复制 Client ID 和 Client Secret
4. 填到: `settings.models.oauth.discord.clientId`
5. Client Secret 存到 keystore (key: `discord_client_secret`):

```bash
# 启动一次 app → Settings → Providers → Discord → 输入 secret → 保存
# 或直接调 (dev 用):
invoke('ai_set_api_key', { providerId: 'discord_client_secret', apiKey: '...' })
```

### settings.json 示例

```json
{
  "models": {
    "oauth": {
      "notion": { "clientId": "xxxx-yyyy" },
      "discord": { "clientId": "1234567890" }
    }
  }
}
```

---

## 3. 状态机 / CSRF 防护

| 风险 | 防御 |
|------|------|
| CSRF | state 参数 (32B 随机), 仅 5min TTL, exchange 时严格匹配 |
| 重放 | state 一次性消费 (`Map::remove`), 5min 后 cleanup_stale |
| 中间人 | PKCE S256 (code_verifier 不离开设备, 只发 challenge) |
| secret 泄漏 | client_secret (Discord) 仅存 keystore, 不进 settings.json |

---

## 4. 故障排查

### 4.1 deep-link 不触发

- macOS: 检查 `tauri.conf.json` 的 `plugins.deep-link.desktop.schemes` 包含 `["educationadvisor"]`
- Windows: NSIS 安装时自动注册 scheme; dev 模式需手动注册
- Linux: 需 `tauri-plugin-deep-link` 在 setup 里调 `register_all()` (已加, 见 main.rs:82-86)

### 4.2 token 换失败

查看后端日志:
```
WARN oauth Notion token 交换失败 (400): {"error":"invalid_grant","error_description":"Code not found"}
```

常见:
- `code` 已用过 (Notion code 一次性, 重试需重新走 login)
- `redirect_uri` 与 Notion 后台注册不一致 (检查 `educationadvisor://oauth/callback` 精确匹配)
- `client_id` 填错

### 4.3 前端收不到回调

打开 DevTools console, 应有:
```
[authStore] 监听 oauth-callback 失败: ...     ← listen 调用本身报错
或:
[authStore] OAuth 回调: { code: ..., state: ... }  ← 收到
```

如果 console 无日志 → `authStore` 未在 bundle (检查 vite chunk)。

### 4.4 Notion workspace 限制

Notion 公开 integration 必须**手动 share** 到具体 page/database, 否则 API 调用 404。
OAuth 登录后, 在 Notion 桌面端把目标 page → "..." → "Connections" → 添加此 integration。

---

## 5. 不在范围

- Google/GitHub OAuth: 不支持自定义 scheme (需 loopback HTTP server), 走 API Key
- Refresh token 自动刷新: 当前实现 refresh_token 拿到后**不主动用**, 过期需重新登录
- Bot 权限范围动态调整: 当前固定 scope (Notion=默认, Discord=identify+email)

---

## 6. 相关源码

- `src-tauri/src/services/oauth.rs` — OAuthFlow 状态机
- `src-tauri/src/commands/ai.rs::ai_oauth_*` — 3 个 IPC command
- `src-tauri/src/main.rs::handle_oauth_callback` — deep-link 解析
- `src/renderer/stores/authStore.ts` — 前端 listen + exchange
- `src/renderer/lib/ipc-client.tauri.ts` — invoke 封装