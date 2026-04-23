#!/usr/bin/env python3
"""
clone_insert_docx.py — 以 donor 段落整段複製 + 文字替換的方式，把 Markdown
內容套入既有 DOCX，保留所有 v11 格式（pPr, rPr, run 結構、表格樣式）。

設計原則
  1. 不憑空建構 <w:r>/<w:rPr>；只用既有段落做 donor，deepcopy 後取代文字。
  2. 替換文字時只改 <w:t>（第一個填滿、其他清空），不動 pPr/rPr/numPr。
  3. 對 sectPr 之前做 append；對既有章節先刪除再重建。
  4. 不處理 Markdown inline 格式（bold/italic/inline code）——若需保留粗體
     請改走 /docx-surgery 的手動 run 插入流程。

適用情境
  - MD 與 DOCX 結構已漂移、sync_docx_content 出現大量 MISSING。
  - DOCX 須保留所有 run-level 格式（字體、字號、間距、首行縮排）。
  - TOC sdt 已損壞或要改成佔位，讓使用者在 Word 重新插入目錄。

使用
    原腳本以 reports/archive/main-v0.0.11.docx 為 donor base，
    reports/archive/main-v0.0.37.md 為內容來源。若要套用到其他
  專題版號，請調整 main() 內部的 DOC_XML、MD_SOURCE、donor 段落索引。

  一般流程：
    python tooling/scripts/office/unpack.py <CURRENT_DOCX> /tmp/docx-edit/ --force
    python tooling/scripts/clone_insert_docx.py
    python tooling/scripts/office/pack.py /tmp/docx-edit/ <OUTPUT_DOCX> \
         --original <CURRENT_DOCX>
    python tooling/scripts/extract_docx_to_md.py <OUTPUT_DOCX> -o /tmp/verify/
"""

import re
import sys
from copy import deepcopy
from pathlib import Path
from xml.etree import ElementTree as ET
from markdown_it import MarkdownIt

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"
NS14 = "{http://schemas.microsoft.com/office/word/2010/wordml}"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"

ET.register_namespace("w", W_NS)
ET.register_namespace("w14", "http://schemas.microsoft.com/office/word/2010/wordml")

DOC_XML = "/tmp/docx-edit-v36/word/document.xml"
REPO_ROOT = Path(__file__).resolve().parents[2]
MD_SOURCE = REPO_ROOT / "reports" / "archive" / "main-v0.0.37.md"


# ---------------------------------------------------------------------------
# XML helpers (non-invasive)
# ---------------------------------------------------------------------------

def strip_w14_ids(elem):
    for sub in elem.iter():
        for attr in list(sub.attrib):
            if attr.startswith(NS14):
                del sub.attrib[attr]


def strip_bookmarks_shallow(p):
    """Remove bookmarks directly on <w:p>; bookmark IDs conflict if cloned."""
    for child in list(p):
        if child.tag in (f"{W}bookmarkStart", f"{W}bookmarkEnd", f"{W}proofErr"):
            p.remove(child)


def replace_p_text(p, text):
    """Clear all <w:t> inside p, put text in first <w:t>. Do not touch pPr or rPr."""
    t_nodes = [t for t in p.iter(f"{W}t")]
    if not t_nodes:
        # Paragraph has no text node — donor must still have a run we can use
        runs = p.findall(f"{W}r")
        if runs:
            new_t = ET.SubElement(runs[0], f"{W}t")
            new_t.text = text
            new_t.set(XML_SPACE, "preserve")
        return
    for t in t_nodes:
        t.text = ""
    t_nodes[0].text = text
    t_nodes[0].set(XML_SPACE, "preserve")


def clone_paragraph(src_p, text):
    """Deep copy a source paragraph as-is, replace its text."""
    p = deepcopy(src_p)
    strip_w14_ids(p)
    strip_bookmarks_shallow(p)
    replace_p_text(p, text)
    return p


