// 🔒 LOCKED — managed by clade · Source: vendor/scripts/flow/serve.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/flow/serve.ts
// clade flow spine — localhost viewer (P2)
//
// The acceptance criterion this exists for: open a URL and see the current in-flight graph without
// asking an agent. So it is deliberately the smallest thing that can do that — `node:http`, no
// dependencies, one self-contained page, and 2s polling instead of SSE.
//
// Two hard properties, both asserted by tests:
//   1. READ-ONLY. This server NEVER writes to the spine. A viewer that can mutate the stream would
//      make the trace a record of itself.
//   2. SELF-CONTAINED. Zero external URLs — no CDN, no font host. It has to work on a machine
//      reached over tailscale with no egress, and a page that phones out is a page that breaks there.
//
// NEVER grow this into a canvas editor (n8n / Flowise shape): a graph you can draw by hand stops
// being a projection of what happened. Everything on this page is derived from events.jsonl.

import { createServer, type Server } from 'node:http'
import { basename } from 'node:path'

import { eventsPath, readEvents } from './emit.ts'
import { buildFleetSnapshot } from './fleet.ts'
import { buildWorkItems, foldSpans } from './spine.ts'
import { DEFAULT_STALL_MINUTES, findStalls } from './stall.ts'

export interface ServeOptions {
  port?: number
  host?: string
  cwd?: string
  stallMinutes?: number
  /** Read every repo on the roster instead of just this one (`flow serve --all`). */
  fleet?: boolean
  /** Where `consumers.local` lives. Only meaningful with `fleet`. */
  cladeRoot?: string
}

/** 5180: clear of review-gui (5174) and of the consumer dev-port block (3000–3110). */
export const DEFAULT_PORT = 5180

/**
 * One repo's projection.
 *
 * It carries `repos` / `unreadable` / a `repo` tag on every row even though there is exactly one
 * repo here, so that the page has ONE rendering path. Fleet mode is then a snapshot with more
 * rows, not a second page — and a second page is how two views end up disagreeing about whether
 * the same work item is in flight.
 */
export function buildSnapshot(cwd = process.cwd(), stallMinutes = DEFAULT_STALL_MINUTES) {
  const events = readEvents(cwd)
  const spans = foldSpans(events)
  const spinePath = eventsPath(cwd)
  const name = basename(cwd) || 'this repo'
  return {
    mode: 'repo' as const,
    generated_at: new Date().toISOString(),
    spine_path: spinePath,
    repos: [
      {
        name,
        path: cwd,
        spine_path: spinePath,
        state: 'ok' as const,
        events: events.length,
      },
    ],
    unreadable: [],
    events: events.length,
    work_items: buildWorkItems(spans).map((w) => ({ ...w, repo: name })),
    spans: spans.map((s) => ({ ...s, repo: name })),
    stalls: findStalls(spans, { thresholdMinutes: stallMinutes }).map((s) => ({
      ...s,
      repo: name,
    })),
  }
}

/**
 * What the endpoint serves. Fleet mode reads every repo on the roster; when the roster is absent
 * (a consumer checkout, where this file exists because it is propagated) it says so instead of
 * pretending the fleet is empty.
 */
export function buildServeSnapshot({
  cwd = process.cwd(),
  stallMinutes = DEFAULT_STALL_MINUTES,
  fleet = false,
  cladeRoot = cwd,
}: ServeOptions = {}) {
  if (!fleet) return buildSnapshot(cwd, stallMinutes)
  const snapshot = buildFleetSnapshot({ cladeRoot, stallMinutes })
  if (!snapshot) {
    return {
      ...buildSnapshot(cwd, stallMinutes),
      fleet_error: `找不到 ${cladeRoot}/consumers.local，只能看這一個 repo`,
    }
  }
  return { mode: 'fleet' as const, spine_path: snapshot.roster_path, ...snapshot }
}

