#!/usr/bin/env python3
"""
Transform /tmp/docx-edit-v36/word/document.xml body to v36.md content
while preserving every v11 format detail.

Strategy:
- Keep cover (body children 0-20) as-is.
- Replace abstract body paragraphs with v36 abstract.
- Keep 目錄 heading + TOC sdt intact.
- Rebuild 符號索引 table with v36 content.
- Update 圖表索引→圖表目錄 per v36.
- Strip all chapter body children (37..end, except sectPr).
- Rebuild chapters from v36.md, cloning v11 paragraph/table templates.
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
REPO_ROOT = Path(__file__).resolve().parents[3]
MD_SOURCE = REPO_ROOT / "reports" / "archive" / "main-v0.0.36.md"


# ---------------------------------------------------------------------------
# XML helpers
# ---------------------------------------------------------------------------

def strip_w14_ids(elem):
    """Remove w14:paraId/textId to avoid duplicate ids after cloning."""
    for attr in list(elem.attrib):
        if attr.startswith(NS14):
            del elem.attrib[attr]
    for sub in elem.iter():
        for attr in list(sub.attrib):
            if attr.startswith(NS14):
                del sub.attrib[attr]


def strip_rsid(elem):
    for sub in elem.iter():
        for attr in list(sub.attrib):
            if attr.startswith(W) and "rsid" in attr.lower():
                del sub.attrib[attr]


def strip_bookmarks(elem):
    for child in list(elem):
        tag = child.tag
        if tag in (f"{W}bookmarkStart", f"{W}bookmarkEnd", f"{W}proofErr"):
            elem.remove(child)


def strip_all_runs(p):
    for r in list(p):
        if r.tag in (f"{W}r", f"{W}ins", f"{W}del", f"{W}hyperlink"):
            p.remove(r)


def clone_clean_p(p):
    """Deep copy paragraph, strip runs + bookmarks + w14 ids, keep pPr untouched."""
    clone = deepcopy(p)
    strip_bookmarks(clone)
    strip_all_runs(clone)
    strip_w14_ids(clone)
    return clone


def set_p_text(p, text, default_rPr=None):
    """Clear runs in <w:p> and set a single clean run with given text."""
    strip_bookmarks(p)
    strip_all_runs(p)
    r = ET.SubElement(p, f"{W}r")
    if default_rPr is not None:
        r.append(deepcopy(default_rPr))
    t = ET.SubElement(r, f"{W}t")
    t.text = text
    t.set(XML_SPACE, "preserve")


def set_p_segments(p, segments, default_rPr=None):
    """Clear runs and emit one <w:r> per segment with rPr flags applied."""
    strip_bookmarks(p)
    strip_all_runs(p)
    if not segments:
        # Emit an empty run so paragraph has something
        r = ET.SubElement(p, f"{W}r")
        if default_rPr is not None:
            r.append(deepcopy(default_rPr))
        t = ET.SubElement(r, f"{W}t")
        t.text = ""
        return
    for text, flags in segments:
        r = ET.SubElement(p, f"{W}r")
        # Build rPr
        rPr = ET.SubElement(r, f"{W}rPr")
        if default_rPr is not None:
            for child in default_rPr:
                rPr.append(deepcopy(child))
        if "bold" in flags:
            ET.SubElement(rPr, f"{W}b")
        if "italic" in flags:
            ET.SubElement(rPr, f"{W}i")
        if "code" in flags:
            # Use monospace font via rFonts ascii/hAnsi
            rf = ET.SubElement(rPr, f"{W}rFonts")
            rf.set(f"{W}ascii", "Consolas")
            rf.set(f"{W}hAnsi", "Consolas")
        # If rPr empty, remove it
        if len(rPr) == 0:
            r.remove(rPr)
        t = ET.SubElement(r, f"{W}t")
        t.text = text
        t.set(XML_SPACE, "preserve")


def make_para(template, text, default_rPr=None):
    p = clone_clean_p(template)
    set_p_text(p, text, default_rPr)
    return p


def make_para_segments(template, segments, default_rPr=None):
    p = clone_clean_p(template)
    set_p_segments(p, segments, default_rPr)
    return p


# ---------------------------------------------------------------------------
# Markdown parsing
# ---------------------------------------------------------------------------

def inline_text(tok):
    parts = []
    for child in tok.children or []:
        if child.type in ("text", "code_inline"):
            parts.append(child.content)
        elif child.type in ("softbreak", "hardbreak"):
            parts.append(" ")
    return "".join(parts).strip()


def inline_segments(tok):
    """Parse inline token into list of (text, flags) where flags is set of 'bold', 'italic', 'code'."""
    segments = []
    flags = []
    for child in tok.children or []:
        ctype = child.type
        if ctype == "strong_open":
            flags.append("bold")
        elif ctype == "strong_close":
            if "bold" in flags:
                flags.remove("bold")
        elif ctype == "em_open":
            flags.append("italic")
        elif ctype == "em_close":
            if "italic" in flags:
                flags.remove("italic")
        elif ctype == "text":
            segments.append((child.content, tuple(flags)))
        elif ctype == "code_inline":
            segments.append((child.content, tuple(flags + ["code"])))
        elif ctype in ("softbreak", "hardbreak"):
            segments.append((" ", tuple(flags)))
    # Merge consecutive segments with same flags
    merged = []
    for text, f in segments:
        if merged and merged[-1][1] == f:
            merged[-1] = [merged[-1][0] + text, f]
        else:
            merged.append([text, f])
    # Trim leading/trailing whitespace
    if merged:
        merged[0][0] = merged[0][0].lstrip()
        merged[-1][0] = merged[-1][0].rstrip()
    return [(t, f) for t, f in merged if t]


def parse_md_blocks(path):
    md = MarkdownIt("commonmark", {"html": True}).enable("table")
    tokens = md.parse(open(path, encoding="utf-8").read())

    blocks = []
    started = [False]

    def consume_list(i, depth, ordered):
        """Consume a list starting at tokens[i] (already past list_open). Emit flattened list_items."""
        close = "ordered_list_close" if ordered else "bullet_list_close"
        item_num = 1
        while i < len(tokens) and tokens[i].type != close:
            if tokens[i].type == "list_item_open":
                i += 1
                all_segments = []  # accumulated (text, flags)
                while i < len(tokens) and tokens[i].type != "list_item_close":
                    tt = tokens[i].type
                    if tt == "paragraph_open":
                        segs = inline_segments(tokens[i + 1])
                        if all_segments:
                            all_segments.append((" ", ()))
                        all_segments.extend(segs)
                        i += 3
                        continue
                    if tt in ("bullet_list_open", "ordered_list_open"):
                        sub_ordered = tt == "ordered_list_open"
                        # Emit current item
                        if all_segments:
                            prefix = f"{item_num}. " if ordered else ""
                            item_segments = [(prefix, ())] + all_segments if prefix else all_segments
                            item_text = "".join(t for t, _ in all_segments).strip()
                            blocks.append({
                                "type": "list_item",
                                "ordered": ordered,
                                "depth": depth,
                                "text": (prefix + item_text) if prefix else item_text,
                                "segments": item_segments,
                            })
                            if ordered:
                                item_num += 1
                            all_segments = []
                        i = consume_list(i + 1, depth + 1, sub_ordered)
                        continue
                    if tt == "inline":
                        segs = inline_segments(tokens[i])
                        if all_segments:
                            all_segments.append((" ", ()))
                        all_segments.extend(segs)
                    i += 1
                # Emit remaining segments
                if all_segments:
                    prefix = f"{item_num}. " if ordered else ""
                    item_segments = [(prefix, ())] + all_segments if prefix else all_segments
                    item_text = "".join(t for t, _ in all_segments).strip()
                    blocks.append({
                        "type": "list_item",
                        "ordered": ordered,
                        "depth": depth,
                        "text": (prefix + item_text) if prefix else item_text,
                        "segments": item_segments,
                    })
                    if ordered:
                        item_num += 1
            i += 1
        return i + 1  # skip list_close

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
            segments = inline_segments(tokens[i + 1])
            text = inline_text(tokens[i + 1])
            if text:
                blocks.append({"type": "paragraph", "text": text, "segments": segments})
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

        if tok.type == "hr":
            blocks.append({"type": "hr"})
            i += 1
            continue

        if tok.type == "blockquote_open":
            # Consume until blockquote_close, collect as a single paragraph with ">" prefix
            i += 1
            quoted_segments = []
            while i < len(tokens) and tokens[i].type != "blockquote_close":
                if tokens[i].type == "paragraph_open":
                    segs = inline_segments(tokens[i + 1])
                    if quoted_segments:
                        quoted_segments.append((" ", ()))
                    quoted_segments.extend(segs)
                    i += 3
                    continue
                i += 1
            if quoted_segments:
                # Prepend "> " to the first segment
                blocks.append({
                    "type": "paragraph",
                    "text": "".join(t for t, _ in quoted_segments).strip(),
                    "segments": quoted_segments,
                })
            i += 1
            continue

        i += 1

    return blocks


# ---------------------------------------------------------------------------
# Table builder
# ---------------------------------------------------------------------------

def build_table(template, rows):
    """Clone table template, resize rows/cols to fit, fill text."""
    tbl = deepcopy(template)
    strip_w14_ids(tbl)
    strip_rsid(tbl)

    tr_list = tbl.findall(f"{W}tr")
    if not tr_list:
        return tbl

    header_tr = tr_list[0]
    data_tr = tr_list[1] if len(tr_list) > 1 else tr_list[0]

    # Remove all existing rows
    for tr in tr_list:
        tbl.remove(tr)

    for r_idx, row_cells in enumerate(rows):
        tr_template = header_tr if r_idx == 0 else data_tr
        tr = deepcopy(tr_template)

        tc_list = tr.findall(f"{W}tc")
        if not tc_list:
            continue

        # Resize cells to target column count
        target_cols = len(row_cells)
        while len(tc_list) < target_cols:
            tr.append(deepcopy(tc_list[-1]))
            tc_list = tr.findall(f"{W}tc")
        while len(tc_list) > target_cols:
            tr.remove(tc_list[-1])
            tc_list = tr.findall(f"{W}tc")

        for c_idx, cell_text in enumerate(row_cells):
            tc = tc_list[c_idx]
            ps = tc.findall(f"{W}p")
            for p in ps[1:]:
                tc.remove(p)
            if ps:
                set_p_text(ps[0], cell_text)
            else:
                p = ET.SubElement(tc, f"{W}p")
                set_p_text(p, cell_text)

        tbl.append(tr)

    return tbl


# ---------------------------------------------------------------------------
# Main transformation
# ---------------------------------------------------------------------------

def main():
    tree = ET.parse(DOC_XML)
    root = tree.getroot()
    body = root.find(f"{W}body")

    all_paras = body.findall(f"{W}p")
    all_tables = body.findall(f"{W}tbl")

    # Templates
    T_H1 = clone_clean_p(all_paras[35])
    T_H2 = clone_clean_p(all_paras[38])
    T_H3 = clone_clean_p(all_paras[41])
    T_H4 = clone_clean_p(all_paras[199])
    T_AF3 = clone_clean_p(all_paras[21])
    T_BODY = clone_clean_p(all_paras[22])
    T_BULLET = clone_clean_p(all_paras[44])
    T_EMPTY = clone_clean_p(all_paras[42])

    # default body run rPr
    body_rPr = all_paras[22].find(f"{W}r/{W}rPr")

    # Table templates keyed by column count (pick first occurrence for each)
    tbl_by_cols = {}
    for t in all_tables:
        tr = t.find(f"{W}tr")
        if tr is None:
            continue
        n = len(tr.findall(f"{W}tc"))
        tbl_by_cols.setdefault(n, t)

    def pick_table_template(n_cols):
        if n_cols in tbl_by_cols:
            return tbl_by_cols[n_cols]
        avail = sorted(tbl_by_cols.keys())
        closest = min(avail, key=lambda c: abs(c - n_cols))
        return tbl_by_cols[closest]

    # Parse markdown
    md_blocks = parse_md_blocks(MD_SOURCE)
    print(f"Parsed {len(md_blocks)} md blocks", file=sys.stderr)

    # --- Partition md_blocks ---
    # Collect abstract body paragraphs (between 中文摘要 and next heading)
    abstract_paras = []
    symbol_table_rows = None
    toc_placeholder = None
    figure_placeholder = None
    chapter_blocks = []

    section = None
    for b in md_blocks:
        if b["type"] == "heading" and b["level"] == 1:
            section = b["text"]
            if section in ("中文摘要", "目錄", "符號索引", "圖表目錄", "圖表索引"):
                continue  # handle specially
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
                figure_placeholder = b["text"]
            continue
        chapter_blocks.append(b)

    print(f"Abstract paras: {len(abstract_paras)}", file=sys.stderr)
    print(f"Symbol rows: {len(symbol_table_rows) if symbol_table_rows else 0}", file=sys.stderr)
    print(f"TOC placeholder: {toc_placeholder}", file=sys.stderr)
    print(f"Figure placeholder: {figure_placeholder}", file=sys.stderr)
    print(f"Chapter blocks: {len(chapter_blocks)}", file=sys.stderr)

    # --- Phase 0: Update cover date (paragraph #20) to match v36 ---
    set_p_text(all_paras[20], "中華民國 115 年　月　日")

    # --- Phase 1: Update abstract (body children 22-27) ---
    # v11: 22/23/24/25 body, 26 empty, 27 keyword
    # v36 typically: 3 body paragraphs + 1 keyword
    # Strategy: pad or truncate to match 4 body slots + keyword
    abs_body_slots = [all_paras[22], all_paras[23], all_paras[24], all_paras[25]]
    n_md = len(abstract_paras)

    # If md has fewer than 4 body paragraphs, clear the extras
    # If md has more, merge extras into the last
    md_body = list(abstract_paras)
    if len(md_body) > 4:
        md_body = md_body[:3] + [" ".join(md_body[3:])]
    while len(md_body) < 4:
        md_body.append("")

    for slot, text in zip(abs_body_slots, md_body):
        if text:
            set_p_text(slot, text, body_rPr)
        else:
            # Clear runs, leave empty
            strip_all_runs(slot)

    # Keyword paragraph (child 27)
    # Find keyword para: it's the last paragraph in md_blocks[abstract section]
    # Actually v36 keyword starts with "關鍵字："
    kw_text = None
    for p in abstract_paras:
        if p.startswith("關鍵字"):
            kw_text = p
    if kw_text:
        # kw para isn't in our md_body list after trim; find and set
        set_p_text(all_paras[27], kw_text, body_rPr)
    # Also we may have put kw into body slots; detect and clean
    if kw_text and kw_text in md_body:
        idx = md_body.index(kw_text)
        strip_all_runs(abs_body_slots[idx])

    # --- Phase 2: Replace 目錄 sdt TOC field with placeholder paragraph ---
    # Keep 目錄 heading (paragraph #29, child 29) intact.
    # Remove <w:sdt> (the TOC field); insert placeholder paragraph using body template.
    sdt = None
    for child in list(body):
        if child.tag == f"{W}sdt":
            sdt = child
            break
    if sdt is not None and toc_placeholder:
        idx = list(body).index(sdt)
        body.remove(sdt)
        placeholder_p = make_para(T_BODY, toc_placeholder, body_rPr)
        body.insert(idx, placeholder_p)

    # --- Phase 3: Update 符號索引 table (body child 33) ---
    if symbol_table_rows:
        # Find the existing symbol index table (it's the first table in body)
        symbol_tbl = all_tables[0]
        # Replace content
        new_tbl = build_table(symbol_tbl, symbol_table_rows)
        # Replace in body
        idx = list(body).index(symbol_tbl)
        body.remove(symbol_tbl)
        body.insert(idx, new_tbl)

    # --- Phase 4: Update 圖表索引 → 圖表目錄 (all_paras[33]) and placeholder (all_paras[34]) ---
    # all_paras index: 33="圖表索引" heading (child 35), 34=placeholder (child 36)
    set_p_text(all_paras[33], "圖表目錄")
    if figure_placeholder:
        set_p_text(all_paras[34], figure_placeholder, body_rPr)

    # --- Phase 5: Delete all chapter content (everything after 圖表目錄 placeholder, before sectPr) ---
    children_snapshot = list(body)
    placeholder_idx = children_snapshot.index(all_paras[34])
    sectPr = body.find(f"{W}sectPr")
    sectPr_idx = children_snapshot.index(sectPr)
    to_remove = children_snapshot[placeholder_idx + 1 : sectPr_idx]
    for el in to_remove:
        body.remove(el)

    # --- Phase 6: Insert chapter content before sectPr ---
    def append_before_sectPr(elem):
        sect = body.find(f"{W}sectPr")
        idx = list(body).index(sect)
        body.insert(idx, elem)

    # Normalize chapter_blocks by injecting empty spacers between sections for visual clarity is not needed
    for b in chapter_blocks:
        btype = b["type"]

        if btype == "heading":
            level = b["level"]
            text = b["text"]
            if level == 1:
                p = make_para(T_H1, text)
            elif level == 2:
                p = make_para(T_H2, text)
            elif level == 3:
                p = make_para(T_H3, text)
            elif level == 4:
                p = make_para(T_H4, text)
            else:
                p = make_para(T_BODY, text, body_rPr)
            append_before_sectPr(p)
            continue

        if btype == "paragraph":
            segs = b.get("segments") or [(b["text"], ())]
            p = make_para_segments(T_BODY, segs, body_rPr)
            append_before_sectPr(p)
            continue

        if btype == "list_item":
            depth = b.get("depth", 0)
            ordered = b.get("ordered", False)
            indent = "　" * depth  # full-width indent per nesting level
            segs = b.get("segments") or [(b["text"], ())]
            if indent:
                segs = [(indent, ())] + list(segs)
            if ordered:
                p = make_para_segments(T_BODY, segs, body_rPr)
            else:
                p = make_para_segments(T_BULLET, segs, body_rPr)
            append_before_sectPr(p)
            continue

        if btype == "code":
            # Preserve linebreaks: split into lines and create a paragraph per line using BODY template
            for line in b["text"].splitlines():
                p = make_para(T_BODY, line if line else " ", body_rPr)
                append_before_sectPr(p)
            continue

        if btype == "table":
            rows = b["rows"]
            n_cols = max(len(r) for r in rows) if rows else 3
            template = pick_table_template(n_cols)
            tbl = build_table(template, rows)
            append_before_sectPr(tbl)
            continue

        if btype == "hr":
            # Insert an empty paragraph as separator
            p = clone_clean_p(T_EMPTY)
            append_before_sectPr(p)
            continue

    # Write back
    tree.write(DOC_XML, encoding="UTF-8", xml_declaration=True, default_namespace=None)
    print("Done", file=sys.stderr)


if __name__ == "__main__":
    main()
