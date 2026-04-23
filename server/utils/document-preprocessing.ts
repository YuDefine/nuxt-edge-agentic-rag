import { createHash } from 'node:crypto'

import { classifyDocumentSourceFormat } from '#shared/utils/document-source-format'

export interface PrepareDocumentVersionAssetsInput {
  accessLevel: string
  categorySlug: string
  documentId: string
  environment: string
  sourceMimeType: string
  sourceObjectKey: string
  sourceText: string
  title: string
  versionId: string
  versionNumber: number
}

export interface PreparedSourceChunk {
  accessLevel: string
  chunkHash: string
  chunkIndex: number
  chunkText: string
  citationLocator: string
  documentVersionId: string
  metadata: {
    lineEnd: number
    lineStart: number
  }
}

export interface PreparedChunkObject {
  customMetadata: Record<string, string>
  key: string
  text: string
}

export interface PreparedDocumentVersionAssets {
  chunkObjects: PreparedChunkObject[]
  metadata: {
    accessLevel: string
    categorySlug: string
    sourceMimeType: string
    sourceObjectKey: string
    title: string
    versionNumber: number
  }
  normalizedText: string
  normalizedTextR2Key: string
  smokeTestQueries: string[]
  sourceChunks: PreparedSourceChunk[]
}

export class MissingVersionReplayAssetsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MissingVersionReplayAssetsError'
  }
}

interface NormalizedLine {
  isHeading: boolean
  text: string
}

export async function prepareDocumentVersionAssets(
  input: PrepareDocumentVersionAssetsInput,
): Promise<PreparedDocumentVersionAssets> {
  const sourceFormat = getSupportedSourceFormat({
    sourceMimeType: input.sourceMimeType,
    sourceObjectKey: input.sourceObjectKey,
  })
  const normalizedSourceMimeType = sourceFormat.format?.mimeTypes[0] ?? input.sourceMimeType

  const normalizedLines = normalizeSourceLines(input.sourceText, normalizedSourceMimeType)
  const normalizedText = normalizedLines.map((line) => line.text).join('\n')
  const smokeTestQueries = buildSmokeTestQueries(normalizedLines, input.title)
  const sourceChunks = buildSourceChunks(normalizedLines, {
    accessLevel: input.accessLevel,
    documentVersionId: input.versionId,
  })
  const chunkObjects = buildChunkObjects(sourceChunks, {
    accessLevel: input.accessLevel,
    versionId: input.versionId,
  })
  const normalizedTextR2Key = createNormalizedTextR2KeyPrefix(input.versionId)

  validateVersionReplayAssets({
    normalizedTextR2Key,
    smokeTestQueries,
    sourceChunkCount: sourceChunks.length,
  })

  return {
    chunkObjects,
    metadata: {
      accessLevel: input.accessLevel,
      categorySlug: input.categorySlug,
      sourceMimeType: input.sourceMimeType,
      sourceObjectKey: input.sourceObjectKey,
      title: input.title,
      versionNumber: input.versionNumber,
    },
    normalizedText,
    normalizedTextR2Key,
    smokeTestQueries,
    sourceChunks,
  }
}

export function validateVersionReplayAssets(input: {
  normalizedTextR2Key: string | null | undefined
  smokeTestQueries: string[]
  sourceChunkCount: number
}): true {
  const missing: string[] = []

  if (!input.normalizedTextR2Key?.trim()) {
    missing.push('normalizedTextR2Key')
  }

  if (input.smokeTestQueries.length === 0) {
    missing.push('smokeTestQueries')
  }

  if (input.sourceChunkCount <= 0) {
    missing.push('sourceChunks')
  }

  if (missing.length > 0) {
    throw new MissingVersionReplayAssetsError(
      `Version replay assets are incomplete: ${missing.join(', ')}`,
    )
  }

  return true
}

export function createNormalizedTextR2KeyPrefix(versionId: string): string {
  return `normalized-text/${versionId}/`
}

export function createChunkR2Key(versionId: string, chunkIndex: number): string {
  const sequence = String(chunkIndex + 1).padStart(4, '0')
  return `normalized-text/${versionId}/${sequence}.txt`
}

function buildChunkObjects(
  sourceChunks: PreparedSourceChunk[],
  input: {
    accessLevel: string
    versionId: string
  },
): PreparedChunkObject[] {
  return sourceChunks.map((chunk) => ({
    customMetadata: {
      access_level: input.accessLevel,
      citation_locator: chunk.citationLocator,
      document_version_id: input.versionId,
      status: 'active',
      version_state: 'current',
    },
    key: createChunkR2Key(input.versionId, chunk.chunkIndex),
    text: chunk.chunkText,
  }))
}

