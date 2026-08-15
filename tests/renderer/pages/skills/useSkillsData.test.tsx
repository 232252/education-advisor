// =============================================================
// useSkillsData — SkillsTab 数据加载与动作 handlers 测试
// 覆盖: 初始加载、选择(脏切换确认)、保存、删除确认、创建(默认内容)、
//       导入、beforeunload 守卫、右键菜单删除事件
// =============================================================

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Skill } from '@shared/types'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    skill: {
      list: mocks.list,
      save: mocks.save,
      get: mocks.get,
      delete: mocks.delete,
    },
  }),
}))

vi.mock('../../../../src/renderer/stores/toastStore', () => ({
  toast: toastMocks,
}))

import { useSkillsData } from '../../../../src/renderer/pages/Skills/hooks/useSkillsData'

function skill(name: string, content = `# ${name}`): Skill {
  return {
    name,
    description: '',
    content,
    source: 'user',
    filePath: `/skills/${name}.md`,
  }
}

const SKILLS: Skill[] = [skill('skill-a', '# A body'), skill('skill-b', '# B body')]

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function renderLoaded() {
  const rendered = renderHook(() => useSkillsData())
  await flush()
  return rendered
}
describe('useSkillsData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue(SKILLS)
    mocks.save.mockResolvedValue({ success: true })
    mocks.get.mockResolvedValue(null)
    mocks.delete.mockResolvedValue({ success: true })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('初始加载', () => {
    it('加载 skills 且 loading=false', async () => {
      const { result } = await renderLoaded()

      expect(mocks.list).toHaveBeenCalledTimes(1)
      expect(result.current.skills.map((s) => s.name)).toEqual(['skill-a', 'skill-b'])
      expect(result.current.loading).toBe(false)
      expect(result.current.selected).toBe(null)
    })

    it('list 失败: toast.error', async () => {
      mocks.list.mockRejectedValue(new Error('ipc down'))
      const { result } = await renderLoaded()

      expect(result.current.loading).toBe(false)
      expect(result.current.skills).toEqual([])
      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })

    it('userMenuJson 预计算右键菜单 JSON', async () => {
      const { result } = await renderLoaded()
      const parsed = JSON.parse(result.current.userMenuJson) as Array<{
        label: string
        action: string
        variant: string
      }>
      expect(parsed).toHaveLength(1)
      expect(parsed[0].action).toBe('delete')
      expect(parsed[0].variant).toBe('danger')
    })
  })

  describe('handleSelect', () => {
    it('非脏状态: 直接切换选中并载入内容', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.handleSelect(SKILLS[0])
      })
      expect(result.current.selected?.name).toBe('skill-a')
      expect(result.current.editContent).toBe('# A body')
      expect(result.current.dirty).toBe(false)

      act(() => {
        result.current.handleSelect(SKILLS[1])
      })
      expect(result.current.selected?.name).toBe('skill-b')
    })

    it('脏状态: 打开确认框,onConfirm 后切换', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.handleSelect(SKILLS[0])
      })
      act(() => {
        result.current.setDirty(true)
      })

      act(() => {
        result.current.handleSelect(SKILLS[1])
      })
      // 不直接切换,而是弹确认
      expect(result.current.selected?.name).toBe('skill-a')
      expect(result.current.confirmState.open).toBe(true)
      expect(result.current.confirmState.message).toBeTruthy()

      await act(async () => {
        result.current.confirmState.onConfirm()
      })
      expect(result.current.selected?.name).toBe('skill-b')
      expect(result.current.editContent).toBe('# B body')
      expect(result.current.dirty).toBe(false)
      expect(result.current.confirmState.open).toBe(false)
    })
  })

  describe('handleSave', () => {
    it('未选中或非脏时不调用 save', async () => {
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleSave()
      })
      expect(mocks.save).not.toHaveBeenCalled()
    })

    it('成功: dirty 复位,选中内容更新,toast.success', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.handleSelect(SKILLS[0])
      })
      act(() => {
        result.current.setEditContent('# A edited')
        result.current.setDirty(true)
      })
      expect(result.current.dirty).toBe(true)

      await act(async () => {
        await result.current.handleSave()
      })

      expect(mocks.save).toHaveBeenCalledWith('skill-a', '# A edited')
      expect(result.current.dirty).toBe(false)
      expect(result.current.selected?.content).toBe('# A edited')
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
    })

    it('success=false: toast.error', async () => {
      mocks.save.mockResolvedValue({ success: false })
      const { result } = await renderLoaded()

      act(() => {
        result.current.handleSelect(SKILLS[0])
      })
      act(() => {
        result.current.setEditContent('x')
        result.current.setDirty(true)
      })
      await act(async () => {
        await result.current.handleSave()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(result.current.dirty).toBe(true)
    })

    it('save 抛错: toast.error(error.unknown)', async () => {
      mocks.save.mockRejectedValue(new Error('disk full'))
      const { result } = await renderLoaded()

      act(() => {
        result.current.handleSelect(SKILLS[0])
      })
      act(() => {
        result.current.setEditContent('x')
        result.current.setDirty(true)
      })
      await act(async () => {
        await result.current.handleSave()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
      expect(result.current.saving).toBe(false)
    })
  })
  describe('handleDelete', () => {
    it('打开 danger 确认框;确认后删除并刷新', async () => {
      const { result } = await renderLoaded()
      mocks.list.mockClear()

      await act(async () => {
        await result.current.handleDelete('skill-b')
      })
      expect(result.current.confirmState.open).toBe(true)
      expect(result.current.confirmState.variant).toBe('danger')
      expect(result.current.confirmState.message).toContain('skill-b')

      await act(async () => {
        await result.current.confirmState.onConfirm()
      })
      expect(mocks.delete).toHaveBeenCalledWith('skill-b')
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(mocks.list).toHaveBeenCalledTimes(1)
      expect(result.current.confirmState.open).toBe(false)
    })

    it('删除当前选中技能: 确认后清空编辑器', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.handleSelect(SKILLS[0])
      })
      await act(async () => {
        await result.current.handleDelete('skill-a')
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(mocks.delete).toHaveBeenCalledWith('skill-a')
      expect(result.current.selected).toBe(null)
      expect(result.current.dirty).toBe(false)
    })

    it('delete 返回 success=false: toast.error(result.error)', async () => {
      mocks.delete.mockResolvedValue({ success: false, error: 'readonly' })
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleDelete('skill-a')
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(toastMocks.error).toHaveBeenCalledWith('readonly')
    })

    it('delete 抛错: toast.error', async () => {
      mocks.delete.mockRejectedValue(new Error('boom'))
      const { result } = await renderLoaded()

      await act(async () => {
        await result.current.handleDelete('skill-a')
      })
      await act(async () => {
        await result.current.confirmState.onConfirm()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleCreate', () => {
    it('空名称: toast.warning 且不保存', async () => {
      const { result } = await renderLoaded()

      act(() => {
        result.current.setNewName('   ')
      })
      await act(async () => {
        await result.current.handleCreate()
      })

      expect(toastMocks.warning).toHaveBeenCalledTimes(1)
      expect(mocks.save).not.toHaveBeenCalled()
    })

    it('带自定义内容: 保存后重置表单并选中新建技能', async () => {
      const created = skill('new-skill', 'my content')
      mocks.get.mockResolvedValue(created)
      const { result } = await renderLoaded()

      act(() => {
        result.current.setNewName('new-skill')
        result.current.setNewDesc('描述')
        result.current.setNewContent('my content')
        result.current.setShowNewForm(true)
      })
      await act(async () => {
        await result.current.handleCreate()
      })

      expect(mocks.save).toHaveBeenCalledWith('new-skill', 'my content')
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(result.current.showNewForm).toBe(false)
      expect(result.current.newName).toBe('')
      expect(result.current.selected?.name).toBe('new-skill')
      expect(result.current.editContent).toBe('my content')
    })

    it('无内容时生成默认 frontmatter 模板', async () => {
      const created = skill('tpl-skill', 'generated')
      mocks.get.mockResolvedValue(created)
      const { result } = await renderLoaded()

      act(() => {
        result.current.setNewName('tpl-skill')
      })
      await act(async () => {
        await result.current.handleCreate()
      })

      const savedContent = mocks.save.mock.calls[0][1] as string
      expect(savedContent).toContain('---')
      expect(savedContent).toContain('description:')
      expect(savedContent).toContain('# tpl-skill')
    })

    it('保存失败: toast.error', async () => {
      mocks.save.mockRejectedValue(new Error('x'))
      const { result } = await renderLoaded()

      act(() => {
        result.current.setNewName('fail-skill')
      })
      await act(async () => {
        await result.current.handleCreate()
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleImport / handleFileSelected', () => {
    it('导入 .md 文件: 按文件名(去后缀)保存', async () => {
      const { result } = await renderLoaded()
      const file = new File(['# Imported'], 'note.md', { type: 'text/markdown' })
      const target = { files: [file], value: 'x' }

      await act(async () => {
        await result.current.handleFileSelected({
          target,
        } as unknown as React.ChangeEvent<HTMLInputElement>)
      })

      expect(mocks.save).toHaveBeenCalledWith('note', '# Imported')
      expect(toastMocks.success).toHaveBeenCalledTimes(1)
      expect(target.value).toBe('')
    })

    it('导入失败: toast.error', async () => {
      mocks.save.mockRejectedValue(new Error('x'))
      const { result } = await renderLoaded()
      const file = new File(['# X'], 'bad.md', { type: 'text/markdown' })

      await act(async () => {
        await result.current.handleFileSelected({
          target: { files: [file], value: 'x' },
        } as unknown as React.ChangeEvent<HTMLInputElement>)
      })

      expect(toastMocks.error).toHaveBeenCalledTimes(1)
    })
  })

  describe('未保存守卫与右键菜单', () => {
    it('dirty 时 beforeunload 被 preventDefault;非 dirty 不拦截', async () => {
      const { result } = await renderLoaded()

      const clean = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(clean)
      expect(clean.defaultPrevented).toBe(false)

      act(() => {
        result.current.setDirty(true)
      })
      const guarded = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(guarded)
      expect(guarded.defaultPrevented).toBe(true)
    })

    it('ctx-menu-action delete 事件触发删除确认', async () => {
      const { result } = await renderLoaded()

      const el = document.createElement('div')
      el.setAttribute('data-ctx-skill-name', 'skill-a')
      document.body.appendChild(el)
      try {
        await act(async () => {
          document.dispatchEvent(
            new CustomEvent('ctx-menu-action', {
              detail: { action: 'delete', target: el },
            }),
          )
        })
        expect(result.current.confirmState.open).toBe(true)
        expect(result.current.confirmState.message).toContain('skill-a')

        // 无 name 属性的目标不触发
        await act(async () => {
          result.current.setConfirmState({ open: false, message: '', onConfirm: () => {} })
        })
        const el2 = document.createElement('div')
        document.body.appendChild(el2)
        await act(async () => {
          document.dispatchEvent(
            new CustomEvent('ctx-menu-action', {
              detail: { action: 'delete', target: el2 },
            }),
          )
        })
        expect(result.current.confirmState.open).toBe(false)
      } finally {
        document.body.removeChild(el)
      }
    })
  })
})