def clone_table_expand_cols(src_tbl, target_cols, rows):
    """Copy an existing table and widen it to target_cols while keeping tblGrid/cell widths
    internally consistent so Word does not flag the table properties.

    - Widths: take donor's gridTotal (sum of existing <w:gridCol>), split evenly across
      target_cols.
    - Columns: rewrite <w:tblGrid> with target_cols entries; for every <w:tr>, clone the
      last <w:tc> until cell count == target_cols, and normalise each <w:tcW> to the new
      width. Never touch tblPr, borders, or paragraph-level properties.
    - Then delegate to the row-resize + text-fill path.
    """
    tbl = deepcopy(src_tbl)
    strip_w14_ids(tbl)
    for bm_tag in (f"{W}bookmarkStart", f"{W}bookmarkEnd"):
        for bm in tbl.findall(f".//{bm_tag}"):
            parent = find_parent(tbl, bm)
            if parent is not None:
                parent.remove(bm)

    grid = tbl.find(f"{W}tblGrid")
    if grid is None:
        return tbl  # malformed donor; give up silently

    existing_cols = grid.findall(f"{W}gridCol")
    total_width = sum(int(c.get(f"{W}w", "0")) for c in existing_cols) or 8785
    new_width = max(total_width // target_cols, 400)

    # Rewrite tblGrid
    for c in existing_cols:
        grid.remove(c)
    for _ in range(target_cols):
        g = ET.SubElement(grid, f"{W}gridCol")
        g.set(f"{W}w", str(new_width))

    # Resize cells per row and normalise widths
    for tr in tbl.findall(f"{W}tr"):
        tc_list = tr.findall(f"{W}tc")
        while len(tc_list) < target_cols:
            new_tc = deepcopy(tc_list[-1])
            for t in new_tc.iter(f"{W}t"):
                t.text = ""
            tr.append(new_tc)
            tc_list = tr.findall(f"{W}tc")
        while len(tc_list) > target_cols:
            tr.remove(tc_list[-1])
            tc_list = tr.findall(f"{W}tc")
        # Normalise each tcW so the row total matches the new tblGrid
        for tc in tc_list:
            tcPr = tc.find(f"{W}tcPr")
            if tcPr is None:
                tcPr = ET.SubElement(tc, f"{W}tcPr")
                tc.insert(0, tcPr)
            tcW = tcPr.find(f"{W}tcW")
            if tcW is None:
                tcW = ET.SubElement(tcPr, f"{W}tcW")
            tcW.set(f"{W}w", str(new_width))
            tcW.set(f"{W}type", "dxa")
            # Strip any gridSpan that would confuse the new grid
            gs = tcPr.find(f"{W}gridSpan")
            if gs is not None:
                tcPr.remove(gs)

    return _resize_rows_and_fill(tbl, rows, target_cols)


def _resize_rows_and_fill(tbl, rows, template_cols):
    tr_list = tbl.findall(f"{W}tr")
    if not tr_list:
        return tbl
    target_rows = len(rows)
    while len(tr_list) > target_rows and len(tr_list) > 1:
        tbl.remove(tr_list[-1])
        tr_list = tbl.findall(f"{W}tr")
    if target_rows > len(tr_list):
        stencil = deepcopy(tr_list[-1])
        for t in stencil.iter(f"{W}t"):
            t.text = ""
        while len(tr_list) < target_rows:
            tbl.append(deepcopy(stencil))
            tr_list = tbl.findall(f"{W}tr")
    for r_idx, row_cells in enumerate(rows):
        tc_list = tr_list[r_idx].findall(f"{W}tc")
        if not tc_list:
            continue
        adj = list(row_cells)
        if len(adj) < template_cols:
            adj += [""] * (template_cols - len(adj))
        elif len(adj) > template_cols:
            extras = adj[template_cols - 1 :]
            adj = adj[: template_cols - 1] + [" | ".join(e for e in extras if e)]
        for c_idx, cell_text in enumerate(adj):
            if c_idx >= len(tc_list):
                break
            tc = tc_list[c_idx]
            ps = tc.findall(f"{W}p")
            if not ps:
                continue
            for extra in ps[1:]:
                tc.remove(extra)
            replace_p_text(ps[0], cell_text)
    return tbl


def clone_table_same_cols(src_tbl, rows):
    """Clone table, preserve <w:tblPr> / <w:tblGrid> and per-cell widths intact.
    Only resize ROWS (duplicate last data row / drop trailing rows) and replace cell text.
    Caller must guarantee src_tbl column count matches len(row_cells) for rows; any
    row with more/fewer cells is padded/truncated in-place without touching XML structure.
    """
    tbl = deepcopy(src_tbl)
    strip_w14_ids(tbl)
    # Remove bookmarks anywhere in table
    for bm_tag in (f"{W}bookmarkStart", f"{W}bookmarkEnd"):
        for bm in tbl.findall(f".//{bm_tag}"):
            parent = find_parent(tbl, bm)
            if parent is not None:
                parent.remove(bm)

    tr_list = tbl.findall(f"{W}tr")
    if not tr_list:
        return tbl
    template_cols = len(tr_list[0].findall(f"{W}tc"))
    return _resize_rows_and_fill(tbl, rows, template_cols)


def find_parent(root, target):
    for parent in root.iter():
        for child in parent:
            if child is target:
                return parent
    return None


# ---------------------------------------------------------------------------
# Markdown parsing — emit text only (no inline format segments)
# ---------------------------------------------------------------------------

def inline_text(tok):
    parts = []
    for child in tok.children or []:
        if child.type in ("text", "code_inline"):
            parts.append(child.content)
        elif child.type in ("softbreak", "hardbreak"):
            parts.append(" ")
    return "".join(parts).strip()


def parse_md_blocks(path):
    md = MarkdownIt("commonmark", {"html": True}).enable("table")
    tokens = md.parse(open(path, encoding="utf-8").read())

    blocks = []
    started = [False]

    def consume_list(i, depth, ordered):
        close = "ordered_list_close" if ordered else "bullet_list_close"
        item_num = 1
        while i < len(tokens) and tokens[i].type != close:
            if tokens[i].type == "list_item_open":
                i += 1
                parts = []
                while i < len(tokens) and tokens[i].type != "list_item_close":
                    tt = tokens[i].type
                    if tt == "paragraph_open":
                        parts.append(inline_text(tokens[i + 1]))
                        i += 3
                        continue
                    if tt in ("bullet_list_open", "ordered_list_open"):
                        sub_ordered = tt == "ordered_list_open"
                        item_text = " ".join(p for p in parts if p).strip()
                        if item_text:
                            prefix = f"{item_num}. " if ordered else ""
                            blocks.append({
                                "type": "list_item",
                                "ordered": ordered,
                                "depth": depth,
                                "text": prefix + item_text,
                            })
                            if ordered:
                                item_num += 1
                            parts = []
                        i = consume_list(i + 1, depth + 1, sub_ordered)
                        continue
                    if tt == "inline":
                        parts.append(inline_text(tokens[i]))
                    i += 1
                item_text = " ".join(p for p in parts if p).strip()
                if item_text:
                    prefix = f"{item_num}. " if ordered else ""
                    blocks.append({
                        "type": "list_item",
                        "ordered": ordered,
                        "depth": depth,
                        "text": prefix + item_text,
                    })
                    if ordered:
                        item_num += 1
            i += 1
        return i + 1

    i = 0
    while i < len(tokens):
        tok = tokens[i]

        if tok.type == "heading_open":
            level = int(tok.tag[1])
            text = inline_text(tokens[i + 1])
            if not started[0] and text == "中文摘要":
                started[0] = True
            if started[0]:
                blocks.append({"type": "heading", "level": level, "text": text})
            i += 3
            continue

        if not started[0]:
            i += 1
            continue

        if tok.type == "paragraph_open":
            text = inline_text(tokens[i + 1])
            if text:
                blocks.append({"type": "paragraph", "text": text})
            i += 3
            continue

        if tok.type in ("bullet_list_open", "ordered_list_open"):
            ordered = tok.type == "ordered_list_open"
            i = consume_list(i + 1, depth=0, ordered=ordered)
            continue

        if tok.type == "fence":
            blocks.append({"type": "code", "text": tok.content.rstrip()})
            i += 1
            continue

        if tok.type == "table_open":
            rows = []
            i += 1
            while i < len(tokens) and tokens[i].type != "table_close":
                if tokens[i].type == "tr_open":
                    i += 1
                    cells = []
                    while i < len(tokens) and tokens[i].type != "tr_close":
                        if tokens[i].type in ("th_open", "td_open"):
                            i += 1
                            cell_text = ""
                            if i < len(tokens) and tokens[i].type == "inline":
                                cell_text = inline_text(tokens[i])
                                i += 1
                            while i < len(tokens) and tokens[i].type not in ("th_close", "td_close"):
                                i += 1
                            cells.append(cell_text)
                        i += 1
                    rows.append(cells)
                i += 1
            if rows:
                blocks.append({"type": "table", "rows": rows})
            i += 1
            continue

        if tok.type == "blockquote_open":
            i += 1
            qparts = []
            while i < len(tokens) and tokens[i].type != "blockquote_close":
                if tokens[i].type == "paragraph_open":
                    qparts.append(inline_text(tokens[i + 1]))
                    i += 3
                    continue
                i += 1
            if qparts:
                blocks.append({"type": "paragraph", "text": " ".join(qparts)})
            i += 1
            continue

        if tok.type == "hr":
            blocks.append({"type": "hr"})
            i += 1
            continue

        i += 1

    return blocks


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    tree = ET.parse(DOC_XML)
    root = tree.getroot()
    body = root.find(f"{W}body")

    all_paras = body.findall(f"{W}p")
    all_tables = body.findall(f"{W}tbl")

    # Pick donor paragraphs — REAL v11 paragraphs, no cleaning
    DONOR_H1 = all_paras[35]       # "開發計畫"
    DONOR_H2 = all_paras[38]       # "發展的動機"
    DONOR_H3 = all_paras[41]       # "1.1.1 中小企業 ERP 使用的痛點"
    DONOR_H4 = all_paras[199]      # "2.3.1.1 ..."
    DONOR_AF3 = all_paras[21]      # "中文摘要" (af3 style)
    DONOR_BODY = all_paras[22]     # abstract body paragraph
    # NOTE: v11 的 a3/numId=23 donor lvlText 是 "(%1)"，會被 Word 自動加上 (1)(2)(3)…，
    # 不符合編排規範（只有「各點」層級才用括號編號）。故不再使用 bullet donor，全部
    # 改以 BODY 段落 + 文字前綴方式呈現列點，避免 numPr 自動編號。
    DONOR_EMPTY = all_paras[42]    # empty paragraph

    # Table donors grouped by column count — keep every table, sorted by row count
    donor_tables_by_cols: dict[int, list] = {}
    for t in all_tables:
        tr_all = t.findall(f"{W}tr")
        if not tr_all:
            continue
        n_cols = len(tr_all[0].findall(f"{W}tc"))
        donor_tables_by_cols.setdefault(n_cols, []).append((len(tr_all), t))

    def pick_same_col_donor(n_cols, n_rows):
        """Return donor with matching column count, prefer row count >= n_rows."""
        candidates = donor_tables_by_cols.get(n_cols)
        if not candidates:
            return None
        exact = [t for r, t in candidates if r == n_rows]
        if exact:
            return exact[0]
        ge = sorted([(r, t) for r, t in candidates if r >= n_rows], key=lambda x: x[0])
        if ge:
            return ge[0][1]
        return sorted(candidates, key=lambda x: x[0], reverse=True)[0][1]

    def pick_expansion_donor():
        """Pick the donor table with the most columns to minimise expansion distortion."""
        max_cols = max(donor_tables_by_cols.keys())
        return sorted(donor_tables_by_cols[max_cols], key=lambda x: x[0], reverse=True)[0][1]

    md_blocks = parse_md_blocks(MD_SOURCE)
    print(f"Parsed {len(md_blocks)} md blocks", file=sys.stderr)

    # Partition blocks
    abstract_paras = []
    symbol_table_rows = None
    toc_placeholder = None
    figure_paragraphs: list[str] = []
    chapter_blocks = []

    section = None
    for b in md_blocks:
        if b["type"] == "heading" and b["level"] == 1:
            section = b["text"]
            if section in ("中文摘要", "目錄", "符號索引", "圖表目錄", "圖表索引"):
                continue
            chapter_blocks.append(b)
            continue
        if section == "中文摘要":
            if b["type"] == "paragraph":
                abstract_paras.append(b["text"])
            continue
        if section == "目錄":
            if b["type"] == "paragraph":
                toc_placeholder = b["text"]
            continue
        if section == "符號索引":
            if b["type"] == "table":
                symbol_table_rows = b["rows"]
            continue
        if section in ("圖表目錄", "圖表索引"):
            if b["type"] == "paragraph":
                figure_paragraphs.append(b["text"])
            continue
        chapter_blocks.append(b)

    # --- Phase 0: Cover date (paragraph 20) ---
    replace_p_text(all_paras[20], "中華民國 115 年　月　日")

    # --- Phase 1: Abstract body (in-place replace into existing paragraphs) ---
    abs_slots = [all_paras[22], all_paras[23], all_paras[24], all_paras[25]]
    kw_slot = all_paras[27]

    # Separate keyword paragraph from body paragraphs
    body_texts = [p for p in abstract_paras if not p.startswith("關鍵字")]
    kw_text = next((p for p in abstract_paras if p.startswith("關鍵字")), "")

    # Fit v36 body into 4 slots
    if len(body_texts) > 4:
        body_texts = body_texts[:3] + [" ".join(body_texts[3:])]
    while len(body_texts) < 4:
        body_texts.append("")

    for slot, text in zip(abs_slots, body_texts):
        replace_p_text(slot, text)

    if kw_text:
        replace_p_text(kw_slot, kw_text)

    # --- Phase 2: Replace TOC sdt with placeholder paragraph ---
    sdt = next((c for c in list(body) if c.tag == f"{W}sdt"), None)
    if sdt is not None and toc_placeholder:
        idx = list(body).index(sdt)
        body.remove(sdt)
        body.insert(idx, clone_paragraph(DONOR_BODY, toc_placeholder))

    # --- Phase 3: Symbol index table (replace in place with same-col donor) ---
    if symbol_table_rows:
        symbol_tbl = all_tables[0]
        n_cols = len(symbol_tbl.find(f"{W}tr").findall(f"{W}tc"))
        # v36 symbol index has 3 cols, v11 symbol table has 3 cols — donor is self
        new_tbl = clone_table_same_cols(symbol_tbl, symbol_table_rows)
        idx = list(body).index(symbol_tbl)
        body.remove(symbol_tbl)
        body.insert(idx, new_tbl)

    # --- Phase 4: Rename 圖表索引 → 圖表目錄, set first placeholder line ---
    replace_p_text(all_paras[33], "圖表目錄")
    if figure_paragraphs:
        replace_p_text(all_paras[34], figure_paragraphs[0])

    # --- Phase 5: Clear everything after 圖表目錄 placeholder and before sectPr ---
    sectPr = body.find(f"{W}sectPr")
    snap = list(body)
    start_idx = snap.index(all_paras[34]) + 1
    end_idx = snap.index(sectPr)
    for el in snap[start_idx:end_idx]:
        body.remove(el)

    # --- Phase 5b: Insert the remaining figure-index paragraphs right after placeholder ---
    if len(figure_paragraphs) > 1:
        anchor_idx = list(body).index(all_paras[34])
        for j, text in enumerate(figure_paragraphs[1:], start=1):
            body.insert(anchor_idx + j, clone_paragraph(DONOR_BODY, text))

    # --- Phase 6: Emit chapter content by cloning donors ---
    def append_before_sectPr(elem):
        sect = body.find(f"{W}sectPr")
        idx = list(body).index(sect)
        body.insert(idx, elem)

    for b in chapter_blocks:
        btype = b["type"]

        if btype == "heading":
            level = b["level"]
            text = b["text"]
            donor = {1: DONOR_H1, 2: DONOR_H2, 3: DONOR_H3, 4: DONOR_H4}.get(level, DONOR_BODY)
            append_before_sectPr(clone_paragraph(donor, text))
            continue

        if btype == "paragraph":
            append_before_sectPr(clone_paragraph(DONOR_BODY, b["text"]))
            continue

        if btype == "list_item":
            depth = b.get("depth", 0)
            ordered = b.get("ordered", False)
            indent = "　" * depth
            raw = b["text"]
            # Ordered list 的 "1. " 前綴已經在 parser 預先加好；bullet 項目則補 "‧ "
            # 當作視覺標記。一律走 BODY donor，避免 numPr 自動編號。
            if ordered:
                text = indent + raw
            else:
                text = indent + "‧ " + raw
            append_before_sectPr(clone_paragraph(DONOR_BODY, text))
            continue

        if btype == "code":
            for line in b["text"].splitlines():
                append_before_sectPr(clone_paragraph(DONOR_BODY, line if line else " "))
            continue

        if btype == "table":
            rows = b["rows"]
            if not rows:
                continue
            n_cols = max(len(r) for r in rows)
            n_rows = len(rows)
            donor_tbl = pick_same_col_donor(n_cols, n_rows)
            if donor_tbl is not None:
                append_before_sectPr(clone_table_same_cols(donor_tbl, rows))
            else:
                # Col count out of donor range — expand grid on top of a same-style donor.
                donor_tbl = pick_expansion_donor()
                append_before_sectPr(clone_table_expand_cols(donor_tbl, n_cols, rows))
            continue

        if btype == "hr":
            append_before_sectPr(clone_paragraph(DONOR_EMPTY, ""))
            continue

    tree.write(DOC_XML, encoding="UTF-8", xml_declaration=True, default_namespace=None)
    print("Done", file=sys.stderr)


if __name__ == "__main__":
    main()
