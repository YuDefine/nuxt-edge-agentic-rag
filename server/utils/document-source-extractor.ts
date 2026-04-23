import {
  classifyDocumentSourceFormat,
  getDocumentSourceRejectionMessage,
  type DocumentSourceFormatClassification,
} from '#shared/utils/document-source-format'

export interface ExtractDocumentSourceSnapshotInput {
  filename?: string | null
  mimeType: string
  sourceBytes?: ArrayBuffer | Uint8Array | null
  sourceText?: string | null
}

export interface ExtractDocumentSourceSnapshotResult {
  canonicalText: string
  sourceFormat: DocumentSourceFormatClassification
}

export class DocumentSourceExtractionError extends Error {
  readonly clientMessage: string | null

  constructor(
    message: string,
    readonly code: 'missing-source' | 'non-replayable-source' | 'unsupported-format',
    readonly statusCode: number,
    options?: { clientMessage?: string | null },
  ) {
    super(message)
    this.name = 'DocumentSourceExtractionError'
    this.clientMessage = options?.clientMessage ?? null
  }
}

const NON_REPLAYABLE_SOURCE_MESSAGE =
  '檔案可上傳，但目前無法抽出可引用文字。請改提供可選取文字版本，或先整理成 Markdown 後再同步。'

export async function extractDocumentSourceSnapshot(
  input: ExtractDocumentSourceSnapshotInput,
): Promise<ExtractDocumentSourceSnapshotResult> {
  const sourceFormat = classifyDocumentSourceFormat({
    filename: input.filename,
    mimeType: input.mimeType,
  })
  const rejectionMessage = getDocumentSourceRejectionMessage(sourceFormat, 'sync')

  if (rejectionMessage) {
    throw new DocumentSourceExtractionError(rejectionMessage, 'unsupported-format', 400, {
      clientMessage: rejectionMessage,
    })
  }

  let canonicalText = ''

  if (sourceFormat.supportTier === 'direct-text') {
    if (typeof input.sourceText !== 'string') {
      throw new DocumentSourceExtractionError(
        'Direct text sources require sourceText',
        'missing-source',
        500,
      )
    }

    canonicalText = normalizeCanonicalText(input.sourceText)
  } else {
    const bytes = input.sourceBytes ? toUint8Array(input.sourceBytes) : null

    if (!bytes) {
      throw new DocumentSourceExtractionError(
        'Rich document sources require sourceBytes',
        'missing-source',
        500,
      )
    }

    switch (sourceFormat.format?.id) {
      case 'pdf':
        canonicalText = normalizeCanonicalText(await extractPdfCanonicalText(bytes))
        break
      case 'docx':
        canonicalText = normalizeCanonicalText(await extractDocxCanonicalText(bytes))
        break
      case 'xlsx':
        canonicalText = normalizeCanonicalText(await extractXlsxCanonicalText(bytes))
        break
      case 'pptx':
        canonicalText = normalizeCanonicalText(await extractPptxCanonicalText(bytes))
        break
      default:
        throw new DocumentSourceExtractionError(
          'Rich document format is not extractable',
          'unsupported-format',
          400,
        )
    }
  }

  if (!hasMeaningfulText(canonicalText)) {
    throw new DocumentSourceExtractionError(
      NON_REPLAYABLE_SOURCE_MESSAGE,
      'non-replayable-source',
      422,
      {
        clientMessage: NON_REPLAYABLE_SOURCE_MESSAGE,
      },
    )
  }

  return {
    canonicalText,
    sourceFormat,
  }
}

function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

function normalizeCanonicalText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

function hasMeaningfulText(value: string): boolean {
  return value
    .split('\n')
    .some((line) => line.trim() && !/^\[(?:Page \d+|Sheet: .+|Slide \d+)\]$/.test(line.trim()))
}

async function loadZipEntries(bytes: Uint8Array): Promise<Record<string, string>> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const entries = unzipSync(bytes)

  return Object.fromEntries(
    Object.entries(entries).map(([path, content]) => [path, strFromU8(content)]),
  )
}

async function extractDocxCanonicalText(bytes: Uint8Array): Promise<string> {
  const entries = await loadZipEntries(bytes)
  const documentXml = entries['word/document.xml']

  if (!documentXml) {
    throw new DocumentSourceExtractionError(
      'DOCX document.xml is missing',
      'non-replayable-source',
      422,
    )
  }

  const body = documentXml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/)?.[1] ?? ''
  const blocks = extractWordBodyBlocks(body)
  const lines: string[] = []

  for (const block of blocks) {
    if (block.startsWith('<w:tbl')) {
      const rows = block.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? []

      for (const row of rows) {
        const cells = (row.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? [])
          .map((cell) => extractXmlTagText(cell, 'w:t'))
          .filter(Boolean)

        if (cells.length > 0) {
          lines.push(cells.join(' | '))
        }
      }

      continue
    }

    const text = extractXmlTagText(block, 'w:t')
    if (text) {
      lines.push(text)
    }
  }

  return lines.join('\n')
}

