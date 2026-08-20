// =============================================================
// 文件上传 hook — 选择文件 → 读取内容 → 维护已上传列表
// =============================================================

import { useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import type { UploadedFile } from '../lib/chat-message'

/** 已上传文件列表状态 + 上传/移除操作 */
export function useFileUpload() {
  const { t } = useT()
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])

  // 打开文件选择框并读取内容（文本/代码/图片, 最大 10MB）
  const handleUpload = async () => {
    try {
      const result = (await getAPI().sys.openDialog({
        properties: ['openFile'],
        filters: [
          {
            name: t('page.chat.upload.filterName', '文本/代码/图片'),
            extensions: [
              'txt',
              'md',
              'json',
              'yaml',
              'yml',
              'csv',
              'html',
              'xml',
              'js',
              'ts',
              'tsx',
              'jsx',
              'py',
              'rs',
              'go',
              'java',
              'c',
              'cpp',
              'h',
              'sh',
              'sql',
              'log',
              'png',
              'jpg',
              'jpeg',
              'gif',
              'svg',
              'webp',
            ],
          },
          { name: t('page.chat.upload.allFiles', '所有文件'), extensions: ['*'] },
        ],
      })) as { canceled: boolean; filePaths: string[] }
      if (result.canceled || result.filePaths.length === 0) return
      const filePath = result.filePaths[0]
      const fileName = filePath.split(/[/\\]/).pop() || filePath
      toast.info(`${t('toast.chat.readingFile', '正在读取')}: ${fileName}`)
      // 真实读取文件内容
      const fileResult = await getAPI().sys.readFile(filePath)
      if (!fileResult.success || !fileResult.content) {
        toast.error(
          `${t('toast.chat.readFailed', '读取失败')}: ${fileResult.error || t('error.unknown', '未知错误')}`,
        )
        return
      }
      const uploaded: UploadedFile = {
        name: fileResult.name || fileName,
        path: filePath,
        size: fileResult.size || 0,
        content: fileResult.content,
        mimeType: fileResult.mimeType || 'application/octet-stream',
      }
      setUploadedFiles((prev) => [...prev, uploaded])
      toast.success(
        `${t('toast.chat.readSuccess', '已读取')}: ${uploaded.name} (${(uploaded.size / 1024).toFixed(1)}KB, ${uploaded.mimeType})`,
      )
    } catch (err) {
      console.error('[Chat] File upload failed:', err)
      toast.error(t('toast.chat.fileSelectFailed'))
    }
  }

  // 移除已上传文件（按索引）
  const removeFile = (idx: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  return { uploadedFiles, setUploadedFiles, handleUpload, removeFile }
}
