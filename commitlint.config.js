const hasChineseCharacter = (value) => /[\p{Script=Han}]/u.test(value ?? '')

export default {
  extends: ['@commitlint/config-conventional'],

  // 自定義解析器：支援「✨ feat: 主旨」與「✨ feat(scope): 主旨」格式。
  parserPreset: {
    parserOpts: {
      headerPattern:
        /^(✨ feat|🐛 fix|🧹 chore|🔨 refactor|🧪 test|🎨 style|📝 docs|📦 build|👷 ci|⏪ revert|🚀 deploy|🎉 init)(?:\(([^)]+)\))?: (.+)$/,
      headerCorrespondence: ['type', 'scope', 'subject'],
    },
  },

  plugins: [
    {
      rules: {
        'subject-has-chinese': ({ subject }) => [
          hasChineseCharacter(subject),
          'commit subject 必須包含中文，請使用繁體中文描述變更內容',
        ],
      },
    },
  ],

  rules: {
    // 允許的 commit 類型（包含 emoji）
    'type-enum': [
      2,
      'always',
      [
        '✨ feat',
        '🐛 fix',
        '🧹 chore',
        '🔨 refactor',
        '🧪 test',
        '🎨 style',
        '📝 docs',
        '📦 build',
        '👷 ci',
        '⏪ revert',
        '🚀 deploy',
        '🎉 init',
      ],
    ],
    // 關閉 type-case 檢查（因為我們的 type 包含 emoji 和空格）
    'type-case': [0],
    // 關閉 type-empty 檢查（由 type-enum 處理）
    'type-empty': [0],
    // scope 允許自由格式（例如 security、tooling），但不是必填。
    'scope-case': [0],
    // 允許 subject 以小寫或大寫開頭（中文沒有大小寫）
    'subject-case': [0],
    // 專案規則要求 commit message 以中文描述。
    'subject-has-chinese': [2, 'always'],
  },
}
