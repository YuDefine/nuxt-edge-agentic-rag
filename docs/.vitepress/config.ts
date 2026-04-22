import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Nuxt Edge Agentic RAG Docs',
  description: '面向開發、驗證與維運的專案文件站。',
  lastUpdated: true,
  cleanUrls: true,
  themeConfig: {
    search: {
      provider: 'local',
    },
    nav: [
      { text: '首頁', link: '/' },
      { text: 'Onboarding', link: '/onboarding' },
      { text: '開發文件', link: '/README' },
      { text: '驗證指南', link: '/verify/' },
      { text: '規則', link: '/rules/' },
      { text: '規格', link: '/specs/' },
      { text: 'Runbooks', link: '/runbooks/' },
      { text: '決策紀錄', link: '/decisions/' },
    ],
    sidebar: {
      '/': [
        {
          text: '開始使用',
          items: [
            { text: '文件首頁', link: '/' },
            { text: 'Onboarding Guide', link: '/onboarding' },
            { text: '開發者文件總覽', link: '/README' },
            { text: '專案結構', link: '/STRUCTURE' },
            { text: '驗證指南總覽', link: '/verify/' },
            { text: '開發規則入口', link: '/rules/' },
            { text: 'Spectra 規格入口', link: '/specs/' },
            { text: 'Runbooks 總覽', link: '/runbooks/' },
            { text: '決策紀錄', link: '/decisions/' },
            { text: '範例文件', link: '/sample-documents/' },
          ],
        },
        {
          text: '專案文件',
          items: [
            { text: 'Design Review Findings', link: '/design-review-findings' },
            { text: 'Design Tokens', link: '/design-tokens' },
            { text: 'Manual Review Checklist', link: '/manual-review-checklist' },
            { text: 'Manual Review Archive', link: '/manual-review-archive' },
            { text: 'Tech Debt Register', link: '/tech-debt' },
          ],
        },
      ],
      '/verify/': [
        {
          text: '入口',
          items: [
            { text: '總覽', link: '/verify/' },
            { text: 'README', link: '/verify/README' },
          ],
        },
        {
          text: '部署與復原',
          items: [
            { text: 'Deployment Runbook', link: '/verify/DEPLOYMENT_RUNBOOK' },
            { text: 'Disaster Recovery Runbook', link: '/verify/DISASTER_RECOVERY_RUNBOOK' },
            { text: 'Production Deploy Checklist', link: '/verify/production-deploy-checklist' },
            { text: 'Rollout Checklist', link: '/verify/rollout-checklist' },
            { text: 'Cloudflare Workers Gotchas', link: '/verify/CLOUDFLARE_WORKERS_GOTCHAS' },
          ],
        },
        {
          text: '功能驗證與 QA',
          items: [
            { text: 'Acceptance Runbook', link: '/verify/ACCEPTANCE_RUNBOOK' },
            { text: 'Config Snapshot Verification', link: '/verify/CONFIG_SNAPSHOT_VERIFICATION' },
            {
              text: 'Conversation Lifecycle Verification',
              link: '/verify/CONVERSATION_LIFECYCLE_VERIFICATION',
            },
            { text: 'Debug Surface Verification', link: '/verify/DEBUG_SURFACE_VERIFICATION' },
            { text: 'Knowledge Smoke', link: '/verify/KNOWLEDGE_SMOKE' },
            { text: 'Responsive A11y Verification', link: '/verify/RESPONSIVE_A11Y_VERIFICATION' },
            { text: 'Screenshot Guide', link: '/verify/SCREENSHOT_GUIDE' },
          ],
        },
        {
          text: '開發與架構',
          items: [
            { text: 'Composable Development', link: '/verify/COMPOSABLE_DEVELOPMENT' },
            { text: 'Pinia Architecture', link: '/verify/PINIA_ARCHITECTURE' },
            { text: 'Cache Strategy', link: '/verify/CACHE_STRATEGY' },
            { text: 'Production Bug Patterns', link: '/verify/PRODUCTION_BUG_PATTERNS' },
            { text: 'Test Driven Development', link: '/verify/TEST_DRIVEN_DEVELOPMENT' },
          ],
        },
        {
          text: '權限與保留策略',
          items: [
            { text: 'OAuth Setup', link: '/verify/OAUTH_SETUP' },
            { text: 'Retention Cleanup Runbook', link: '/verify/RETENTION_CLEANUP_RUNBOOK' },
            {
              text: 'Retention Cleanup Verification',
              link: '/verify/RETENTION_CLEANUP_VERIFICATION',
            },
            { text: 'Retention Replay Contract', link: '/verify/RETENTION_REPLAY_CONTRACT' },
          ],
        },
      ],
      '/runbooks/': [
        {
          text: 'Runbooks',
          items: [
            { text: '總覽', link: '/runbooks/' },
            { text: 'Claude Desktop MCP', link: '/runbooks/claude-desktop-mcp' },
            { text: 'Guest Policy', link: '/runbooks/guest-policy' },
          ],
        },
      ],
      '/decisions/': [
        {
          text: 'Architecture Decisions',
          items: [
            { text: '總覽', link: '/decisions/' },
            {
              text: '2026-04-18 Draft To Active Gap',
              link: '/decisions/2026-04-18-document-publish-draft-to-active-gap',
            },
            {
              text: '2026-04-18 Sync Endpoint Staging Verification',
              link: '/decisions/2026-04-18-sync-endpoint-staging-verification',
            },
            {
              text: '2026-04-19 Collapse Environments',
              link: '/decisions/2026-04-19-collapse-environments-to-local-and-production',
            },
          ],
        },
      ],
      '/sample-documents/': [
        {
          text: '範例文件',
          items: [
            { text: '總覽', link: '/sample-documents/' },
            { text: 'README', link: '/sample-documents/README' },
            { text: '人事管理規章', link: '/sample-documents/人事管理規章' },
            { text: '採購流程操作手冊 v2', link: '/sample-documents/採購流程操作手冊-v2' },
            { text: '採購流程操作手冊', link: '/sample-documents/採購流程操作手冊' },
          ],
        },
      ],
    },
    footer: {
      message: 'Docs powered by VitePress',
      copyright: 'Nuxt Edge Agentic RAG',
    },
  },
})