async function extractXlsxCanonicalText(bytes: Uint8Array): Promise<string> {
  const entries = await loadZipEntries(bytes)
  const workbookXml = entries['xl/workbook.xml']
  const workbookRelsXml = entries['xl/_rels/workbook.xml.rels']

  if (!workbookXml || !workbookRelsXml) {
    throw new DocumentSourceExtractionError(
      'XLSX workbook is incomplete',
      'non-replayable-source',
      422,
    )
  }

  const sharedStrings = (
    entries['xl/sharedStrings.xml']?.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []
  ).map((value) => decodeXmlEntities(value.replace(/<\/?t[^>]*>/g, '')))
  const relTargets = new Map<string, string>()

  for (const match of workbookRelsXml.matchAll(
    /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g,
  )) {
    relTargets.set(match[1] ?? '', resolveZipPath('xl', match[2] ?? ''))
  }

  const lines: string[] = []

  for (const match of workbookXml.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const sheetName = decodeXmlEntities(match[1] ?? '')
    const sheetPath = relTargets.get(match[2] ?? '')
    const sheetXml = sheetPath ? entries[sheetPath] : null

    if (!sheetXml) {
      continue
    }

    lines.push(`[Sheet: ${sheetName}]`)

    for (const row of sheetXml.match(/<row\b[\s\S]*?<\/row>/g) ?? []) {
      const cells = (row.match(/<c\b[\s\S]*?<\/c>/g) ?? [])
        .map((cell) => extractSpreadsheetCellText(cell, sharedStrings))
        .filter((value) => value !== '')

      if (cells.length > 0) {
        lines.push(cells.join(' | '))
      }
    }
  }

  return lines.join('\n')
}

async function extractPptxCanonicalText(bytes: Uint8Array): Promise<string> {
  const entries = await loadZipEntries(bytes)
  const presentationXml = entries['ppt/presentation.xml']
  const presentationRelsXml = entries['ppt/_rels/presentation.xml.rels']

  if (!presentationXml || !presentationRelsXml) {
    throw new DocumentSourceExtractionError(
      'PPTX presentation is incomplete',
      'non-replayable-source',
      422,
    )
  }

  const relTargets = new Map<string, string>()

  for (const match of presentationRelsXml.matchAll(
    /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g,
  )) {
    relTargets.set(match[1] ?? '', resolveZipPath('ppt', match[2] ?? ''))
  }

  const lines: string[] = []
  let slideIndex = 0

  for (const match of presentationXml.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)) {
    slideIndex += 1
    const slidePath = relTargets.get(match[1] ?? '')
    const slideXml = slidePath ? entries[slidePath] : null

    if (!slideXml) {
      continue
    }

    lines.push(`[Slide ${slideIndex}]`)

    for (const text of extractXmlTagTexts(slideXml, 'a:t')) {
      if (text) {
        lines.push(text)
      }
    }
  }

  return lines.join('\n')
}

async function extractPdfCanonicalText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const document = await pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise
  const lines: string[] = []

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber)
    const textContent = await page.getTextContent()
    const grouped = new Map<number, Array<{ str: string; x: number }>>()

    for (const item of textContent.items as Array<{ str?: string; transform?: number[] }>) {
      const str = item.str?.trim()
      const transform = item.transform

      if (!str || !transform || transform.length < 6) {
        continue
      }

      const y = Math.round((transform[5] ?? 0) / 2) * 2
      const x = transform[4] ?? 0
      const existing = grouped.get(y) ?? []
      existing.push({ str, x })
      grouped.set(y, existing)
    }

    lines.push(`[Page ${pageNumber}]`)

    for (const [, items] of [...grouped.entries()].toSorted((a, b) => b[0] - a[0])) {
      const text = items
        .toSorted((left, right) => left.x - right.x)
        .map((item) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (text) {
        lines.push(text)
      }
    }
  }

  return lines.join('\n')
}

function extractSpreadsheetCellText(cellXml: string, sharedStrings: string[]): string {
  const cellType = cellXml.match(/\bt="([^"]+)"/)?.[1] ?? ''

  if (cellType === 'inlineStr') {
    return extractXmlTagText(cellXml, 't')
  }

  const rawValue = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1]?.trim() ?? ''

  if (!rawValue) {
    return ''
  }

  if (cellType === 's') {
    const sharedIndex = Number.parseInt(rawValue, 10)
    return Number.isFinite(sharedIndex) ? (sharedStrings[sharedIndex] ?? '') : ''
  }

  return decodeXmlEntities(rawValue)
}

function extractXmlTagText(xml: string, tagName: string): string {
  return extractXmlTagTexts(xml, tagName).join('').replace(/\s+/g, ' ').trim()
}

function extractXmlTagTexts(xml: string, tagName: string): string[] {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'g')

  return [...xml.matchAll(pattern)]
    .map((match) =>
      decodeXmlEntities(match[1] ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
}

function resolveZipPath(baseDirectory: string, target: string): string {
  if (!target) {
    return ''
  }

  if (target.startsWith('/')) {
    return target.slice(1)
  }

  return `${baseDirectory}/${target}`.replace(/\/+/g, '/')
}

function extractWordBodyBlocks(bodyXml: string): string[] {
  const blocks: string[] = []
  let cursor = 0

  while (cursor < bodyXml.length) {
    const nextParagraph = bodyXml.indexOf('<w:p', cursor)
    const nextTable = bodyXml.indexOf('<w:tbl', cursor)
    const candidates = [nextParagraph, nextTable].filter((index) => index >= 0)

    if (candidates.length === 0) {
      break
    }

    const start = Math.min(...candidates)
    const isTable = start === nextTable
    const endTag = isTable ? '</w:tbl>' : '</w:p>'
    const endIndex = bodyXml.indexOf(endTag, start)

    if (endIndex < 0) {
      break
    }

    blocks.push(bodyXml.slice(start, endIndex + endTag.length))
    cursor = endIndex + endTag.length
  }

  return blocks
}
