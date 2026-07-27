// 全 115 通道测试矩阵 — 每个通道的安全调用参数
// 用于全覆盖功能审计
export const CHANNEL_MATRIX = [
  // ===== AI / LLM (15) =====
  { ch: 'ai:list-providers', args: [], ns: 'ai', desc: '列出全部LLM供应商' },
  { ch: 'ai:list-models', args: ['openai'], ns: 'ai', desc: '列出某供应商模型' },
  { ch: 'ai:test-connection', args: ['openai', 'sk-fake-test-key-not-real'], ns: 'ai', desc: '测试连接(假key应失败)', expectFail: true },
  { ch: 'ai:set-api-key', args: ['openai', 'sk-test-key-placeholder'], ns: 'ai', desc: '设置API Key' },
  { ch: 'ai:delete-api-key', args: ['openai'], ns: 'ai', desc: '删除API Key' },
  { ch: 'ai:chat', args: [{ providerId: 'openai', modelId: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }], ns: 'ai', desc: '发起流式对话', expectFail: true },
  { ch: 'ai:chat-abort', args: [], ns: 'ai', desc: '中断对话' },
  { ch: 'ai:add-custom-model', args: [{ providerId: 'openai', modelId: 'test-custom-1', name: 'Test Model' }], ns: 'ai', desc: '添加自定义模型' },
  { ch: 'ai:del-custom-model', args: ['openai', 'test-custom-1'], ns: 'ai', desc: '删除自定义模型' },
  { ch: 'ai:update-custom-model', args: [{ providerId: 'openai', modelId: 'gpt-4o-mini', name: 'Updated' }], ns: 'ai', desc: '更新自定义模型' },
  { ch: 'ai:oauth-login', args: ['google'], ns: 'ai', desc: 'OAuth登录', expectFail: true },

  // ===== Chat 持久化 (4) =====
  { ch: 'chat:save-message', args: [{ role: 'user', content: 'test message', timestamp: Date.now() }], ns: 'chat', desc: '保存消息' },
  { ch: 'chat:load-messages', args: [], ns: 'chat', desc: '加载消息' },
  { ch: 'chat:delete-session', args: ['nonexistent-session'], ns: 'chat', desc: '删除会话(不存在)' },
  { ch: 'chat:list-sessions', args: [], ns: 'chat', desc: '会话列表' },

  // ===== Agent (12) =====
  { ch: 'agent:list', args: [], ns: 'agent', desc: 'Agent列表' },
  { ch: 'agent:get', args: ['class-monitor'], ns: 'agent', desc: 'Agent详情' },
  { ch: 'agent:toggle', args: ['class-monitor', true], ns: 'agent', desc: '启用Agent' },
  { ch: 'agent:update', args: ['class-monitor', { description: 'test update' }], ns: 'agent', desc: '更新Agent配置' },
  { ch: 'agent:get-soul', args: ['class-monitor'], ns: 'agent', desc: '读取SOUL.md' },
  { ch: 'agent:set-soul', args: ['class-monitor', '# test soul content'], ns: 'agent', desc: '写SOUL.md' },
  { ch: 'agent:get-rules', args: ['class-monitor'], ns: 'agent', desc: '读取规则' },
  { ch: 'agent:set-rules', args: ['class-monitor', '# test rules'], ns: 'agent', desc: '写规则' },
  { ch: 'agent:run-manual', args: ['class-monitor', 'test prompt'], ns: 'agent', desc: '手动运行Agent', expectFail: true },
  { ch: 'agent:abort', args: ['class-monitor'], ns: 'agent', desc: '中断Agent' },
  { ch: 'agent:get-history', args: ['class-monitor'], ns: 'agent', desc: 'Agent历史' },

  // ===== EAA 核心 (23) =====
  { ch: 'eaa:info', args: [], ns: 'eaa', desc: '系统信息' },
  { ch: 'eaa:score', args: ['测试学生'], ns: 'eaa', desc: '学生评分' },
  { ch: 'eaa:ranking', args: [10], ns: 'eaa', desc: '排行榜' },
  { ch: 'eaa:replay', args: [], ns: 'eaa', desc: '回放' },
  { ch: 'eaa:add-event', args: [{ studentName: '测试学生', reasonCode: 'LATE', note: 'test' }], ns: 'eaa', desc: '新增事件' },
  { ch: 'eaa:revert-event', args: ['fake-event-id', 'test revert'], ns: 'eaa', desc: '回滚事件(假id)', expectFail: true },
  { ch: 'eaa:history', args: ['测试学生'], ns: 'eaa', desc: '学生历史' },
  { ch: 'eaa:search', args: ['测试'], ns: 'eaa', desc: '搜索' },
  { ch: 'eaa:range', args: ['2026-01-01', '2026-12-31'], ns: 'eaa', desc: '时间范围' },
  { ch: 'eaa:tag', args: [], ns: 'eaa', desc: '标签列表' },
  { ch: 'eaa:stats', args: [], ns: 'eaa', desc: '统计' },
  { ch: 'eaa:validate', args: [], ns: 'eaa', desc: '校验' },
  { ch: 'eaa:export', args: ['jsonl'], ns: 'eaa', desc: '导出' },
  { ch: 'eaa:list-students', args: [], ns: 'eaa', desc: '学生列表' },
  { ch: 'eaa:add-student', args: [`测试学生_${Date.now()}`], ns: 'eaa', desc: '新增学生' },
  { ch: 'eaa:set-student-meta', args: [{ name: '测试学生', meta: { note: 'test' } }], ns: 'eaa', desc: '设置元数据' },
  { ch: 'eaa:codes', args: [], ns: 'eaa', desc: '原因码' },
  { ch: 'eaa:doctor', args: [], ns: 'eaa', desc: '健康检查' },
  { ch: 'eaa:summary', args: [], ns: 'eaa', desc: '摘要' },
  { ch: 'eaa:dashboard', args: [], ns: 'eaa', desc: '生成dashboard' },
  { ch: 'eaa:export-formats', args: [], ns: 'eaa', desc: '导出格式列表' },

  // ===== 隐私引擎 (13) =====
  { ch: 'privacy:status', args: [], ns: 'privacy', desc: '隐私状态' },
  { ch: 'privacy:init', args: ['test-password-123'], ns: 'privacy', desc: '初始化隐私引擎' },
  { ch: 'privacy:load', args: ['test-password-123'], ns: 'privacy', desc: '载入隐私字典' },
  { ch: 'privacy:enable', args: [], ns: 'privacy', desc: '启用隐私' },
  { ch: 'privacy:add', args: ['person', '张三'], ns: 'privacy', desc: '新增映射' },
  { ch: 'privacy:list', args: [], ns: 'privacy', desc: '映射列表' },
  { ch: 'privacy:anonymize', args: ['张三同学今天迟到了'], ns: 'privacy', desc: '匿名化' },
  { ch: 'privacy:deanonymize', args: ['S_001同学今天迟到了'], ns: 'privacy', desc: '反匿名化' },
  { ch: 'privacy:filter', args: ['parent', '张三的成绩单'], ns: 'privacy', desc: '按接收方过滤' },
  { ch: 'privacy:dryrun', args: ['张三的家长联系电话'], ns: 'privacy', desc: 'dry-run预览' },
  { ch: 'privacy:lock', args: [], ns: 'privacy', desc: '锁定' },
  { ch: 'privacy:disable', args: ['test-password-123'], ns: 'privacy', desc: '停用隐私' },

  // ===== Cron (7) =====
  { ch: 'cron:list', args: [], ns: 'cron', desc: '任务列表' },
  { ch: 'cron:add', args: [{ name: 'test-cron', expression: '0 9 * * *', enabled: false, agentId: 'class-monitor' }], ns: 'cron', desc: '新增任务' },
  { ch: 'cron:update', args: ['test-cron-id', { enabled: false }], ns: 'cron', desc: '更新任务' },
  { ch: 'cron:remove', args: ['nonexistent-id'], ns: 'cron', desc: '删除任务(不存在)' },
  { ch: 'cron:toggle', args: ['nonexistent-id', false], ns: 'cron', desc: '切换任务' },
  { ch: 'cron:run-now', args: ['nonexistent-id'], ns: 'cron', desc: '立即执行' },
  { ch: 'cron:get-logs', args: [], ns: 'cron', desc: '执行日志' },

  // ===== Skill (4) =====
  { ch: 'skill:list', args: [], ns: 'skill', desc: '技能列表' },
  { ch: 'skill:get', args: ['nonexistent-skill'], ns: 'skill', desc: '读取技能(不存在)' },
  { ch: 'skill:save', args: [`test-skill-${Date.now()}`, '# Test Skill\n内容'], ns: 'skill', desc: '保存技能' },
  { ch: 'skill:delete', args: ['nonexistent-skill'], ns: 'skill', desc: '删除技能(不存在)' },

  // ===== Settings (3) =====
  { ch: 'settings:get', args: [], ns: 'settings', desc: '读取设置' },
  { ch: 'settings:set', args: ['general.logLevel', 'info'], ns: 'settings', desc: '更新设置' },
  { ch: 'settings:reset', args: [], ns: 'settings', desc: '恢复默认' },

  // ===== System (8) =====
  { ch: 'sys:get-path', args: ['userData'], ns: 'sys', desc: '获取路径' },
  { ch: 'sys:notification', args: ['测试标题', '测试内容'], ns: 'sys', desc: '系统通知' },
  { ch: 'sys:read-file', args: ['nonexistent.txt'], ns: 'sys', desc: '读文件(不存在)', expectFail: true },
  { ch: 'sys:check-update', args: [], ns: 'sys', desc: '检查更新' },
  { ch: 'sys:open-dialog', args: [{ title: 'test' }], ns: 'sys', desc: '打开对话框' },
  { ch: 'sys:save-dialog', args: [{ title: 'test' }], ns: 'sys', desc: '保存对话框' },
  { ch: 'sys:open-external', args: ['https://example.com'], ns: 'sys', desc: '打开外部链接' },
  { ch: 'sys:show-update-dialog', args: [], ns: 'sys', desc: '更新对话框' },

  // ===== Profile (2) =====
  { ch: 'profile:get', args: ['测试学生'], ns: 'profile', desc: '学生档案' },
  { ch: 'profile:set', args: ['测试学生', { note: 'test profile' }], ns: 'profile', desc: '写学生档案' },

  // ===== Log (7) =====
  { ch: 'log:list', args: [], ns: 'log', desc: '日志列表' },
  { ch: 'log:read', args: ['nonexistent.log', 10], ns: 'log', desc: '读日志(不存在)' },
  { ch: 'log:filter', args: ['nonexistent.log', ['info']], ns: 'log', desc: '过滤日志' },
  { ch: 'log:search', args: ['nonexistent.log', 'test'], ns: 'log', desc: '搜索日志' },
  { ch: 'log:clear', args: [], ns: 'log', desc: '清空日志', skip: true },

  // ===== Feishu (9) =====
  { ch: 'feishu:status', args: [], ns: 'feishu', desc: '飞书状态' },
  { ch: 'feishu:test', args: ['fake-app-id'], ns: 'feishu', desc: '测试飞书连接(假)', expectFail: true },
  { ch: 'feishu:bot:status', args: [], ns: 'feishu', desc: '机器人状态' },
  { ch: 'feishu:bot-start', args: [], ns: 'feishu', desc: '启动机器人', expectFail: true },
  { ch: 'feishu:bot-stop', args: [], ns: 'feishu', desc: '停止机器人' },

  // ===== Ollama (6) =====
  { ch: 'ollama:detect', args: [], ns: 'ollama', desc: '检测Ollama' },
  { ch: 'ollama:list-models', args: [], ns: 'ollama', desc: 'Ollama模型列表' },
  { ch: 'ollama:start-serve', args: [], ns: 'ollama', desc: '启动serve' },
  { ch: 'ollama:stop-serve', args: [], ns: 'ollama', desc: '停止serve' },

  // ===== Class (8) =====
  { ch: 'class:list', args: [], ns: 'class', desc: '班级列表' },
  { ch: 'class:create', args: [{ class_id: `G7-${Date.now().toString().slice(-6)}`, name: `测试班_${Date.now()}`, grade: 'G7' }], ns: 'class', desc: '创建班级' },
  { ch: 'class:update', args: ['fake-id', { note: 'test' }], ns: 'class', desc: '更新班级(假id)', expectFail: true },
  { ch: 'class:archive', args: ['fake-id'], ns: 'class', desc: '存档班级(假id)', expectFail: true },
  { ch: 'class:restore', args: ['fake-id'], ns: 'class', desc: '恢复班级(假id)', expectFail: true },
  { ch: 'class:assign', args: [{ class_id: 'fake-id', student_names: ['测试学生'] }], ns: 'class', desc: '调班', expectFail: true },
  { ch: 'class:remove', args: [{ student_name: '测试学生' }], ns: 'class', desc: '移出班级' },
]

// 注: settings:reset 和 log:clear 标 skip (会清数据，不默认跑)
export const SKIPPED = CHANNEL_MATRIX.filter((c) => c.skip).map((c) => c.ch)
export const TESTABLE = CHANNEL_MATRIX.filter((c) => !c.skip)
