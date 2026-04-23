#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import sys
import zipfile
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="將 DOCX 解壓縮為可編輯的 XML 目錄。")
    parser.add_argument("docx", type=Path, help="輸入 DOCX")
    parser.add_argument("output_dir", type=Path, help="輸出目錄")
    parser.add_argument(
        "--force",
        action="store_true",
        help="若輸出目錄已存在，先清空後再解壓縮。",
    )
    return parser.parse_args()


def prepare_output_dir(output_dir: Path, force: bool) -> None:
    if output_dir.exists():
        if not output_dir.is_dir():
            raise SystemExit(f"輸出路徑不是目錄：{output_dir}")
        if any(output_dir.iterdir()):
            if not force:
                raise SystemExit(
                    f"輸出目錄已存在且非空：{output_dir}。"
                    " 若要覆蓋，請加上 `--force`。"
                )
            shutil.rmtree(output_dir)

    output_dir.mkdir(parents=True, exist_ok=True)


def unpack_docx(docx_path: Path, output_dir: Path, force: bool = False) -> Path:
    if not docx_path.exists():
        raise SystemExit(f"找不到 DOCX：{docx_path}")

    prepare_output_dir(output_dir, force)

    with zipfile.ZipFile(docx_path) as archive:
        archive.extractall(output_dir)

    return output_dir


def main() -> int:
    args = parse_args()
    output_dir = unpack_docx(args.docx.resolve(), args.output_dir.resolve(), force=args.force)
    print(output_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
