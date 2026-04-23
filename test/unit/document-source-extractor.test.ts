import { describe, expect, it } from 'vitest'

import {
  createDocxFixture,
  createPdfFixture,
  createPptxFixture,
  createXlsxFixture,
} from '../helpers/document-source-fixtures'

import { prepareDocumentVersionAssets } from '#server/utils/document-preprocessing'
import { extractDocumentSourceSnapshot } from '#server/utils/document-source-extractor'

describe('document source extractor', () => {
  it('extracts canonical snapshots from supported rich formats and keeps replay assets line-oriented', async () => {
    const cases = [
      {
        canonicalText: [
          '[Page 1]',
          'Quarterly Report',
          'Revenue grew 20%.',
          '[Page 2]',
          'Risks remain.',
        ].join('\n'),
        filename: 'quarterly-report.pdf',
        fixture: createPdfFixture({
          pages: [['Quarterly Report', 'Revenue grew 20%.'], ['Risks remain.']],
        }),
        mimeType: 'application/pdf',
      },
      {
        canonicalText: [
          'Quarterly Report',
          'Executive Summary',
          'Revenue grew 20%.',
          'Region | Amount',
          'North | 120',
        ].join('\n'),
        filename: 'quarterly-report.docx',
        fixture: createDocxFixture({
          paragraphs: ['Quarterly Report', 'Executive Summary', 'Revenue grew 20%.'],
          tableRows: [
            ['Region', 'Amount'],
            ['North', '120'],
          ],
        }),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      {
        canonicalText: ['[Sheet: Revenue]', 'Quarter | Amount', 'Q1 | 120', 'Q2 | 145'].join('\n'),
        filename: 'quarterly-report.xlsx',
        fixture: createXlsxFixture({
          rows: [
            ['Quarter', 'Amount'],
            ['Q1', '120'],
            ['Q2', '145'],
          ],
          sheetName: 'Revenue',
        }),
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      {
        canonicalText: [
          '[Slide 1]',
          'Quarterly Plan',
          'Launch migration',
          'Review support metrics',
        ].join('\n'),
        filename: 'quarterly-plan.pptx',
        fixture: createPptxFixture({
          slideTexts: [['Quarterly Plan', 'Launch migration', 'Review support metrics']],
        }),
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
    ] as const

    for (const testCase of cases) {
      const extracted = await extractDocumentSourceSnapshot({
        filename: testCase.filename,
        mimeType: testCase.mimeType,
        sourceBytes: testCase.fixture,
      })

      expect(extracted.canonicalText).toBe(testCase.canonicalText)

      const assets = await prepareDocumentVersionAssets({
        accessLevel: 'internal',
        categorySlug: 'finance',
        documentId: 'doc-1',
        environment: 'local',
        sourceMimeType: testCase.mimeType,
        sourceObjectKey: `staged/local/admin-1/upload-1/${testCase.filename}`,
        sourceText: extracted.canonicalText,
        title: 'Quarterly Knowledge',
        versionId: 'ver-1',
        versionNumber: 1,
      })

      expect(assets.normalizedText).toBe(testCase.canonicalText)
      expect(assets.normalizedTextR2Key).toBe('normalized-text/ver-1/')
      expect(assets.sourceChunks.length).toBeGreaterThan(0)
      expect(assets.sourceChunks[0]?.citationLocator).toMatch(/^lines \d+-\d+$/)
      expect(assets.chunkObjects.length).toBeGreaterThan(0)
    }
  })
})
