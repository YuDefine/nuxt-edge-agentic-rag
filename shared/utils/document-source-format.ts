export type DocumentSourceSupportTier =
  | 'direct-text'
  | 'supported-rich'
  | 'deferred-legacy-office'
  | 'deferred-media'
  | 'unknown'

export interface DocumentSourceFormatDefinition {
  extensions: readonly string[]
  id: string
  label: string
  mimePrefixes?: readonly string[]
  mimeTypes: readonly string[]
  operatorGuidance: string
  supportTier: Exclude<DocumentSourceSupportTier, 'unknown'>
}

export interface DocumentSourceFormatClassification {
  extension: string
  format: DocumentSourceFormatDefinition | null
  isSupportedUpload: boolean
  mimeType: string
  operatorGuidance: string
  supportTier: DocumentSourceSupportTier
}

const UNKNOWN_FORMAT_GUIDANCE = '不支援的檔案格式。請改用 .txt、.md、.pdf、.docx、.xlsx、.pptx'

const GENERIC_UPLOAD_GUIDANCE = '不支援的檔案格式。支援格式：.txt, .md, .pdf, .docx, .xlsx, .pptx'

const DIRECT_TEXT_TIER: DocumentSourceFormatDefinition[] = [
  {
    id: 'txt',
    label: 'Plain text',
    extensions: ['.txt'],
    mimeTypes: ['text/plain'],
    operatorGuidance: '文字檔可直接建立 canonical snapshot',
    supportTier: 'direct-text',
  },
  {
    id: 'md',
    label: 'Markdown',
    extensions: ['.md'],
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    operatorGuidance: 'Markdown 可直接建立 canonical snapshot',
    supportTier: 'direct-text',
  },
]

