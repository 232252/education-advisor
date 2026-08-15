// =============================================================
// useStudentSelection — 学生批量选择域 hook 测试
// 覆盖: toggleSelect / toggleSelectAll(全选+取消) / exitSelectMode /
//       allVisibleSelected 派生 / 可见列表变化后的 ref 同步
// =============================================================

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { EAAStudent } from '@shared/types'
import { useStudentSelection } from '../../../../src/renderer/pages/Students/hooks/useStudentSelection'

function makeStudent(name: string): EAAStudent {
  return {
    name,
    entity_id: `e-${name}`,
    score: 100,
    delta: 0,
    risk: '低',
    status: 'Active',
    events_count: 0,
    groups: [],
    roles: [],
    class_id: null,
  }
}

const visible = [makeStudent('甲'), makeStudent('乙'), makeStudent('丙')]

function setup(initial: EAAStudent[] = visible) {
  return renderHook((students: EAAStudent[]) => useStudentSelection(students), {
    initialProps: initial,
  })
}

describe('useStudentSelection — 初始状态', () => {
  it('默认: 未开启选择模式, 选中集合为空', () => {
    const { result } = setup()
    expect(result.current.selectMode).toBe(false)
    expect(result.current.selectedNames.size).toBe(0)
    expect(result.current.batchDeleting).toBe(false)
    expect(result.current.batchAssigning).toBe(false)
    expect(result.current.batchAssignTarget).toBe('')
    expect(result.current.allVisibleSelected).toBe(false)
  })

  it('空可见列表: allVisibleSelected 恒为 false', () => {
    const { result } = setup([])
    expect(result.current.allVisibleSelected).toBe(false)
  })
})

describe('useStudentSelection — toggleSelect', () => {
  it('选中未选中的学生', () => {
    const { result } = setup()
    act(() => {
      result.current.toggleSelect('甲')
    })
    expect(result.current.selectedNames.has('甲')).toBe(true)
    expect(result.current.selectedNames.size).toBe(1)
  })

  it('再次点击取消选中', () => {
    const { result } = setup()
    act(() => {
      result.current.toggleSelect('甲')
    })
    act(() => {
      result.current.toggleSelect('甲')
    })
    expect(result.current.selectedNames.has('甲')).toBe(false)
    expect(result.current.selectedNames.size).toBe(0)
  })
})

describe('useStudentSelection — toggleSelectAll', () => {
  it('全选当前可见列表', () => {
    const { result } = setup()
    act(() => {
      result.current.toggleSelectAll()
    })
    expect(Array.from(result.current.selectedNames).sort()).toEqual(['丙', '乙', '甲'])
    expect(result.current.allVisibleSelected).toBe(true)
  })

  it('已全选时再次调用: 清空可见项的选中', () => {
    const { result } = setup()
    act(() => {
      result.current.toggleSelectAll()
    })
    act(() => {
      result.current.toggleSelectAll()
    })
    expect(result.current.selectedNames.size).toBe(0)
    expect(result.current.allVisibleSelected).toBe(false)
  })

  it('部分选中时全选: 保留既有选中并补全可见项', () => {
    const { result } = setup()
    act(() => {
      result.current.toggleSelect('甲')
    })
    act(() => {
      result.current.toggleSelectAll()
    })
    expect(result.current.selectedNames.size).toBe(3)
  })

  it('可见列表变化后(ref 同步): 全选作用于新列表', () => {
    const { result, rerender } = setup()
    // 先全选原始 3 人
    act(() => {
      result.current.toggleSelectAll()
    })
    // 可见列表缩小为 2 人
    act(() => {
      rerender([visible[0], visible[1]])
    })
    // 新列表已全选 → 再次全选应移除这 2 人(丙仍保留)
    act(() => {
      result.current.toggleSelectAll()
    })
    expect(result.current.selectedNames.has('甲')).toBe(false)
    expect(result.current.selectedNames.has('乙')).toBe(false)
    expect(result.current.selectedNames.has('丙')).toBe(true)
  })
})

describe('useStudentSelection — exitSelectMode', () => {
  it('退出时清空选择模式/选中集合/调班目标', () => {
    const { result } = setup()
    act(() => {
      result.current.setSelectMode(true)
      result.current.toggleSelect('甲')
      result.current.setBatchAssignTarget('G7-1')
    })
    act(() => {
      result.current.exitSelectMode()
    })
    expect(result.current.selectMode).toBe(false)
    expect(result.current.selectedNames.size).toBe(0)
    expect(result.current.batchAssignTarget).toBe('')
  })
})

describe('useStudentSelection — 批量操作状态', () => {
  it('setBatchDeleting / setBatchAssigning / setBatchAssignTarget 可独立更新', () => {
    const { result } = setup()
    act(() => {
      result.current.setBatchDeleting(true)
      result.current.setBatchAssigning(true)
      result.current.setBatchAssignTarget('G7-2')
    })
    expect(result.current.batchDeleting).toBe(true)
    expect(result.current.batchAssigning).toBe(true)
    expect(result.current.batchAssignTarget).toBe('G7-2')
  })
})