function getSupportedSourceFormat(input: { sourceMimeType: string; sourceObjectKey: string }) {
  const sourceFormat = classifyDocumentSourceFormat({
    filename: input.sourceObjectKey,
    mimeType: input.sourceMimeType,
  })

  if (!sourceFormat.isSupportedUpload) {
    throw new TypeError(
      'Only text/plain, text/markdown, application/pdf, DOCX, XLSX, and PPTX uploads are supported',
    )
  }

  return sourceFormat
}

function normalizeSourceLines(sourceText: string, sourceMimeType: string): NormalizedLine[] {
  const withoutFrontmatter =
    sourceMimeType === 'text/markdown' ? stripMarkdownFrontmatter(sourceText) : sourceText
  const rawLines = withoutFrontmatter.split(/\r?\n/)
  const normalized: NormalizedLine[] = []

  for (const rawLine of rawLines) {
    const parsed = normalizeLine(rawLine, sourceMimeType)

    if (!parsed.text) {
      if (normalized.at(-1)?.isHeading) {
        continue
      }

      if (normalized.at(-1)?.text === '') {
        continue
      }
    }

    normalized.push(parsed)
  }

  while (normalized.at(-1)?.text === '') {
    normalized.pop()
  }

  return normalized
}

function stripMarkdownFrontmatter(sourceText: string): string {
  if (!sourceText.startsWith('---\n') && !sourceText.startsWith('---\r\n')) {
    return sourceText
  }

  const lines = sourceText.split(/\r?\n/)

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      return lines.slice(index + 1).join('\n')
    }
  }

  return sourceText
}

function normalizeLine(rawLine: string, sourceMimeType: string): NormalizedLine {
  const trimmed = rawLine.trim()

  if (!trimmed) {
    return { isHeading: false, text: '' }
  }

  if (sourceMimeType !== 'text/markdown') {
    return {
      isHeading: false,
      text: trimmed,
    }
  }

  const headingMatch = trimmed.match(/^#{1,6}\s+(.*)$/)

  if (headingMatch?.[1]) {
    return {
      isHeading: true,
      text: headingMatch[1].trim(),
    }
  }

  return {
    isHeading: false,
    text: trimmed
      .replace(/^[-*+]\s+/, '')
      .replace(/\[(?: |x)\]\s+/gi, '')
      .replace(/[*_`>#]+/g, '')
      .trim(),
  }
}

function buildSmokeTestQueries(normalizedLines: NormalizedLine[], fallbackTitle: string): string[] {
  const headingQueries = normalizedLines
    .filter((line) => line.isHeading && line.text)
    .map((line) => line.text)

  if (headingQueries.length > 0) {
    return [...new Set(headingQueries)].slice(0, 5)
  }

  const fallback = normalizedLines.find((line) => line.text)?.text ?? fallbackTitle.trim()

  return fallback ? [fallback] : []
}

function buildSourceChunks(
  normalizedLines: NormalizedLine[],
  input: { accessLevel: string; documentVersionId: string },
): PreparedSourceChunk[] {
  const chunks: PreparedSourceChunk[] = []
  let currentChunkLines: string[] = []
  let lineStart = 1

  for (let index = 0; index < normalizedLines.length; index += 1) {
    const lineNumber = index + 1
    const line = normalizedLines[index]

    if (!line) {
      continue
    }

    if (line.text === '') {
      if (currentChunkLines.length > 0) {
        chunks.push(
          createSourceChunk(currentChunkLines, chunks.length, lineStart, lineNumber - 1, input),
        )
        currentChunkLines = []
      }

      lineStart = lineNumber + 1
      continue
    }

    if (currentChunkLines.length === 0) {
      lineStart = lineNumber
    }

    currentChunkLines.push(line.text)
  }

  if (currentChunkLines.length > 0) {
    chunks.push(
      createSourceChunk(currentChunkLines, chunks.length, lineStart, normalizedLines.length, input),
    )
  }

  return chunks
}

function createSourceChunk(
  chunkLines: string[],
  chunkIndex: number,
  lineStart: number,
  lineEnd: number,
  input: { accessLevel: string; documentVersionId: string },
): PreparedSourceChunk {
  const chunkText = chunkLines.join('\n')

  return {
    accessLevel: input.accessLevel,
    chunkHash: createHash('sha256').update(chunkText).digest('hex'),
    chunkIndex,
    chunkText,
    citationLocator: `lines ${lineStart}-${lineEnd}`,
    documentVersionId: input.documentVersionId,
    metadata: {
      lineEnd,
      lineStart,
    },
  }
}
