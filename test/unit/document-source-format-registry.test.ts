import { describe, expect, it } from 'vitest'

import {
  classifyDocumentSourceFormat,
  getDocumentSourceRejectionMessage,
  getSupportedUploadAcceptValues,
} from '#shared/utils/document-source-format'

describe('document source format registry', () => {
  describe('classifyDocumentSourceFormat', () => {
    it('classifies direct-text formats (.txt, .md)', () => {
      const txt = classifyDocumentSourceFormat({ filename: 'notes.txt', mimeType: 'text/plain' })
      expect(txt.supportTier).toBe('direct-text')
      expect(txt.extension).toBe('.txt')
      expect(txt.isSupportedUpload).toBe(true)

      const md = classifyDocumentSourceFormat({
        filename: 'quarterly-report.md',
        mimeType: 'text/markdown',
      })
      expect(md.supportTier).toBe('direct-text')
      expect(md.extension).toBe('.md')
      expect(md.isSupportedUpload).toBe(true)
    })

    it('classifies supported-rich formats (.pdf, .docx, .xlsx, .pptx)', () => {
      const pdf = classifyDocumentSourceFormat({
        filename: 'report.pdf',
        mimeType: 'application/pdf',
      })
      expect(pdf.supportTier).toBe('supported-rich')
      expect(pdf.isSupportedUpload).toBe(true)

      const docx = classifyDocumentSourceFormat({
        filename: 'doc.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      expect(docx.supportTier).toBe('supported-rich')
      expect(docx.isSupportedUpload).toBe(true)

      const xlsx = classifyDocumentSourceFormat({
        filename: 'data.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      expect(xlsx.supportTier).toBe('supported-rich')
      expect(xlsx.isSupportedUpload).toBe(true)

      const pptx = classifyDocumentSourceFormat({
        filename: 'board-deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      })
      expect(pptx.supportTier).toBe('supported-rich')
      expect(pptx.extension).toBe('.pptx')
      expect(pptx.isSupportedUpload).toBe(true)
    })

    it('classifies deferred legacy office formats (.doc, .xls, .ppt)', () => {
      const doc = classifyDocumentSourceFormat({
        filename: 'old.doc',
        mimeType: 'application/msword',
      })
      expect(doc.supportTier).toBe('deferred-legacy-office')
      expect(doc.isSupportedUpload).toBe(false)
      expect(doc.operatorGuidance).toBe('請先轉成 DOCX、PDF 或文字格式後再同步')

      const xls = classifyDocumentSourceFormat({
        filename: 'old.xls',
        mimeType: 'application/vnd.ms-excel',
      })
      expect(xls.supportTier).toBe('deferred-legacy-office')
      expect(xls.isSupportedUpload).toBe(false)
      expect(xls.operatorGuidance).toBe('請先轉成 XLSX、PDF 或文字格式後再同步')

      const ppt = classifyDocumentSourceFormat({
        filename: 'legacy-slides.ppt',
        mimeType: 'application/vnd.ms-powerpoint',
      })
      expect(ppt.supportTier).toBe('deferred-legacy-office')
      expect(ppt.extension).toBe('.ppt')
      expect(ppt.isSupportedUpload).toBe(false)
      expect(ppt.operatorGuidance).toBe('請先轉成 PPTX、PDF 或文字格式後再同步')
    })

    it('classifies deferred media formats (audio/video)', () => {
      const mp3 = classifyDocumentSourceFormat({
        filename: 'call-recording.mp3',
        mimeType: 'audio/mpeg',
      })
      expect(mp3.supportTier).toBe('deferred-media')
      expect(mp3.extension).toBe('.mp3')
      expect(mp3.isSupportedUpload).toBe(false)
      expect(mp3.operatorGuidance).toBe('媒體檔案需等待後續 transcript pipeline，暫不支援直接同步')

      const mp4 = classifyDocumentSourceFormat({
        filename: 'townhall.mp4',
        mimeType: 'video/mp4',
      })
      expect(mp4.supportTier).toBe('deferred-media')
      expect(mp4.isSupportedUpload).toBe(false)
    })

    it('classifies unknown extensions and MIME types as unknown', () => {
      const unknown = classifyDocumentSourceFormat({
        filename: 'mystery.zzz',
        mimeType: 'application/x-unknown',
      })
      expect(unknown.supportTier).toBe('unknown')
      expect(unknown.isSupportedUpload).toBe(false)
      expect(unknown.operatorGuidance).toBe(
        '不支援的檔案格式。請改用 .txt、.md、.pdf、.docx、.xlsx、.pptx',
      )
    })

    it('resolves extension/MIME mismatch by picking the format with higher tier precedence', () => {
      // Extension says .pdf (supported-rich) but MIME says audio/mpeg (deferred-media)
      const mismatch = classifyDocumentSourceFormat({
        filename: 'weird.pdf',
        mimeType: 'audio/mpeg',
      })
      // deferred-media has lower precedence number (0) vs supported-rich (2), so extension wins
      expect(mismatch.supportTier).toBe('deferred-media')
    })
  })

  describe('getSupportedUploadAcceptValues', () => {
    it('includes only direct-text and supported-rich extensions and primary MIME types', () => {
      const values = getSupportedUploadAcceptValues()

      expect(values).toEqual([
        '.txt',
        '.md',
        '.pdf',
        '.docx',
        '.xlsx',
        '.pptx',
        'text/plain',
        'text/markdown',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ])

      // Must NOT contain deferred or unknown entries
      expect(values).not.toContain('.doc')
      expect(values).not.toContain('.xls')
      expect(values).not.toContain('.ppt')
      expect(values).not.toContain('.mp3')
      expect(values).not.toContain('.mp4')
      expect(values.some((v) => v.startsWith('audio/'))).toBe(false)
      expect(values.some((v) => v.startsWith('video/'))).toBe(false)
    })
  })

  describe('getDocumentSourceRejectionMessage', () => {
    it('returns null for supported upload formats (direct-text and supported-rich)', () => {
      const md = classifyDocumentSourceFormat({
        filename: 'notes.md',
        mimeType: 'text/markdown',
      })
      expect(getDocumentSourceRejectionMessage(md, 'upload')).toBeNull()
      expect(getDocumentSourceRejectionMessage(md, 'sync')).toBeNull()

      const pdf = classifyDocumentSourceFormat({
        filename: 'report.pdf',
        mimeType: 'application/pdf',
      })
      expect(getDocumentSourceRejectionMessage(pdf, 'upload')).toBeNull()
      expect(getDocumentSourceRejectionMessage(pdf, 'sync')).toBeNull()
    })

    it('uses upload wording for legacy Office in upload context and sync wording in sync context', () => {
      const doc = classifyDocumentSourceFormat({
        filename: 'old.doc',
        mimeType: 'application/msword',
      })
      const uploadMsg = getDocumentSourceRejectionMessage(doc, 'upload')
      expect(uploadMsg).toContain('再上傳')
      expect(uploadMsg).not.toContain('再同步')

      const syncMsg = getDocumentSourceRejectionMessage(doc, 'sync')
      expect(syncMsg).toContain('再同步')
      expect(syncMsg).not.toContain('再上傳')
    })

    it('returns upload-specific media guidance for upload context', () => {
      const mp3 = classifyDocumentSourceFormat({
        filename: 'call.mp3',
        mimeType: 'audio/mpeg',
      })
      const uploadMsg = getDocumentSourceRejectionMessage(mp3, 'upload')
      expect(uploadMsg).toBe('音訊與影片需等待後續 transcript pipeline，暫不支援直接上傳')
    })

    it('returns sync-specific media guidance for sync context', () => {
      const mp4 = classifyDocumentSourceFormat({
        filename: 'town.mp4',
        mimeType: 'video/mp4',
      })
      const syncMsg = getDocumentSourceRejectionMessage(mp4, 'sync')
      expect(syncMsg).toBe('媒體檔案需等待後續 transcript pipeline，暫不支援直接同步')
    })

    it('returns generic guidance for unknown formats', () => {
      const unknown = classifyDocumentSourceFormat({
        filename: 'mystery.zzz',
        mimeType: 'application/x-unknown',
      })
      const msg = getDocumentSourceRejectionMessage(unknown, 'upload')
      expect(msg).toBe('不支援的檔案格式。支援格式：.txt, .md, .pdf, .docx, .xlsx, .pptx')
    })
  })
})
