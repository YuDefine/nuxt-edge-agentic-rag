#!/usr/bin/env python3
"""
docx_diff.py - 分析 DOCX 與 MD 的差異，生成操作計畫

用法：
    python docx_diff.py template.docx content.md --output plan.json

輸出操作計畫，包含：
- 可直接替換的段落（結構匹配）
- 需要新增的段落
- DOCX 中多餘的段落
"""

import argparse
import json
import re
import sys
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn
from markdown_it import MarkdownIt


def get_para_text(para) -> str:
    return "".join(node.text or "" for node in para._element.iter(qn("w:t"))).strip()


def get_para_style(para) -> str:
    return para.style.name if para.style else "Normal"


def is_heading(para) -> bool:
    style = para.style
    if style and style.name and "Heading" in style.name:
        return True
    text = get_para_text(para)
    if re.match(r"^(第[一二三四五六七八九十]+[章節]|[\d\.]+\s+\S|#{1,6}\s)", text):
        return True
    return False


def normalize_for_match(text: str) -> str:
    """正規化文字用於匹配"""
    text = re.sub(r"\s+", " ", text)
    text = text.strip().lower()
    return text


def extract_docx_structure(docx_path: str, start_heading: str = "中文摘要") -> list[dict]:
    """提取 DOCX 段落結構"""
    doc = Document(docx_path)
    result = []
    started = False

    for i, para in enumerate(doc.paragraphs):
        text = get_para_text(para)

        if not started:
            if text == start_heading:
                started = True
            else:
                continue

        if not text:
            continue

        result.append({
            "index": i,
            "text": text,
            "text_normalized": normalize_for_match(text),
            "style": get_para_style(para),
            "is_heading": is_heading(para),
            "char_count": len(text)
        })

    return result


def inline_text(token) -> str:
    parts = []
    for child in token.children or []:
        if child.type in {"text", "code_inline"}:
            parts.append(child.content)
        elif child.type in {"softbreak", "hardbreak"}:
            parts.append(" ")
    return "".join(parts).strip()


def extract_md_structure(md_path: str, start_heading: str = "中文摘要") -> list[dict]:
    """提取 MD 段落結構"""
    md_text = Path(md_path).read_text(encoding="utf-8")
    md = MarkdownIt("commonmark", {"html": True}).enable("table")
    tokens = md.parse(md_text)

    result = []
    started = False
    i = 0
    idx = 0

    while i < len(tokens):
        token = tokens[i]

        if token.type == "heading_open":
            level = int(token.tag[1])
            text = inline_text(tokens[i + 1])

            if not started and text == start_heading:
                started = True

            if started:
                result.append({
                    "index": idx,
                    "text": text,
                    "text_normalized": normalize_for_match(text),
                    "type": "heading",
                    "level": level,
                    "char_count": len(text)
                })
                idx += 1
            i += 3
            continue

        if not started:
            i += 1
            continue

        if token.type == "paragraph_open":
            text = inline_text(tokens[i + 1])
            if text:
                result.append({
                    "index": idx,
                    "text": text,
                    "text_normalized": normalize_for_match(text),
                    "type": "paragraph",
                    "char_count": len(text)
                })
                idx += 1
            i += 3
            continue

        if token.type in {"ordered_list_open", "bullet_list_open"}:
            ordered = token.type == "ordered_list_open"
            close_type = "ordered_list_close" if ordered else "bullet_list_close"
            i += 1
            item_index = 1
            while i < len(tokens) and tokens[i].type != close_type:
                if tokens[i].type == "list_item_open":
                    i += 1
                    item_parts = []
                    while i < len(tokens) and tokens[i].type != "list_item_close":
                        if tokens[i].type == "paragraph_open":
                            text = inline_text(tokens[i + 1])
                            if text:
                                item_parts.append(text)
                            i += 3
                            continue
                        i += 1
                    item_text = " ".join(item_parts).strip()
                    prefix = f"{item_index}. " if ordered else "• "
                    result.append({
                        "index": idx,
                        "text": prefix + item_text,
                        "text_normalized": normalize_for_match(prefix + item_text),
                        "type": "list_item",
                        "char_count": len(prefix + item_text)
                    })
                    idx += 1
                    item_index += 1
                i += 1
            i += 1
            continue

        if token.type == "fence":
            result.append({
                "index": idx,
                "text": token.content.strip(),
                "text_normalized": normalize_for_match(token.content),
                "type": "code",
                "char_count": len(token.content.strip())
            })
            idx += 1
            i += 1
            continue

        i += 1

    return result


