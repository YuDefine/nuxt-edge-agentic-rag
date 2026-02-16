import { describe, expect, it } from 'vitest'

import { assertNever } from '../../shared/utils/assert-never'

describe('assertNever utility', () => {
  it('throws error with context when called', () => {
    expect(() => assertNever('unknown' as never, 'TestContext')).toThrowError(
      'Unhandled value in TestContext: "unknown"'
    )
  })

  it('throws error without context when context is omitted', () => {
    expect(() => assertNever('unknown' as never)).toThrowError('Unhandled value: "unknown"')
  })
})

describe('document status badge logic', () => {
  const getDocumentStatusConfig = (status: 'draft' | 'active' | 'archived') => {
    switch (status) {
      case 'draft':
        return { color: 'neutral', label: '草稿' }
      case 'active':
        return { color: 'success', label: '啟用' }
      case 'archived':
        return { color: 'warning', label: '已歸檔' }
      default:
        return assertNever(status, 'DocumentStatusBadge')
    }
  }

  it('returns correct config for draft status', () => {
    expect(getDocumentStatusConfig('draft')).toEqual({ color: 'neutral', label: '草稿' })
  })

  it('returns correct config for active status', () => {
    expect(getDocumentStatusConfig('active')).toEqual({ color: 'success', label: '啟用' })
  })

  it('returns correct config for archived status', () => {
    expect(getDocumentStatusConfig('archived')).toEqual({ color: 'warning', label: '已歸檔' })
  })
})

describe('version sync badge logic', () => {
  const getSyncStatusConfig = (status: 'pending' | 'running' | 'synced' | 'failed') => {
    switch (status) {
      case 'pending':
        return { color: 'neutral', label: '待同步' }
      case 'running':
        return { color: 'info', label: '同步中' }
      case 'synced':
        return { color: 'success', label: '已同步' }
      case 'failed':
        return { color: 'error', label: '同步失敗' }
      default:
        return assertNever(status, 'VersionSyncBadge')
    }
  }

  it('returns correct config for pending status', () => {
    expect(getSyncStatusConfig('pending')).toEqual({ color: 'neutral', label: '待同步' })
  })

  it('returns correct config for running status', () => {
    expect(getSyncStatusConfig('running')).toEqual({ color: 'info', label: '同步中' })
  })

  it('returns correct config for synced status', () => {
    expect(getSyncStatusConfig('synced')).toEqual({ color: 'success', label: '已同步' })
  })

  it('returns correct config for failed status', () => {
    expect(getSyncStatusConfig('failed')).toEqual({ color: 'error', label: '同步失敗' })
  })
})

describe('version index badge logic', () => {
  const getIndexStatusConfig = (
    status: 'pending' | 'preprocessing' | 'indexing' | 'indexed' | 'failed'
  ) => {
    switch (status) {
      case 'pending':
        return { color: 'neutral', label: '待索引' }
      case 'preprocessing':
        return { color: 'info', label: '前處理中' }
      case 'indexing':
        return { color: 'info', label: '索引中' }
      case 'indexed':
        return { color: 'success', label: '已索引' }
      case 'failed':
        return { color: 'error', label: '索引失敗' }
      default:
        return assertNever(status, 'VersionIndexBadge')
    }
  }

  it('returns correct config for indexed status', () => {
    expect(getIndexStatusConfig('indexed')).toEqual({ color: 'success', label: '已索引' })
  })

  it('returns correct config for preprocessing status', () => {
    expect(getIndexStatusConfig('preprocessing')).toEqual({ color: 'info', label: '前處理中' })
  })
})

describe('access level badge logic', () => {
  const getAccessConfig = (level: 'internal' | 'restricted') => {
    switch (level) {
      case 'internal':
        return { color: 'neutral', label: '內部' }
      case 'restricted':
        return { color: 'warning', label: '受限' }
      default:
        return assertNever(level, 'AccessLevelBadge')
    }
  }

  it('returns correct config for internal access', () => {
    expect(getAccessConfig('internal')).toEqual({ color: 'neutral', label: '內部' })
  })

  it('returns correct config for restricted access', () => {
    expect(getAccessConfig('restricted')).toEqual({ color: 'warning', label: '受限' })
  })
})
