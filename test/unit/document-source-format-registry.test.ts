import { describe, expect, it } from 'vitest'

import {
  classifyDocumentSourceFormat,
  getSupportedUploadAcceptValues,
} from '#shared/utils/document-source-format'

describe('document source format registry', () => {
  it('classifies direct text, supported rich, deferred legacy office, and deferred media tiers', () => {
    expect(
      classifyDocumentSourceFormat({
        filename: 'quarterly-report.md',
        mimeType: 'text/markdown',
      }),
    ).toMatchObject({
      extension: '.md',
      supportTier: 'direct-text',
    })

    expect(
      classifyDocumentSourceFormat({
        filename: 'board-deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
    ).toMatchObject({
      extension: '.pptx',
      supportTier: 'supported-rich',
    })

    expect(
      classifyDocumentSourceFormat({
        filename: 'legacy-slides.ppt',
        mimeType: 'application/vnd.ms-powerpoint',
      }),
    ).toMatchObject({
      extension: '.ppt',
      supportTier: 'deferred-legacy-office',
      operatorGuidance: '請先轉成 PPTX、PDF 或文字格式後再同步',
    })

    expect(
      classifyDocumentSourceFormat({
        filename: 'call-recording.mp3',
        mimeType: 'audio/mpeg',
      }),
    ).toMatchObject({
      extension: '.mp3',
      supportTier: 'deferred-media',
      operatorGuidance: '媒體檔案需等待後續 transcript pipeline，暫不支援直接同步',
    })
  })

  it('builds the upload accept list from the supported direct-text and rich tiers only', () => {
    expect(getSupportedUploadAcceptValues()).toEqual([
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
  })
})