export function startServer({
  port = DEFAULT_PORT,
  host = '127.0.0.1',
  cwd = process.cwd(),
  stallMinutes = DEFAULT_STALL_MINUTES,
  fleet = false,
  cladeRoot = cwd,
}: ServeOptions = {}): Promise<{ server: Server; port: number; host: string }> {
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0]
    if (req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'text/plain' })
      res.end('read-only viewer\n')
      return
    }
    if (url === '/api/spine') {
      const body = JSON.stringify(buildServeSnapshot({ cwd, stallMinutes, fleet, cladeRoot }))
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(body)
      return
    }
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(PAGE)
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found\n')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const addr = server.address()
      resolve({ server, port: typeof addr === 'object' && addr ? addr.port : port, host })
    })
  })
}

// The page is written in Traditional Chinese and in plain words on purpose. The first version
// printed the envelope's own vocabulary — `pi:invoke_agent`, `work-loop:execute_tool`, English
// outcome enums — and the reader it exists for could not read a single row of it. A viewer whose
// labels are the storage format is a debugger for whoever wrote the storage format.
//
// Everything the reader sees is translated at render time, NEVER at write time: the spine keeps
// OTel-shaped vocabulary because that is what makes it exportable, and this file is the only place
// that turns it into sentences.
const PAGE = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>clade 流程檢視</title>
<style>
  :root {
    --bg: #0f1218; --panel: #171c25; --line: #262d3a; --text: #e8ecf4; --dim: #8b97a8;
    --ok: #4ade80; --fail: #f87171; --wait: #fbbf24; --skip: #7b8798; --live: #60a5fa;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
         font: 14px/1.7 "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", ui-sans-serif, sans-serif; }
  header { padding: 14px 20px; border-bottom: 1px solid var(--line); display: flex;
           align-items: baseline; gap: 18px; flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; }
  header .meta { color: var(--dim); font-size: 12px; }
  .band { padding: 14px 20px; border-bottom: 1px solid var(--line); }
  .band h2 { font-size: 13px; margin: 0 0 8px; color: var(--dim); font-weight: 600; }
  .card { background: var(--panel); border-radius: 8px; padding: 10px 14px; margin-bottom: 8px;
          border-left: 3px solid var(--line); }
  .card.live { border-left-color: var(--live); }
  .card.wait { border-left-color: var(--wait); }
  .card .head { font-weight: 600; }
  .card .why { color: var(--dim); font-size: 12.5px; }
  .card .todo { font-size: 12.5px; margin-top: 4px; }
  main { display: grid; grid-template-columns: 320px 1fr; min-height: 50vh; }
  #list { border-right: 1px solid var(--line); overflow-y: auto; max-height: 78vh; }
  #detail { padding: 18px 22px; overflow-y: auto; max-height: 78vh; }
  .item { padding: 10px 16px; border-bottom: 1px solid var(--line); cursor: pointer; }
  .item:hover { background: var(--panel); }
  .item.sel { background: var(--panel); border-left: 3px solid var(--live); padding-left: 13px; }
  .item .t { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis;
             white-space: nowrap; }
  .item .s { color: var(--dim); font-size: 12px; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px;
         vertical-align: 1px; }
  .d-live { background: var(--live); } .d-fail { background: var(--fail); }
  .d-done { background: var(--skip); } .d-wait { background: var(--wait); }
  .fold { padding: 10px 16px; color: var(--dim); font-size: 12.5px; cursor: pointer;
          border-bottom: 1px solid var(--line); background: #12161d; }
  h3.sec { font-size: 13px; color: var(--dim); margin: 0 0 10px; font-weight: 600; }
  .graph-wrap { overflow-x: auto; background: var(--panel); border-radius: 10px; padding: 14px;
                margin-bottom: 22px; }
  .line { display: grid; grid-template-columns: 62px 20px 1fr; gap: 8px; padding: 3px 0;
          border-bottom: 1px solid rgba(255,255,255,.04); }
  .line .tm { color: var(--dim); font-variant-numeric: tabular-nums; font-size: 12.5px; }
  .line .mk { text-align: center; }
  .m-ok { color: var(--ok); } .m-fail { color: var(--fail); }
  .m-wait { color: var(--wait); } .m-skip { color: var(--skip); } .m-live { color: var(--live); }
  .empty { color: var(--dim); padding: 30px 0; }
  .repo { display: inline-block; font-size: 11px; color: var(--dim); border: 1px solid var(--line);
          border-radius: 4px; padding: 0 5px; margin-right: 6px; vertical-align: 1px; }
  .miss { color: var(--dim); font-size: 12.5px; }
  .miss b { color: var(--text); font-weight: 600; }
  .legend { color: var(--dim); font-size: 12px; padding: 10px 20px; border-top: 1px solid var(--line); }
</style>
</head>
<body>
<header>
  <h1>clade 流程檢視</h1>
  <span class="meta" id="meta">讀取中…</span>
</header>
<div class="band" id="band"></div>
<main>
  <div id="list"></div>
  <div id="detail" class="empty">左邊選一件工作</div>
</main>
<div class="legend">
  這一頁是事件流的投影，每 2 秒重讀一次。它只讀不寫，關掉它不影響任何正在跑的工作。
  看多個 repo 時，事件仍然留在各自的 repo 裡，這裡只是同時讀它們。
</div>
<script>
// ── 詞彙：脊椎存的是 OTel 形狀的英文，這裡是唯一把它翻成人話的地方 ──────────────
var WHO = {
  pi: 'Pi 派工', codex: 'Codex', herdr: 'Herdr pane', 'work-loop': 'flow 流程',
  'harness-workflow': 'Workflow 工具', 'claude-code': 'Claude Code', git: 'Git',
  ci: 'CI', manual: '人工'
};
var WHAT = {
  'work.open': '開工作項目', invoke_agent: '派 agent', invoke_workflow: '跑流程',
  execute_tool: '執行步驟', plan: '規劃', session_transport: '開 pane 交接', gate: 'gate 檢查',
  other: '其他'
};
var RESULT = { ok: '成功', fail: '失敗', blocked: '等人處理', skipped: '略過' };
var MARK = { ok: '✓', fail: '✗', blocked: '▲', skipped: '·' };
var CLS = { ok: 'ok', fail: 'fail', blocked: 'wait', skipped: 'skip' };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}
function nameOf(span) {
  var p = span.payload || {};
  var n = p.label || p.node || p.slug || p.spec;
  return typeof n === 'string' ? n : '';
}
function humanDur(ms) {
  if (ms == null) return '';
  if (ms < 1000) return '不到 1 秒';
  var s = Math.round(ms / 1000);
  if (s < 60) return s + ' 秒';
  var m = Math.floor(s / 60);
  return m + ' 分' + (s % 60 ? ' ' + (s % 60) + ' 秒' : '');
}
function sinceNow(ts) {
  var mins = Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 60000));
  if (mins < 60) return '已 ' + mins + ' 分鐘';
  return '已 ' + (mins / 60).toFixed(1) + ' 小時';
}
function clock(ts) { return ts ? String(ts).slice(11, 16) : ''; }

