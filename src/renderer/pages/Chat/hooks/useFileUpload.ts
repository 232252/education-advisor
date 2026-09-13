// =============================================================
// 文件上传 hook — 选择文件 → 读取内容 → 维护已上传列表
// =============================================================

import { useState } from 'react'
import { useT } from '../../../i18n'
import { pickFiles } from '../../../lib/dialog'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import type { UploadedFile } from '../lib/chat-message'

const ARCHIVE_OR_SCAN = /\.(pdf|zip|jpe?g|png|webp|bmp)$/i

function mimeOf(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'zip') return 'application/zip'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

/** 已上传文件列表状态 + 上传/移除操作 */
export function useFileUpload() {
  const { t } = useT()
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])

  // 打开文件选择框并读取内容（文本/代码; PDF/zip/照片只记路径,不灌进上下文）
  const handleUpload = async () => {
    try {
      const filePaths = await pickFiles({
        filters: [
          {
            name: t('page.chat.upload.filterName', '文本/代码/图片/表格/试卷'),
            extensions: [
              'txt',
              'md',
              'json',
              'yaml',
              'yml',
              'csv',
              'xlsx',
              'xls',
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
              'bmp',
              'pdf',
              'zip',
            ],
          },
          { name: t('page.chat.upload.allFiles', '所有文件'), extensions: ['*'] },
        ],
      })
      if (filePaths.length === 0) return
      for (const filePath of filePaths) {
        const fileName = filePath.split(/[/\\]/).pop() || filePath
        if (ARCHIVE_OR_SCAN.test(fileName)) {
          // P0-3(09-13 深查 C1): 二进制附件只取元信息(真实大小),不读内容。
          // 此前 size 硬编码 0 → 发给模型的附件标注 "(0.0KB)",模型不信任
          // 元信息满盘找文件(实测 20+ 次 list_dir,回复拖慢 4 分钟)。
          let size = 0
          try {
            const meta = await getAPI().sys.readFile(filePath, { metaOnly: true })
            if (meta?.success && typeof meta.size === 'number') size = meta.size
          } catch {
            /* 元信息失败降级 0,不阻断上传 */
          }
          setUploadedFiles((prev) => [
            ...prev,
            {
              name: fileName,
              path: filePath,
              size,
              content: '',
              mimeType: mimeOf(fileName),
            },
          ])
          toast.success(
            `${t('toast.chat.readSuccess', '已读取')}: ${fileName} (${(size / 1024).toFixed(1)}KB)`,
          )
          continue
        }
        toast.info(`${t('toast.chat.readingFile', '正在读取')}: ${fileName}`)
        const fileResult = await getAPI().sys.readFile(filePath)
        if (!fileResult.success || !fileResult.content) {
          toast.error(
            `${t('toast.chat.readFailed', '读取失败')}: ${fileResult.error || t('error.unknown', '未知错误')}`,
          )
          continue
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
      }
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
