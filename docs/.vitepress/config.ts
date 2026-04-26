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
      { text: 'Solutions', link: '/solutions/' },
      { text: 'Evals', link: '/evals/' },
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
            { text: 'Solutions', link: '/solutions/' },
            { text: 'Evals', link: '/evals/' },
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
            {
              text: 'Web Chat Persistence Verification',
              link: '/verify/WEB_CHAT_PERSISTENCE_VERIFICATION',
            },
            { text: 'Responsive A11y Verification', link: '/verify/RESPONSIVE_A11Y_VERIFICATION' },
            { text: 'Screenshot Guide', link: '/verify/SCREENSHOT_GUIDE' },
          ],
        },
        {
          text: 'Workers AI',
          items: [
            {
              text: 'Workers AI Accepted Path Verification',
              link: '/verify/WORKERS_AI_ACCEPTED_PATH_VERIFICATION',
            },
            {
              text: 'Workers AI Baseline Reporting',
              link: '/verify/WORKERS_AI_BASELINE_REPORTING',
            },
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
            { text: 'Remote MCP Connectors', link: '/runbooks/remote-mcp-connectors' },
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
              text: '2026-04-26 RAG Query Rewriting',
              link: '/decisions/2026-04-26-rag-query-rewriting',
            },
            {
              text: '2026-04-25 Cloudflare SSE Streaming Bypass',
              link: '/decisions/2026-04-25-cloudflare-sse-streaming-bypass',
            },
            {
              text: '2026-04-25 User Profiles App-Level Migrate',
              link: '/decisions/2026-04-25-user-profiles-app-level-migrate',
            },
            {
              text: '2026-04-23 Canonical Root Handoff Artifact',
              link: '/decisions/2026-04-23-canonical-root-handoff-artifact',
            },
            {
              text: '2026-04-23 Claude Source Of Truth Across Offline Repos',
              link: '/decisions/2026-04-23-claude-source-of-truth-across-offline-repos',
            },
            {
              text: '2026-04-23 Recognize Staging As Active Environment',
              link: '/decisions/2026-04-23-recognize-staging-as-active-environment',
            },
            {
              text: '2026-04-22 Canonical Test Roots And Repo Archives',
              link: '/decisions/2026-04-22-canonical-test-roots-and-repo-archives',
            },
            {
              text: '2026-04-22 Stable Current Report Entry',
              link: '/decisions/2026-04-22-stable-current-report-entry',
            },
            {
              text: '2026-04-19 Collapse Environments',
              link: '/decisions/2026-04-19-collapse-environments-to-local-and-production',
            },
            {
              text: '2026-04-18 Sync Endpoint Staging Verification',
              link: '/decisions/2026-04-18-sync-endpoint-staging-verification',
            },
            {
              text: '2026-04-18 Document Publish Draft To Active Gap',
              link: '/decisions/2026-04-18-document-publish-draft-to-active-gap',
            },
          ],
        },
      ],
      '/solutions/': [
        {
          text: '入口',
          items: [
            { text: '總覽', link: '/solutions/' },
            { text: '寫作規範', link: '/solutions/README' },
          ],
        },
        {
          text: 'Auth',
          items: [
            {
              text: 'Admin Allowlist Session Reconciliation',
              link: '/solutions/auth/admin-allowlist-session-reconciliation',
            },
            {
              text: 'Better Auth Passkey Worker Catch-all Override',
              link: '/solutions/auth/better-auth-passkey-worker-catchall-override',
            },
            {
              text: 'Passkey Self Delete Hard Redirect',
              link: '/solutions/auth/passkey-self-delete-hard-redirect',
            },
          ],
        },
        {
          text: 'MCP',
          items: [
            {
              text: 'MCP Body Stream Consumption',
              link: '/solutions/mcp-body-stream-consumption',
            },
            {
              text: 'MCP Streamable HTTP 405 Stateless',
              link: '/solutions/mcp-streamable-http-405-stateless',
            },
            {
              text: 'MCP Streamable HTTP Session Durable Objects',
              link: '/solutions/mcp-streamable-http-session-durable-objects',
            },
          ],
        },
        {
          text: 'Tooling',
          items: [
            {
              text: 'Cloudflare Pages UTF-8 Commit Message',
              link: '/solutions/tooling/2026-04-25-cloudflare-pages-utf8-commit-message',
            },
            {
              text: 'PostToolUse Hook Non-JSON stdin',
              link: '/solutions/tooling/posttooluse-hook-non-json-stdin',
            },
          ],
        },
      ],
      '/evals/': [
        {
          text: 'Evals',
          items: [
            { text: '總覽', link: '/evals/' },
            { text: 'MCP Tool Selection', link: '/evals/mcp-tool-selection' },
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