/** 一個 span 的一句話。這裡是全頁唯一組句子的地方。 */
function sentence(span) {
  var who = WHO[span.substrate] || span.substrate;
  var what = WHAT[span.kind] || span.kind;
  var name = nameOf(span);
  var p = span.payload || {};
  var subject = who;
  if (span.substrate === 'pi' || span.substrate === 'codex') {
    if (p.model) subject = who + ' ' + p.model;
  }
  var head;
  if (span.kind === 'work.open') head = '開了工作項目' + (name ? '「' + name + '」' : '');
  else if (span.kind === 'session_transport' && p.transport_event === 'reclaim')
    head = subject + '：收回 pane' + (name ? '「' + name + '」' : '');
  else head = subject + '：' + what + (name ? '「' + name + '」' : '');
  var tail;
  if (!span.end_ts) tail = '進行中，' + sinceNow(span.start_ts);
  else if (span.is_point) tail = '';
  else tail = (RESULT[span.outcome] || span.outcome || '結束') +
    (span.duration_ms != null ? '，' + humanDur(span.duration_ms) : '');
  return tail ? head + ' — ' + tail : head;
}

function markOf(span) {
  if (!span.end_ts) return { m: '●', c: 'm-live' };
  return { m: MARK[span.outcome] || '·', c: 'm-' + (CLS[span.outcome] || 'skip') };
}

