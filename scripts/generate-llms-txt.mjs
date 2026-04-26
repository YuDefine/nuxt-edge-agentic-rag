#!/usr/bin/env node
/**
 * Generate llms.txt and llms-full.txt for the VitePress docs site.
 * Standard: https://llmstxt.org
 *
 * Usage: node scripts/generate-llms-txt.mjs
 * Reads:  docs/**\/*.md (excluding .vitepress/, dist/, node_modules/)
 * Writes: docs/.vitepress/dist/llms.txt
 *         docs/.vitepress/dist/llms-full.txt
 *
 * Run after `vitepress build docs` so dist/ exists.
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DOCS_DIR = join(REPO_ROOT, 'docs')
const DIST_DIR = join(DOCS_DIR, '.vitepress', 'dist')
const SITE_TITLE = 'Nuxt Edge Agentic RAG Docs'
const SITE_DESCRIPTION =
  '面向開發、驗證與維運的專案文件站，提供操作手冊、規則、決策紀錄與評測結果。'
const SITE_URL = process.env.DOCS_PRODUCTION_URL || 'https://agentic-docs.yudefine.com.tw'

const SECTIONS = [
  { dir: '', title: '文件首頁與總覽', match: (rel) => !rel.includes(sep) },
  { dir: 'verify', title: '驗證與部署' },
  { dir: 'runbooks', title: 'Runbooks 短手冊' },
  { dir: 'decisions', title: '架構決策紀錄' },
  { dir: 'solutions', title: 'Solutions 解法沉澱' },
  { dir: 'rules', title: '開發規則導覽' },
  { dir: 'specs', title: 'Spectra 規格導覽' },
  { dir: 'evals', title: 'LLM 評測' },
  { dir: 'sample-documents', title: '知識庫範例文件' },
]

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['.vitepress', 'dist', 'node_modules'].includes(entry.name)) continue
      files.push(...(await walk(full)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full)
    }
  }
  return files
}

function extractFrontmatter(text) {
  if (!text.startsWith('---')) return { body: text, frontmatter: {} }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { body: text, frontmatter: {} }
  const block = text.slice(3, end).trim()
  const body = text.slice(end + 4).replace(/^\n+/, '')
  const frontmatter = {}
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/)
    if (m) frontmatter[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return { body, frontmatter }
}

function extractTitleAndBlurb(rel, text) {
  const { body, frontmatter } = extractFrontmatter(text)
  let title = frontmatter.title
  let blurb = frontmatter.description || frontmatter.tagline

  if (!title) {
    const heroName = text.match(/\n\s+name:\s*(.+)/)
    if (heroName && /\bhero:\s*\n/.test(text)) {
      title = heroName[1].trim().replace(/^['"]|['"]$/g, '')
    }
  }
  if (!blurb) {
    const heroTagline = text.match(/\n\s+tagline:\s*(.+)/)
    if (heroTagline && /\bhero:\s*\n/.test(text)) {
      blurb = heroTagline[1].trim().replace(/^['"]|['"]$/g, '')
    }
  }

  const lines = body.split('\n')
  if (!title) {
    for (const line of lines) {
      const m = line.match(/^#\s+(.+?)\s*$/)
      if (m) {
        title = m[1].replace(/[`*_]/g, '').trim()
        break
      }
    }
  }
  if (!title) {
    title = rel.replace(/\.md$/, '').replace(/\\/g, '/').split('/').pop()
  }
  if (!blurb) {
    let inCode = false
    for (const raw of lines) {
      const line = raw.trim()
      if (line.startsWith('```')) {
        inCode = !inCode
        continue
      }
      if (inCode) continue
      if (!line || line.startsWith('#') || line.startsWith('---')) continue
      if (
        line.startsWith('|') ||
        line.startsWith('-') ||
        line.startsWith('*') ||
        line.startsWith('>')
      )
        continue
      blurb = line.replace(/[`*_]/g, '').slice(0, 140)
      break
    }
  }
  return { title, blurb: blurb || '' }
}

function toUrl(relPath) {
  let p = relPath.replace(/\\/g, '/').replace(/\.md$/, '')
  if (p === 'index') p = ''
  else if (p.endsWith('/index')) p = p.slice(0, -'index'.length)
  if (!p.startsWith('/')) p = '/' + p
  return SITE_URL + p
}

function classifySection(relPath) {
  const top = relPath.split(sep)[0]
  for (const s of SECTIONS) {
    if (s.dir === '' && s.match && s.match(relPath)) return s.title
    if (s.dir && top === s.dir) return s.title
  }
  return '其他文件'
}

async function main() {
  try {
    statSync(DIST_DIR)
  } catch {
    console.error(`[llms.txt] dist/ not found: ${DIST_DIR}`)
    console.error('[llms.txt] run `pnpm docs:build` first')
    process.exit(1)
  }

  const allFiles = (await walk(DOCS_DIR)).sort()
  const groups = new Map()
  const fullParts = []

  for (const file of allFiles) {
    const rel = relative(DOCS_DIR, file)
    const text = readFileSync(file, 'utf8')
    const { title, blurb } = extractTitleAndBlurb(rel, text)
    const url = toUrl(rel)
    const section = classifySection(rel)

    if (!groups.has(section)) groups.set(section, [])
    groups.get(section).push({ title, blurb, url, rel })

    const { body } = extractFrontmatter(text)
    fullParts.push(`# ${title}\n\nSource: ${url}\n\n${body.trim()}\n`)
  }

  const orderedSections = [...SECTIONS.map((s) => s.title), '其他文件'].filter((t) => groups.has(t))

  const lines = []
  lines.push(`# ${SITE_TITLE}`)
  lines.push('')
  lines.push(`> ${SITE_DESCRIPTION}`)
  lines.push('')
  lines.push(`Site: ${SITE_URL}`)
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')

  for (const section of orderedSections) {
    const items = groups.get(section)
    if (!items?.length) continue
    lines.push(`## ${section}`)
    lines.push('')
    for (const it of items.sort((a, b) => a.url.localeCompare(b.url))) {
      const desc = it.blurb ? `: ${it.blurb}` : ''
      lines.push(`- [${it.title}](${it.url})${desc}`)
    }
    lines.push('')
  }

  const llmsTxt = lines.join('\n')
  writeFileSync(join(DIST_DIR, 'llms.txt'), llmsTxt, 'utf8')

  const fullHeader = `# ${SITE_TITLE}\n\n${SITE_DESCRIPTION}\n\nSite: ${SITE_URL}\nGenerated: ${new Date().toISOString()}\n\n---\n\n`
  writeFileSync(join(DIST_DIR, 'llms-full.txt'), fullHeader + fullParts.join('\n---\n\n'), 'utf8')

  const llmsBytes = Buffer.byteLength(llmsTxt, 'utf8')
  const fullBytes = Buffer.byteLength(fullHeader + fullParts.join('\n---\n\n'), 'utf8')
  console.log(`[llms.txt] wrote ${allFiles.length} pages across ${orderedSections.length} sections`)
  console.log(`[llms.txt] llms.txt      ${llmsBytes.toLocaleString()} bytes`)
  console.log(`[llms.txt] llms-full.txt ${fullBytes.toLocaleString()} bytes`)
}

main().catch((err) => {
  console.error('[llms.txt] failed:', err)
  process.exit(1)
})