def compute_diff(docx_paras: list[dict], md_paras: list[dict]) -> dict:
    """計算差異並生成操作計畫"""

    # 建立 DOCX 段落的正規化文字索引
    docx_by_norm = {}
    for p in docx_paras:
        norm = p["text_normalized"]
        if norm not in docx_by_norm:
            docx_by_norm[norm] = []
        docx_by_norm[norm].append(p)

    # 追蹤已匹配的 DOCX 段落
    matched_docx_indices = set()

    operations = []

    for md_p in md_paras:
        md_norm = md_p["text_normalized"]
        md_text = md_p["text"]

        # 嘗試找完全匹配
        matched = False
        if md_norm in docx_by_norm:
            for docx_p in docx_by_norm[md_norm]:
                if docx_p["index"] not in matched_docx_indices:
                    matched_docx_indices.add(docx_p["index"])

                    # 文字完全相同，不需要操作
                    if docx_p["text"] == md_text:
                        operations.append({
                            "action": "KEEP",
                            "docx_index": docx_p["index"],
                            "md_index": md_p["index"],
                            "text_preview": md_text[:50]
                        })
                    else:
                        # 正規化後相同但原文不同，需要替換
                        operations.append({
                            "action": "REPLACE",
                            "docx_index": docx_p["index"],
                            "md_index": md_p["index"],
                            "old_text": docx_p["text"],
                            "new_text": md_text
                        })
                    matched = True
                    break

        if not matched:
            # 嘗試模糊匹配（前 20 字元相同）
            prefix = md_norm[:20] if len(md_norm) >= 20 else md_norm
            for docx_p in docx_paras:
                if docx_p["index"] in matched_docx_indices:
                    continue
                if docx_p["text_normalized"].startswith(prefix):
                    matched_docx_indices.add(docx_p["index"])
                    operations.append({
                        "action": "REPLACE",
                        "docx_index": docx_p["index"],
                        "md_index": md_p["index"],
                        "old_text": docx_p["text"],
                        "new_text": md_text,
                        "match_type": "prefix"
                    })
                    matched = True
                    break

        if not matched:
            operations.append({
                "action": "INSERT",
                "md_index": md_p["index"],
                "new_text": md_text,
                "type": md_p.get("type", "paragraph")
            })

    # 找出 DOCX 中未匹配的段落
    unmatched_docx = []
    for docx_p in docx_paras:
        if docx_p["index"] not in matched_docx_indices:
            unmatched_docx.append({
                "docx_index": docx_p["index"],
                "text": docx_p["text"],
                "style": docx_p["style"]
            })

    # 統計
    keep_count = sum(1 for op in operations if op["action"] == "KEEP")
    replace_count = sum(1 for op in operations if op["action"] == "REPLACE")
    insert_count = sum(1 for op in operations if op["action"] == "INSERT")

    return {
        "summary": {
            "docx_paragraphs": len(docx_paras),
            "md_paragraphs": len(md_paras),
            "keep": keep_count,
            "replace": replace_count,
            "insert": insert_count,
            "unmatched_docx": len(unmatched_docx)
        },
        "operations": operations,
        "unmatched_docx": unmatched_docx
    }


def main():
    parser = argparse.ArgumentParser(description="分析 DOCX 與 MD 差異")
    parser.add_argument("docx", type=Path, help="DOCX 檔案")
    parser.add_argument("markdown", type=Path, help="Markdown 檔案")
    parser.add_argument("--start-heading", default="中文摘要", help="起始標題")
    parser.add_argument("--output", "-o", type=Path, help="輸出 JSON 檔案")
    args = parser.parse_args()

    if not args.docx.exists():
        print(f"錯誤：找不到 {args.docx}", file=sys.stderr)
        return 1

    if not args.markdown.exists():
        print(f"錯誤：找不到 {args.markdown}", file=sys.stderr)
        return 1

    print(f"分析 DOCX：{args.docx}")
    docx_paras = extract_docx_structure(str(args.docx), args.start_heading)
    print(f"  - 段落數：{len(docx_paras)}")

    print(f"分析 MD：{args.markdown}")
    md_paras = extract_md_structure(str(args.markdown), args.start_heading)
    print(f"  - 段落數：{len(md_paras)}")

    print("計算差異...")
    diff = compute_diff(docx_paras, md_paras)

    print(f"\n=== 差異摘要 ===")
    print(f"  DOCX 段落：{diff['summary']['docx_paragraphs']}")
    print(f"  MD 段落：{diff['summary']['md_paragraphs']}")
    print(f"  保持不變：{diff['summary']['keep']}")
    print(f"  需要替換：{diff['summary']['replace']}")
    print(f"  需要新增：{diff['summary']['insert']}")
    print(f"  DOCX 未匹配：{diff['summary']['unmatched_docx']}")

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(diff, f, ensure_ascii=False, indent=2)
        print(f"\n操作計畫已儲存：{args.output}")
    else:
        # 顯示前 20 個操作
        print(f"\n=== 操作計畫（前 20 項）===")
        for op in diff["operations"][:20]:
            action = op["action"]
            if action == "KEEP":
                print(f"  [KEEP] #{op['docx_index']}: {op['text_preview'][:40]}...")
            elif action == "REPLACE":
                print(f"  [REPLACE] #{op['docx_index']}: '{op['old_text'][:25]}...' -> '{op['new_text'][:25]}...'")
            elif action == "INSERT":
                print(f"  [INSERT] {op['type']}: {op['new_text'][:50]}...")

        if len(diff["operations"]) > 20:
            print(f"  ... 還有 {len(diff['operations']) - 20} 項")

    return 0


if __name__ == "__main__":
    sys.exit(main())