// ── 視覺化流程圖：node = 步驟，edge = 誰起了誰（parent_span）。 ──────────────────
// 邊完全來自事件本身，頁面沒有任何地方可以宣告一條關係，所以畫不出沒發生過的連線。
function drawGraph(spans) {
  var byId = {}, children = {}, roots = [];
  spans.forEach(function (s) { byId[s.span_id] = s; children[s.span_id] = []; });
  spans.forEach(function (s) {
    if (s.parent_span && children[s.parent_span]) children[s.parent_span].push(s);
    else roots.push(s);
  });

  var BOX_W = 250, BOX_H = 46, GAP_X = 46, GAP_Y = 12;
  var placed = [], row = 0;
  (function walk(list, depth) {
    list.forEach(function (s) {
      placed.push({ s: s, x: depth * (BOX_W + GAP_X), y: row * (BOX_H + GAP_Y), id: s.span_id });
      row += 1;
      walk(children[s.span_id] || [], depth + 1);
    });
  })(roots, 0);
  if (!placed.length) return '';

  var pos = {};
  placed.forEach(function (n) { pos[n.id] = n; });
  var w = Math.max.apply(null, placed.map(function (n) { return n.x + BOX_W; })) + 10;
  var h = Math.max.apply(null, placed.map(function (n) { return n.y + BOX_H; })) + 10;

  var edges = placed.map(function (n) {
    var p = n.s.parent_span && pos[n.s.parent_span];
    if (!p) return '';
    var x1 = p.x + BOX_W, y1 = p.y + BOX_H / 2, x2 = n.x, y2 = n.y + BOX_H / 2;
    var mid = x1 + (x2 - x1) / 2;
    return '<path d="M' + x1 + ' ' + y1 + ' C' + mid + ' ' + y1 + ' ' + mid + ' ' + y2 +
      ' ' + x2 + ' ' + y2 + '" fill="none" stroke="#3a4557" stroke-width="1.5"/>';
  }).join('');

  var COLOR = { ok: '#4ade80', fail: '#f87171', blocked: '#fbbf24', skipped: '#7b8798' };
  var boxes = placed.map(function (n) {
    var s = n.s;
    var live = !s.end_ts;
    var stroke = live ? '#60a5fa' : (COLOR[s.outcome] || '#7b8798');
    var name = nameOf(s) || (WHAT[s.kind] || s.kind);
    var sub = (WHO[s.substrate] || s.substrate) + ' · ' +
      (live ? '進行中' : (RESULT[s.outcome] || '') + ' ' + humanDur(s.duration_ms));
    return '<g transform="translate(' + n.x + ',' + n.y + ')">' +
      '<rect width="' + BOX_W + '" height="' + BOX_H + '" rx="7" fill="#1c222d" stroke="' +
      stroke + '" stroke-width="' + (live ? 2 : 1.4) + '"' +
      (live ? ' stroke-dasharray="6 4"' : '') + '/>' +
      '<text x="12" y="19" fill="#e8ecf4" font-size="13" font-weight="600">' +
      esc(name.length > 26 ? name.slice(0, 25) + '…' : name) + '</text>' +
      '<text x="12" y="35" fill="#8b97a8" font-size="11.5">' + esc(sub) + '</text>' +
      '</g>';
  }).join('');

  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h +
    '" role="img" aria-label="流程圖">' + edges + boxes + '</svg>';
}

// ── 狀態 ────────────────────────────────────────────────────────────────────────
var selected = null, snapshot = null, showFolded = false;

/**
 * 摺疊判準是結構性的，不是「猜哪些是測試」：沒人跑過 flow open 的工作項目 id 是自動鑄的
 * （orphan-），而且它已經結束了。進行中或卡住的東西永遠不摺疊，不論有沒有名字。
 */
function isFolded(w) {
  return !w.slug && w.state !== 'in-flight' && !stalledIds()[keyOf(w)];
}
var _stalled = null;
function stalledIds() {
  if (_stalled) return _stalled;
  _stalled = {};
  (snapshot.stalls || []).forEach(function (s) { _stalled[keyOf(s)] = true; });
  return _stalled;
}

