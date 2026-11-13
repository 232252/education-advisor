// =============================================================
// ModelRow — 自定义模型的视觉能力开关
//
// DSH 的模型条目用 input 声明视觉；教师端自定义模型要能在编辑表单里
// 声明「接受图片」，否则自建网关的视觉模型进不了批改 / read_image。
// 约定同 tests/renderer/pages/models/*：真实 i18n（默认 zh 字典）。
// =============================================================

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelInfo } from '../../../../src/shared/types'
import { ModelRow } from '../../../../src/renderer/pages/Models/components/ModelRow'

const CUSTOM: ModelInfo = {
  id: 'vl-model',
  name: 'VL Model',
  providerId: 'my-gateway',
  api: 'openai-completions',
  contextWindow: 32768,
  maxOutputTokens: 4096,
  costPerInputToken: 0,
  costPerOutputToken: 0,
  supportsReasoning: false,
  supportsImage: false,
  isCustom: true,
}

function mountEdit(editForm: Record<string, string>) {
  const onEditFormChange = vi.fn()
  render(
    <table>
      <tbody>
        <ModelRow
          model={CUSTOM}
          isEditing
          editForm={editForm}
          onStartEdit={() => {}}
          onCancelEdit={() => {}}
          onSaveEdit={() => {}}
          onEditFormChange={onEditFormChange}
          onUpdateAvailable
          onDeleteAvailable
        />
      </tbody>
    </table>,
  )
  return onEditFormChange
}

afterEach(() => {
  cleanup()
})

describe('ModelRow 视觉能力编辑', () => {
  it('编辑表单里有「接受图片」开关，切换时写回 supportsImage', () => {
    const onEditFormChange = mountEdit({ supportsReasoning: 'false', supportsImage: 'false' })
    const toggle = screen.getByLabelText('接受图片输入')
    fireEvent.click(toggle)
    expect(onEditFormChange).toHaveBeenCalledWith(
      expect.objectContaining({ supportsImage: 'true' }),
    )
  })

  it('显示模式对声明了视觉的自定义模型给出标记', () => {
    render(
      <table>
        <tbody>
          <ModelRow
            model={{ ...CUSTOM, supportsImage: true }}
            isEditing={false}
            editForm={{}}
            onStartEdit={() => {}}
            onCancelEdit={() => {}}
            onSaveEdit={() => {}}
            onEditFormChange={() => {}}
            onUpdateAvailable
            onDeleteAvailable
          />
        </tbody>
      </table>,
    )
    expect(screen.getByTitle('接受图片输入')).toBeTruthy()
  })
})