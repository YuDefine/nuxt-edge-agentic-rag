import { strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'

import {
  createDocxFixture,
  createPdfFixture,
  createPptxFixture,
  createXlsxFixture,
} from '../helpers/document-source-fixtures'

import { prepareDocumentVersionAssets } from '#server/utils/document-preprocessing'
import {
  DocumentSourceExtractionError,
  extractDocumentSourceSnapshot,
} from '#server/utils/document-source-extractor'

const CORRUPTED_ZIP_BYTES = strToU8('not a valid zip file')

describe('document source extractor', () => {
  describe('happy path: canonical text extraction', () => {
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
          canonicalText: ['[Sheet: Revenue]', 'Quarter | Amount', 'Q1 | 120', 'Q2 | 145'].join(
            '\n',
          ),
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

  describe('failure: non-replayable and missing-source contracts', () => {
    it('rejects empty PDF (no text content) with non-replayable-source contract', async () => {
      const emptyPdf = createPdfFixture({ pages: [[]] })

      try {
        await extractDocumentSourceSnapshot({
          filename: 'empty.pdf',
          mimeType: 'application/pdf',
          sourceBytes: emptyPdf,
        })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentSourceExtractionError)
        const extractionError = error as DocumentSourceExtractionError
        expect(extractionError.code).toBe('non-replayable-source')
        expect(extractionError.statusCode).toBe(422)
        expect(extractionError.clientMessage).toBe(
          '檔案可上傳，但目前無法抽出可引用文字。請改提供可選取文字版本，或先整理成 Markdown 後再同步。',
        )
      }
    })

    it('rejects encrypted PDF with a stable error contract', async () => {
      // A minimal PDF with an /Encrypt dictionary triggers pdfjs password rejection
      const encryptedPdfContent = [
        '%PDF-1.4',
        '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
        '2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj',
        '3 0 obj << /Type /Encrypt /Filter /Standard /V 1 /R 2 /P -44 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) >> endobj',
        'xref',
        '0 4',
        '0000000000 65535 f ',
        '0000000009 00000 n ',
        '0000000062 00000 n ',
        '0000000115 00000 n ',
        'trailer << /Size 4 /Root 1 0 R /Encrypt 3 0 R >>',
        'startxref',
        '350',
        '%%EOF',
      ].join('\n')
      const encryptedPdfBytes = strToU8(encryptedPdfContent)

      // pdfjs throws PasswordException; the extractor does not catch it, so it surfaces as-is.
      // The contract: no canonical text is returned, the error surfaces before replay assets.
      await expect(
        extractDocumentSourceSnapshot({
          filename: 'encrypted.pdf',
          mimeType: 'application/pdf',
          sourceBytes: encryptedPdfBytes,
        }),
      ).rejects.toThrow()
    })

    it('rejects corrupted zip for DOCX with non-replayable-source contract', async () => {
      await expect(
        extractDocumentSourceSnapshot({
          filename: 'corrupted.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sourceBytes: CORRUPTED_ZIP_BYTES,
        }),
      ).rejects.toThrow()
    })

    it('rejects corrupted zip for XLSX with non-replayable-source contract', async () => {
      await expect(
        extractDocumentSourceSnapshot({
          filename: 'corrupted.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sourceBytes: CORRUPTED_ZIP_BYTES,
        }),
      ).rejects.toThrow()
    })

    it('rejects corrupted zip for PPTX with non-replayable-source contract', async () => {
      await expect(
        extractDocumentSourceSnapshot({
          filename: 'corrupted.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          sourceBytes: CORRUPTED_ZIP_BYTES,
        }),
      ).rejects.toThrow()
    })

    it('rejects textless DOCX (empty paragraphs, no table) with non-replayable-source', async () => {
      const emptyDocx = createDocxFixture({ paragraphs: [''] })

      try {
        await extractDocumentSourceSnapshot({
          filename: 'empty.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sourceBytes: emptyDocx,
        })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentSourceExtractionError)
        const extractionError = error as DocumentSourceExtractionError
        expect(extractionError.code).toBe('non-replayable-source')
        expect(extractionError.statusCode).toBe(422)
        expect(extractionError.clientMessage).toBe(
          '檔案可上傳，但目前無法抽出可引用文字。請改提供可選取文字版本，或先整理成 Markdown 後再同步。',
        )
      }
    })

    it('rejects textless XLSX (empty rows) with non-replayable-source', async () => {
      const emptyXlsx = createXlsxFixture({ rows: [['']], sheetName: 'Empty' })

      try {
        await extractDocumentSourceSnapshot({
          filename: 'empty.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          sourceBytes: emptyXlsx,
        })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentSourceExtractionError)
        const extractionError = error as DocumentSourceExtractionError
        expect(extractionError.code).toBe('non-replayable-source')
        expect(extractionError.statusCode).toBe(422)
      }
    })

    it('rejects textless PPTX (empty slides) with non-replayable-source', async () => {
      const emptyPptx = createPptxFixture({ slideTexts: [['']] })

      try {
        await extractDocumentSourceSnapshot({
          filename: 'empty.pptx',
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          sourceBytes: emptyPptx,
        })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentSourceExtractionError)
        const extractionError = error as DocumentSourceExtractionError
        expect(extractionError.code).toBe('non-replayable-source')
        expect(extractionError.statusCode).toBe(422)
      }
    })

    it('fails with missing-source when sourceBytes is null for rich format', async () => {
      try {
        await extractDocumentSourceSnapshot({
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          sourceBytes: null,
        })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentSourceExtractionError)
        const extractionError = error as DocumentSourceExtractionError
        expect(extractionError.code).toBe('missing-source')
        expect(extractionError.statusCode).toBe(500)
      }
    })

    it('fails with missing-source when sourceText is null for direct-text format', async () => {
      try {
        await extractDocumentSourceSnapshot({
          filename: 'notes.md',
          mimeType: 'text/markdown',
          sourceText: null,
        })
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentSourceExtractionError)
        const extractionError = error as DocumentSourceExtractionError
        expect(extractionError.code).toBe('missing-source')
        expect(extractionError.statusCode).toBe(500)
      }
    })
  })
})