/**
 * 工作項目的身分是 repo ＋ work_id，不是 work_id。
 * 每一家收到上一次散播的 consumer 都有一個 W-<date>-propagate —— 只用 work_id 當鍵，
 * 十幾家不相干的工作會在畫面上疊成一件。
 */
function keyOf(x) { return x.repo + '//' + x.work_id; }
function multiRepo() { return (snapshot.repos || []).length > 1; }
function repoTag(x) {
  return multiRepo() && x.repo ? '<span class="repo">' + esc(x.repo) + '</span>' : '';
}

function spansOf(key) {
  return snapshot.spans.filter(function (s) { return keyOf(s) === key; });
}

function titleOf(w) {
  if (w.slug) return w.slug;
  var spans = spansOf(keyOf(w));
  var named = spans.map(nameOf).filter(Boolean)[0];
  if (named) return named + '（未命名工作）';
  return '未命名工作';
}

function summaryOf(w) {
  if (w.state === 'in-flight') return '進行中，共 ' + w.spans + ' 步';
  if (w.failed) return '已結束，' + w.spans + ' 步裡有 ' + w.failed + ' 步失敗';
  return '已結束，共 ' + w.spans + ' 步，全部順利';
}

function renderBand() {
  var live = snapshot.work_items.filter(function (w) { return w.state === 'in-flight'; });
  var stalls = snapshot.stalls || [];
  var html = '';

  html += '<h2>現在在跑（' + live.length + '）</h2>';
  if (!live.length) html += '<div class="why" style="color:var(--dim)">目前沒有正在跑的工作。</div>';
  live.forEach(function (w) {
    var open = spansOf(keyOf(w)).filter(function (s) { return !s.end_ts; });
    var one = open[open.length - 1];
    html += '<div class="card live"><div class="head">' + repoTag(w) + esc(titleOf(w)) + '</div>' +
      '<div class="why">' + esc(one ? sentence(one) : summaryOf(w)) + '</div></div>';
  });

  html += '<h2 style="margin-top:14px">卡住了（' + stalls.length + '）</h2>';
  if (!stalls.length) html += '<div class="why" style="color:var(--dim)">沒有卡住的工作。</div>';
  stalls.slice(0, 8).forEach(function (s) {
    var why = s.shape === 'unharvested' ? '有人回報完成了，但沒人把 pane 收回來'
      : s.shape === 'in-flight-overdue' ? '開始之後就再也沒有下文'
      : '失敗或停下來之後，這件工作沒有再跑任何一步';
    html += '<div class="card wait"><div class="head">' + repoTag(s) +
      esc((WHO[s.substrate] || s.substrate) + (s.label ? '「' + s.label + '」' : '')) +
      ' — 停了 ' + (s.age_minutes / 60).toFixed(1) + ' 小時</div>' +
      '<div class="why">' + esc(why) + '</div>' +
      '<div class="todo">該做的事：' + esc(s.action) + '</div></div>';
  });
  if (stalls.length > 8) {
    html += '<div class="why">另外還有 ' + (stalls.length - 8) + ' 件，在左邊清單裡。</div>';
  }

  // 讀不到的 repo 一定要逐家列名。少了三家卻看起來完整的 fleet 視圖，比沒有視圖更危險。
  var miss = snapshot.unreadable || [];
  if (snapshot.fleet_error) {
    html += '<h2 style="margin-top:14px">讀不到的 repo</h2><div class="miss">' +
      esc(snapshot.fleet_error) + '</div>';
  } else if (multiRepo() || miss.length) {
    html += '<h2 style="margin-top:14px">讀不到的 repo（' + miss.length + '）</h2>';
    if (!miss.length) html += '<div class="miss">全部 ' + snapshot.repos.length + ' 家都讀到了。</div>';
    miss.forEach(function (r) {
      html += '<div class="miss"><b>' + esc(r.name) + '</b> — ' + esc(r.why) + '</div>';
    });
  }
  document.getElementById('band').innerHTML = html;
}

