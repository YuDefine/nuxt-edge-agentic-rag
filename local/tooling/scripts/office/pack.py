#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="將 XML 目錄重新打包為 DOCX。")
    parser.add_argument("input_dir", type=Path, help="已解壓的 DOCX 目錄")
    parser.add_argument("output_docx", type=Path, help="輸出 DOCX")
    parser.add_argument(
        "--original",
        type=Path,
        help="原始 DOCX；若提供，會沿用既有 ZIP entry 順序與 metadata。",
    )
    return parser.parse_args()


def iter_input_files(input_dir: Path, output_docx: Path) -> dict[str, Path]:
    output_resolved = output_docx.resolve()
    file_map: dict[str, Path] = {}

    for path in sorted(input_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.resolve() == output_resolved:
            continue
        file_map[path.relative_to(input_dir).as_posix()] = path

    return file_map


def clone_zipinfo(info: zipfile.ZipInfo) -> zipfile.ZipInfo:
    cloned = zipfile.ZipInfo(filename=info.filename, date_time=info.date_time)
    cloned.comment = info.comment
    cloned.create_system = info.create_system
    cloned.create_version = info.create_version
    cloned.extract_version = info.extract_version
    cloned.flag_bits = info.flag_bits
    cloned.volume = info.volume
    cloned.internal_attr = info.internal_attr
    cloned.external_attr = info.external_attr
    cloned.extra = info.extra
    cloned.compress_type = info.compress_type
    return cloned


def pack_docx_directory(input_dir: Path, output_docx: Path, original_docx: Path | None = None) -> Path:
    if not input_dir.exists() or not input_dir.is_dir():
        raise SystemExit(f"找不到已解壓目錄：{input_dir}")

    if original_docx is not None and not original_docx.exists():
        raise SystemExit(f"找不到原始 DOCX：{original_docx}")

    file_map = iter_input_files(input_dir, output_docx)
    output_docx.parent.mkdir(parents=True, exist_ok=True)

    written: set[str] = set()
    with zipfile.ZipFile(output_docx, "w") as archive:
        if original_docx is not None:
            with zipfile.ZipFile(original_docx) as original_archive:
                for info in original_archive.infolist():
                    if info.is_dir():
                        continue

                    source_path = file_map.get(info.filename)
                    if source_path is None:
                        continue

                    archive.writestr(
                        clone_zipinfo(info),
                        source_path.read_bytes(),
                        compress_type=info.compress_type,
                    )
                    written.add(info.filename)

        for arcname in sorted(file_map):
            if arcname in written:
                continue
            archive.write(file_map[arcname], arcname=arcname, compress_type=zipfile.ZIP_DEFLATED)

    return output_docx


def main() -> int:
    args = parse_args()
    output_docx = pack_docx_directory(
        args.input_dir.resolve(),
        args.output_docx.resolve(),
        original_docx=args.original.resolve() if args.original else None,
    )
    print(output_docx)
    return 0


if __name__ == "__main__":
    sys.exit(main())
