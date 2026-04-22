#!/usr/bin/env python3
"""
docx_apply.py - 根據操作計畫執行 DOCX 編輯

用法：
    # 先生成計畫
    python docx_diff.py template.docx content.md -o plan.json

    # 執行替換（只處理 REPLACE，不處理 INSERT）
    python docx_apply.py template.docx plan.json output.docx --replace-only

    # 執行所有操作（包含 INSERT；目前 INSERT 只會附加到文件尾端）
    python docx_apply.py template.docx plan.json output.docx --all

    # 只執行指定範圍
    python docx_apply.py template.docx plan.json output.docx --range 0-50
"""

import argparse
import json
import sys
from copy import deepcopy
from pathlib import Path

from docx import Document
from docx.oxml.ns import qn


def get_para_text(para) -> str:
    return "".join(node.text or "" for node in para._element.iter(qn("w:t"))).strip()


def set_para_text(para, new_text: str) -> bool:
    """替換段落文字，保留所有格式"""
    t_elements = list(para._element.iter(qn("w:t")))
    if not t_elements:
        return False

    # 清空所有 text 節點
    for t in t_elements:
        t.text = ""

    # 在第一個節點填入新文字
    t_elements[0].text = new_text
    return True


def clone_para_after(para, new_text: str):
    """在段落後插入複製的段落"""
    new_elem = deepcopy(para._element)
    para._element.addnext(new_elem)

    # 設定文字
    t_elements = list(new_elem.iter(qn("w:t")))
    if t_elements:
        for t in t_elements:
            t.text = ""
        t_elements[0].text = new_text

    return new_elem


def main():
    parser = argparse.ArgumentParser(description="執行 DOCX 編輯操作；INSERT 目前僅支援附加到文件尾端")
    parser.add_argument("docx", type=Path, help="原始 DOCX")
    parser.add_argument("plan", type=Path, help="操作計畫 JSON")
    parser.add_argument("output", type=Path, help="輸出 DOCX")
    parser.add_argument("--replace-only", action="store_true", help="只執行 REPLACE，不執行 INSERT")
    parser.add_argument("--all", action="store_true", help="執行所有操作（INSERT 目前只會附加到文件尾端）")
    parser.add_argument("--range", help="只執行指定範圍的操作，如 0-50")
    parser.add_argument("--dry-run", action="store_true", help="只顯示將執行的操作")
    args = parser.parse_args()

    if not args.docx.exists():
        print(f"錯誤：找不到 {args.docx}", file=sys.stderr)
        return 1

    if not args.plan.exists():
        print(f"錯誤：找不到 {args.plan}", file=sys.stderr)
        return 1

    # 載入計畫
    with open(args.plan, "r", encoding="utf-8") as f:
        plan = json.load(f)

    operations = plan["operations"]

    # 過濾操作
    if args.replace_only:
        operations = [op for op in operations if op["action"] == "REPLACE"]
        print(f"只執行 REPLACE 操作：{len(operations)} 項")
    elif not args.all:
        # 預設只執行 KEEP 和 REPLACE
        operations = [op for op in operations if op["action"] in ("KEEP", "REPLACE")]
        print(f"執行 KEEP/REPLACE 操作：{len(operations)} 項")

    # 範圍過濾
    if args.range:
        start, end = map(int, args.range.split("-"))
        operations = operations[start:end]
        print(f"範圍 {start}-{end}：{len(operations)} 項")

    if args.dry_run:
        print("\n=== Dry Run ===")
        for i, op in enumerate(operations[:30]):
            if op["action"] == "KEEP":
                print(f"  {i}. [KEEP] #{op['docx_index']}")
            elif op["action"] == "REPLACE":
                print(f"  {i}. [REPLACE] #{op['docx_index']}: '{op['old_text'][:30]}...' -> '{op['new_text'][:30]}...'")
            elif op["action"] == "INSERT":
                print(f"  {i}. [INSERT]: {op['new_text'][:50]}...")
        if len(operations) > 30:
            print(f"  ... 還有 {len(operations) - 30} 項")
        print("\n(dry-run 模式)")
        return 0

    # 載入 DOCX
    doc = Document(str(args.docx))
    paragraphs = doc.paragraphs

    # 執行操作
    replace_count = 0
    insert_count = 0
    errors = []

    # 先處理 REPLACE（不改變結構）
    for op in operations:
        if op["action"] == "REPLACE":
            docx_idx = op["docx_index"]
            if docx_idx < len(paragraphs):
                para = paragraphs[docx_idx]
                old_text = get_para_text(para)

                # 驗證
                if old_text != op["old_text"]:
                    errors.append(f"REPLACE #{docx_idx}: 文字不匹配，跳過")
                    continue

                if set_para_text(para, op["new_text"]):
                    replace_count += 1
                else:
                    errors.append(f"REPLACE #{docx_idx}: 無法替換")
            else:
                errors.append(f"REPLACE #{docx_idx}: 索引超出範圍")

    # 處理 INSERT（從後往前插入，避免索引錯位）
    if args.all:
        insert_ops = [op for op in operations if op["action"] == "INSERT"]
        # 按 md_index 排序，從後往前處理
        insert_ops.sort(key=lambda x: x.get("md_index", 0), reverse=True)

        for op in insert_ops:
            # 找到插入位置（在相鄰的已匹配段落之後）
            # 這個邏輯比較複雜，需要根據上下文決定插入位置
            # 簡化版：在文件末尾追加
            if paragraphs:
                last_para = paragraphs[-1]
                clone_para_after(last_para, op["new_text"])
                insert_count += 1

    # 儲存
    args.output.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(args.output))

    print(f"\n=== 執行結果 ===")
    print(f"  替換：{replace_count}")
    print(f"  插入：{insert_count}")
    if errors:
        print(f"  錯誤：{len(errors)}")
        for err in errors[:10]:
            print(f"    - {err}")

    print(f"\n已儲存：{args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