function renderList() {
  var order = { 'in-flight': 0, failed: 1, settled: 2 };
  var items = snapshot.work_items.slice().sort(function (a, b) {
    return (order[a.state] - order[b.state]) || b.last_ts.localeCompare(a.last_ts);
  });
  var shown = items.filter(function (w) { return !isFolded(w); });
  var folded = items.filter(isFolded);
  var st = stalledIds();

  var html = shown.map(function (w) {
    var cls = w.state === 'in-flight' ? 'd-live' : st[keyOf(w)] ? 'd-wait'
      : w.failed ? 'd-fail' : 'd-done';
    return '<div class="item' + (keyOf(w) === selected ? ' sel' : '') + '" data-id="' +
      esc(keyOf(w)) + '"><span class="t"><span class="dot ' + cls + '"></span>' +
      esc(titleOf(w)) + '</span><span class="s">' + repoTag(w) + esc(summaryOf(w)) + '　' +
      clock(w.last_ts) + '</span></div>';
  }).join('');

  if (folded.length) {
    html += '<div class="fold" id="foldbtn">' + (showFolded ? '▾' : '▸') +
      ' 未命名而且已經結束的零散紀錄（' + folded.length + ' 筆）</div>';
    if (showFolded) {
      html += folded.map(function (w) {
        return '<div class="item' + (keyOf(w) === selected ? ' sel' : '') + '" data-id="' +
          esc(keyOf(w)) + '"><span class="t"><span class="dot d-done"></span>' +
          esc(titleOf(w)) + '</span><span class="s">' + repoTag(w) + esc(summaryOf(w)) + '　' +
          clock(w.last_ts) + '</span></div>';
      }).join('');
    }
  }

  var el = document.getElementById('list');
  el.innerHTML = html;
  var btn = document.getElementById('foldbtn');
  if (btn) btn.addEventListener('click', function () { showFolded = !showFolded; renderList(); });
  Array.prototype.forEach.call(el.querySelectorAll('.item'), function (node) {
    node.addEventListener('click', function () {
      selected = node.dataset.id;
      renderList();
      renderDetail();
    });
  });
}

function renderDetail() {
  var el = document.getElementById('detail');
  if (!selected) { el.className = 'empty'; el.textContent = '左邊選一件工作'; return; }
  el.className = '';
  var spans = spansOf(selected);
  if (!spans.length) { el.textContent = '這件工作沒有任何紀錄。'; return; }

  var html = '<h3 class="sec">流程圖　（框＝一個步驟，線＝誰起了誰；虛線框＝還在跑）</h3>' +
    '<div class="graph-wrap">' + drawGraph(spans) + '</div>' +
    '<h3 class="sec">依時間發生了什麼</h3>';
  spans.forEach(function (s) {
    var mk = markOf(s);
    html += '<div class="line"><span class="tm">' + clock(s.start_ts) + '</span>' +
      '<span class="mk ' + mk.c + '">' + mk.m + '</span>' +
      '<span>' + esc(sentence(s)) + '</span></div>';
  });
  el.innerHTML = html;
}

function tick() {
  fetch('/api/spine').then(function (r) { return r.json(); }).then(function (j) {
    snapshot = j;
    _stalled = null;
    var live = j.work_items.filter(function (w) { return w.state === 'in-flight'; }).length;
    var repos = j.repos || [];
    var readable = repos.filter(function (r) { return r.state === 'ok'; }).length;
    var scope = repos.length > 1 ? '涵蓋 ' + readable + '/' + repos.length + ' 個 repo　' : '';
    document.getElementById('meta').textContent =
      scope + j.events + ' 筆事件　現在在跑 ' + live + ' 件　卡住 ' + j.stalls.length +
      ' 件　共 ' + j.work_items.length + ' 件工作';
    if (!selected) {
      var first = j.work_items.filter(function (w) { return w.state === 'in-flight'; });
      if (first.length) selected = keyOf(first[first.length - 1]);
    }
    renderBand();
    renderList();
    renderDetail();
  }).catch(function (err) {
    document.getElementById('meta').textContent = '讀不到事件檔：' + err;
  });
}
tick();
setInterval(tick, 2000);
</script>
</body>
</html>
`