const SUPPORTED_RICH_TIER: DocumentSourceFormatDefinition[] = [
  {
    id: 'pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    operatorGuidance: 'PDF 會先抽成 line-oriented canonical snapshot 再同步',
    supportTier: 'supported-rich',
  },
  {
    id: 'docx',
    label: 'Word (DOCX)',
    extensions: ['.docx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    operatorGuidance: 'DOCX 會先抽成 canonical snapshot 再同步',
    supportTier: 'supported-rich',
  },
  {
    id: 'xlsx',
    label: 'Excel (XLSX)',
    extensions: ['.xlsx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    operatorGuidance: 'XLSX 會先抽成 canonical snapshot 再同步',
    supportTier: 'supported-rich',
  },
  {
    id: 'pptx',
    label: 'PowerPoint (PPTX)',
    extensions: ['.pptx'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    operatorGuidance: 'PPTX 會先抽成 canonical snapshot 再同步',
    supportTier: 'supported-rich',
  },
]

const DEFERRED_LEGACY_OFFICE_TIER: DocumentSourceFormatDefinition[] = [
  {
    id: 'doc',
    label: 'Word (DOC)',
    extensions: ['.doc'],
    mimeTypes: ['application/msword'],
    operatorGuidance: '請先轉成 DOCX、PDF 或文字格式後再同步',
    supportTier: 'deferred-legacy-office',
  },
  {
    id: 'xls',
    label: 'Excel (XLS)',
    extensions: ['.xls'],
    mimeTypes: ['application/vnd.ms-excel'],
    operatorGuidance: '請先轉成 XLSX、PDF 或文字格式後再同步',
    supportTier: 'deferred-legacy-office',
  },
  {
    id: 'ppt',
    label: 'PowerPoint (PPT)',
    extensions: ['.ppt'],
    mimeTypes: ['application/vnd.ms-powerpoint'],
    operatorGuidance: '請先轉成 PPTX、PDF 或文字格式後再同步',
    supportTier: 'deferred-legacy-office',
  },
]

const DEFERRED_MEDIA_TIER: DocumentSourceFormatDefinition[] = [
  {
    id: 'media-audio-video',
    label: 'Audio/Video',
    extensions: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.mp4', '.mov', '.m4v', '.webm'],
    mimePrefixes: ['audio/', 'video/'],
    mimeTypes: [],
    operatorGuidance: '媒體檔案需等待後續 transcript pipeline，暫不支援直接同步',
    supportTier: 'deferred-media',
  },
]

export const DOCUMENT_SOURCE_FORMATS: readonly DocumentSourceFormatDefinition[] = [
  ...DIRECT_TEXT_TIER,
  ...SUPPORTED_RICH_TIER,
  ...DEFERRED_LEGACY_OFFICE_TIER,
  ...DEFERRED_MEDIA_TIER,
]

const OCTET_STREAM_MIME = 'application/octet-stream'
const SUPPORTED_UPLOAD_TIERS = new Set<DocumentSourceSupportTier>(['direct-text', 'supported-rich'])
const TIER_PRECEDENCE: Record<DocumentSourceSupportTier, number> = {
  'deferred-media': 0,
  'deferred-legacy-office': 1,
  'supported-rich': 2,
  'direct-text': 3,
  unknown: 4,
}

function normalizeMimeType(value?: string | null): string {
  return value?.trim().toLowerCase() ?? ''
}

function normalizeExtension(filename?: string | null): string {
  const candidate = filename?.trim().toLowerCase() ?? ''
  const extension = candidate.match(/\.[^./\\]+$/)?.[0]
  return extension ?? ''
}

function findFormatByExtension(extension: string): DocumentSourceFormatDefinition | null {
  return DOCUMENT_SOURCE_FORMATS.find((format) => format.extensions.includes(extension)) ?? null
}

function findFormatByMimeType(mimeType: string): DocumentSourceFormatDefinition | null {
  return (
    DOCUMENT_SOURCE_FORMATS.find(
      (format) =>
        format.mimeTypes.includes(mimeType) ||
        format.mimePrefixes?.some((prefix) => mimeType.startsWith(prefix)),
    ) ?? null
  )
}

function pickPreferredFormat(input: {
  extension: string
  extensionMatch: DocumentSourceFormatDefinition | null
  mimeMatch: DocumentSourceFormatDefinition | null
  mimeType: string
}): DocumentSourceFormatDefinition | null {
  if (input.extensionMatch && !input.mimeMatch) {
    return input.extensionMatch
  }

  if (!input.extensionMatch && input.mimeMatch) {
    return input.mimeMatch
  }

  if (!input.extensionMatch || !input.mimeMatch) {
    return null
  }

  if (input.extensionMatch.id === input.mimeMatch.id) {
    return input.extensionMatch
  }

  if (!input.extension && input.mimeMatch) {
    return input.mimeMatch
  }

  if (!input.mimeType || input.mimeType === OCTET_STREAM_MIME) {
    return input.extensionMatch
  }

  return TIER_PRECEDENCE[input.extensionMatch.supportTier] <=
    TIER_PRECEDENCE[input.mimeMatch.supportTier]
    ? input.extensionMatch
    : input.mimeMatch
}

export function classifyDocumentSourceFormat(input: {
  filename?: string | null
  mimeType?: string | null
}): DocumentSourceFormatClassification {
  const extension = normalizeExtension(input.filename)
  const mimeType = normalizeMimeType(input.mimeType)
  const extensionMatch = findFormatByExtension(extension)
  const mimeMatch = findFormatByMimeType(mimeType)
  const format = pickPreferredFormat({
    extension,
    extensionMatch,
    mimeMatch,
    mimeType,
  })

  if (!format) {
    return {
      extension,
      format: null,
      isSupportedUpload: false,
      mimeType,
      operatorGuidance: UNKNOWN_FORMAT_GUIDANCE,
      supportTier: 'unknown',
    }
  }

  return {
    extension,
    format,
    isSupportedUpload: SUPPORTED_UPLOAD_TIERS.has(format.supportTier),
    mimeType,
    operatorGuidance: format.operatorGuidance,
    supportTier: format.supportTier,
  }
}

export function getDocumentSourceRejectionMessage(
  classification: DocumentSourceFormatClassification,
  context: 'upload' | 'sync',
): string | null {
  if (classification.isSupportedUpload) {
    return null
  }

  if (classification.supportTier === 'deferred-legacy-office' && classification.format) {
    return classification.operatorGuidance.replace(
      '再同步',
      context === 'upload' ? '再上傳' : '再同步',
    )
  }

  if (classification.supportTier === 'deferred-media') {
    return context === 'upload'
      ? '音訊與影片需等待後續 transcript pipeline，暫不支援直接上傳'
      : classification.operatorGuidance
  }

  return GENERIC_UPLOAD_GUIDANCE
}

export function getSupportedUploadAcceptValues(): string[] {
  const supportedFormats = DOCUMENT_SOURCE_FORMATS.filter((format) =>
    SUPPORTED_UPLOAD_TIERS.has(format.supportTier),
  )

  return [
    ...supportedFormats.flatMap((format) => format.extensions),
    ...supportedFormats.flatMap((format) => (format.mimeTypes[0] ? [format.mimeTypes[0]] : [])),
  ]
}
