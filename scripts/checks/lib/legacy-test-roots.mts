const LEGACY_TEST_ROOT_PREFIX = 'tests/'

export function findLegacyTestRootPaths(filePaths: string[]): string[] {
  return filePaths
    .filter((filePath) => filePath.startsWith(LEGACY_TEST_ROOT_PREFIX))
    .toSorted((left, right) => left.localeCompare(right))
}

export function formatLegacyTestRootReport(filePaths: string[]): string {
  const lines = [
    '❌ Deprecated test root detected.',
    '請改放到 test/ 或 e2e/，不要新增 tracked 檔案到 tests/。',
    '',
    ...filePaths.map((filePath) => `- ${filePath}`),
  ]

  return lines.join('\n')
}
