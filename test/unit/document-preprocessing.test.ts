import { describe, expect, it } from 'vitest'

import {
  MissingVersionReplayAssetsError,
  prepareDocumentVersionAssets,
  validateVersionReplayAssets,
} from '#server/utils/document-preprocessing'

describe('document preprocessing', () => {
  it('builds normalized text, replay chunks, and smoke probes from markdown', async () => {
    const result = await prepareDocumentVersionAssets({
      accessLevel: 'restricted',
      categorySlug: 'finance',
      documentId: 'doc-1',
      environment: 'staging',
      sourceMimeType: 'text/markdown',
      sourceObjectKey: 'staged/staging/admin-1/upload-1/quarterly-report.md',
      sourceText: [
        '---',
        'title: "Ignore frontmatter"',
        '---',
        '# Quarterly Report',
        '',
        '## Executive Summary',
        'Revenue grew 20%.',
        '',
        '## Risks',
        'Watch churn carefully.',
      ].join('\n'),
      title: 'Quarterly Report',
      versionId: 'ver-1',
      versionNumber: 2,
    })

    expect(result.normalizedText).toBe(
      [
        'Quarterly Report',
        'Executive Summary',
        'Revenue grew 20%.',
        '',
        'Risks',
        'Watch churn carefully.',
      ].join('\n')
    )

    expect(result.normalizedTextR2Key).toBe('normalized/staging/doc-1/ver-1.txt')
    expect(result.metadata).toEqual({
      accessLevel: 'restricted',
      categorySlug: 'finance',
      sourceMimeType: 'text/markdown',
      sourceObjectKey: 'staged/staging/admin-1/upload-1/quarterly-report.md',
      title: 'Quarterly Report',
      versionNumber: 2,
    })
    expect(result.smokeTestQueries).toEqual(['Quarterly Report', 'Executive Summary', 'Risks'])
    expect(result.sourceChunks).toEqual([
      {
        accessLevel: 'restricted',
        chunkHash: expect.any(String),
        chunkIndex: 0,
        chunkText: ['Quarterly Report', 'Executive Summary', 'Revenue grew 20%.'].join('\n'),
        citationLocator: 'lines 1-3',
        documentVersionId: 'ver-1',
        metadata: {
          lineEnd: 3,
          lineStart: 1,
        },
      },
      {
        accessLevel: 'restricted',
        chunkHash: expect.any(String),
        chunkIndex: 1,
        chunkText: ['Risks', 'Watch churn carefully.'].join('\n'),
        citationLocator: 'lines 5-6',
        documentVersionId: 'ver-1',
        metadata: {
          lineEnd: 6,
          lineStart: 5,
        },
      },
    ])
  })

  it('rejects unsupported source mime types', async () => {
    await expect(
      prepareDocumentVersionAssets({
        accessLevel: 'internal',
        categorySlug: 'ops',
        documentId: 'doc-1',
        environment: 'local',
        sourceMimeType: 'application/pdf',
        sourceObjectKey: 'staged/local/admin-1/upload-1/playbook.pdf',
        sourceText: '%PDF-1.7',
        title: 'Ops Playbook',
        versionId: 'ver-1',
        versionNumber: 1,
      })
    ).rejects.toThrow('Only text/plain and text/markdown uploads are supported')
  })

  it('blocks versions from advancing when replay assets are incomplete', () => {
    expect(() =>
      validateVersionReplayAssets({
        normalizedTextR2Key: '',
        smokeTestQueries: [],
        sourceChunkCount: 0,
      })
    ).toThrowError(
      new MissingVersionReplayAssetsError(
        'Version replay assets are incomplete: normalizedTextR2Key, smokeTestQueries, sourceChunks'
      )
    )
  })
})
