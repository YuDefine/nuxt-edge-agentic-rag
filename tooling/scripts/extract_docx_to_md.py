#!/usr/bin/env python3
from __future__ import annotations

import argparse
import posixpath
import re
import shutil
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET


NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "v": "urn:schemas-microsoft-com:vml",
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
}
IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
HYPERLINK_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
THESIS_FRONT_MATTER_HEADINGS = {"中文摘要", "目錄", "符號索引", "圖表目錄", "圖表索引"}
THESIS_CHAPTER_TITLES = {
    "開發計畫",
    "分析與設計",
    "實作成果",
    "結論",
    "專題心得與檢討",
    "參考文獻",
    "附錄",
}
CHAPTER_PREFIX_RE = re.compile(r"^(?:第[零〇一二三四五六七八九十百兩]+章\s*)+")
SECTION_PREFIX_RE = re.compile(r"^(?:第[零〇一二三四五六七八九十百兩]+節\s*)+")
H3_PREFIX_RE = re.compile(r"^(?:(?:\d+\.\d+\.\d+(?:\.\d+)?)\s*)+")
H4_PREFIX_RE = re.compile(r"^(?:(?:\d+\.\d+\.\d+\.\d+)\s*)+")
APPENDIX_PREFIX_RE = re.compile(r"^(?:附錄\s*[A-ZＡ-Ｚ][：: ]*\s*)+")
APPENDIX_H3_PREFIX_RE = re.compile(r"^(?:(?:[A-Z]\.\d+(?:\.\d+)?)\s*)+")
APPENDIX_H4_PREFIX_RE = re.compile(r"^(?:(?:[A-Z]\.\d+\.\d+)\s*)+")


def qn(prefix: str, tag: str) -> str:
    return f"{{{NS[prefix]}}}{tag}"


def normalize_text(value: str) -> str:
    value = value.replace("\xa0", " ")
    lines = []
    for raw_line in value.splitlines():
        line = re.sub(r"[ \t\r\f\v]+", " ", raw_line).strip()
        lines.append(line)
    cleaned = [line for line in lines if line]
    return "  \n".join(cleaned).strip()


def escape_table_cell(value: str) -> str:
    value = value.replace("|", r"\|")
    value = value.replace("\n", "<br>")
    return value.strip()


def int_to_chinese(value: int) -> str:
    numerals = {
        0: "零",
        1: "一",
        2: "二",
        3: "三",
        4: "四",
        5: "五",
        6: "六",
        7: "七",
        8: "八",
        9: "九",
        10: "十",
    }
    if value <= 10:
        return numerals[value]
    if value < 20:
        return "十" + numerals[value % 10]
    tens, ones = divmod(value, 10)
    prefix = numerals[tens] + "十"
    return prefix if ones == 0 else prefix + numerals[ones]


def appendix_letter(index: int) -> str:
    return chr(ord("A") + index - 1)


def strip_heading_prefix(text: str, pattern: re.Pattern[str]) -> str:
    stripped = pattern.sub("", text).strip()
    return stripped or text.strip()


def normalize_thesis_markdown(markdown: str) -> str:
    lines = markdown.splitlines()
    headings = [line[2:].strip() for line in lines if line.startswith("# ")]
    thesis_like = (
        "中文摘要" in headings
        and any(title in headings for title in {"目錄", "圖表目錄", "圖表索引"})
        and any(
            heading in THESIS_CHAPTER_TITLES
            or CHAPTER_PREFIX_RE.match(heading)
            or heading == "附錄"
            for heading in headings
        )
    )
    if not thesis_like:
        return markdown

    chapter_index = 0
    section_index = 0
    subsection_index = 0
    subsubsection_index = 0
    appendix_index = 0
    appendix_subsection_index = 0
    appendix_subsubsection_index = 0
    in_appendix = False

    normalized_lines: list[str] = []
    for line in lines:
        match = re.match(r"^(#{1,6})\s+(.*)$", line)
        if not match:
            normalized_lines.append(line)
            continue

        marks, raw_text = match.groups()
        level = len(marks)
        text = raw_text.strip()
        normalized_text = text

        if level == 1:
            if text in THESIS_FRONT_MATTER_HEADINGS:
                in_appendix = False
                appendix_subsection_index = 0
                appendix_subsubsection_index = 0
            else:
                chapter_title = strip_heading_prefix(text, CHAPTER_PREFIX_RE)
                if chapter_title == "附錄":
                    in_appendix = True
                    appendix_index = 0
                    appendix_subsection_index = 0
                    appendix_subsubsection_index = 0
                    normalized_text = "附錄"
                else:
                    in_appendix = False
                    chapter_index += 1
                    section_index = 0
                    subsection_index = 0
                    subsubsection_index = 0
                    normalized_text = f"第{int_to_chinese(chapter_index)}章 {chapter_title}"

        elif level == 2:
            if in_appendix:
                appendix_index += 1
                appendix_subsection_index = 0
                appendix_subsubsection_index = 0
                appendix_title = strip_heading_prefix(text, APPENDIX_PREFIX_RE)
                normalized_text = f"附錄 {appendix_letter(appendix_index)}：{appendix_title}"
            elif chapter_index > 0:
                section_index += 1
                subsection_index = 0
                subsubsection_index = 0
                section_title = strip_heading_prefix(text, SECTION_PREFIX_RE)
                normalized_text = f"第{int_to_chinese(section_index)}節 {section_title}"

        elif level == 3:
            if in_appendix and appendix_index > 0:
                appendix_subsection_index += 1
                appendix_subsubsection_index = 0
                # 先清除附錄前綴（A.1），再清除原始數字前綴（7.1.1）
                appendix_title = strip_heading_prefix(text, APPENDIX_H3_PREFIX_RE)
                appendix_title = strip_heading_prefix(appendix_title, H3_PREFIX_RE)
                normalized_text = f"{appendix_letter(appendix_index)}.{appendix_subsection_index} {appendix_title}"
            elif chapter_index > 0 and section_index > 0:
                subsection_index += 1
                subsubsection_index = 0
                subsection_title = strip_heading_prefix(text, H3_PREFIX_RE)
                normalized_text = f"{chapter_index}.{section_index}.{subsection_index} {subsection_title}"

        elif level == 4:
            if in_appendix and appendix_index > 0:
                if appendix_subsection_index == 0:
                    appendix_subsection_index = 1
                appendix_subsubsection_index += 1
                # 先清除附錄前綴（A.1.1），再清除原始數字前綴（7.1.1.1）
                appendix_title = strip_heading_prefix(text, APPENDIX_H4_PREFIX_RE)
                appendix_title = strip_heading_prefix(appendix_title, H4_PREFIX_RE)
                normalized_text = (
                    f"{appendix_letter(appendix_index)}."
                    f"{appendix_subsection_index}.{appendix_subsubsection_index} {appendix_title}"
                )
            elif chapter_index > 0 and section_index > 0:
                if subsection_index == 0:
                    subsection_index = 1
                subsubsection_index += 1
                subsubsection_title = strip_heading_prefix(text, H4_PREFIX_RE)
                normalized_text = (
                    f"{chapter_index}.{section_index}.{subsection_index}.{subsubsection_index} "
                    f"{subsubsection_title}"
                )

        normalized_lines.append(f"{marks} {normalized_text}")

    return "\n".join(normalized_lines)


@dataclass
class StyleInfo:
    heading_level: int | None = None


@dataclass
class ListInfo:
    level: int


@dataclass
class InlineImage:
    rel_id: str
    alt_text: str


class DocxToMarkdownConverter:
    def __init__(self, docx_path: Path, output_dir: Path) -> None:
        self.docx_path = docx_path
        self.output_dir = output_dir
        self.md_path = output_dir / f"{docx_path.stem}.md"
        self.image_dir = output_dir / f"{docx_path.stem}_assets"
        self.image_relationships: dict[str, str] = {}
        self.hyperlink_relationships: dict[str, str] = {}
        self.styles: dict[str, StyleInfo] = {}
        self.number_formats: dict[str, dict[int, str]] = {}
        self.image_cache: dict[str, str] = {}
        self.image_name_counts: dict[str, int] = {}
        self.image_count = 0

    def convert(self) -> tuple[Path, int]:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        if self.image_dir.exists():
            shutil.rmtree(self.image_dir)
        self.image_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(self.docx_path) as archive:
            self.image_relationships, self.hyperlink_relationships = self._parse_relationships(archive)
            self.styles = self._parse_styles(archive)
            self.number_formats = self._parse_numbering(archive)

            body = self._load_xml(archive, "word/document.xml").find("w:body", NS)
            if body is None:
                raise ValueError("找不到 word/document.xml 的 body 節點。")

            blocks: list[str] = []
            for child in body:
                if child.tag == qn("w", "p"):
                    paragraph_blocks = self._convert_paragraph(archive, child)
                    blocks.extend(paragraph_blocks)
                elif child.tag == qn("w", "tbl"):
                    table_block = self._convert_table(archive, child)
                    if table_block:
                        blocks.append(table_block)

        markdown = self._cleanup_blocks(blocks)
        markdown = normalize_thesis_markdown(markdown)
        self.md_path.write_text(markdown + "\n", encoding="utf-8")
        return self.md_path, self.image_count

    def _load_xml(self, archive: zipfile.ZipFile, name: str) -> ET.Element:
        return ET.fromstring(archive.read(name))

    def _parse_relationships(self, archive: zipfile.ZipFile) -> tuple[dict[str, str], dict[str, str]]:
        rels_path = "word/_rels/document.xml.rels"
        try:
            root = self._load_xml(archive, rels_path)
        except KeyError:
            return {}, {}

        image_relationships: dict[str, str] = {}
        hyperlink_relationships: dict[str, str] = {}
        for rel in root.findall("rel:Relationship", NS):
            rel_id = rel.attrib.get("Id")
            rel_type = rel.attrib.get("Type")
            target = rel.attrib.get("Target")
            if not rel_id or not target:
                continue
            if rel_type == IMAGE_REL_TYPE:
                image_relationships[rel_id] = target
            elif rel_type == HYPERLINK_REL_TYPE:
                hyperlink_relationships[rel_id] = target
        return image_relationships, hyperlink_relationships

    def _parse_styles(self, archive: zipfile.ZipFile) -> dict[str, StyleInfo]:
        try:
            root = self._load_xml(archive, "word/styles.xml")
        except KeyError:
            return {}

        styles: dict[str, StyleInfo] = {}
        for style in root.findall("w:style", NS):
            style_id = style.attrib.get(qn("w", "styleId"))
            if not style_id:
                continue

            heading_level = None
            outline = style.find("w:pPr/w:outlineLvl", NS)
            if outline is not None:
                raw_level = outline.attrib.get(qn("w", "val"))
                if raw_level is not None and raw_level.isdigit():
                    heading_level = min(int(raw_level) + 1, 6)

            name_el = style.find("w:name", NS)
            style_name = (name_el.attrib.get(qn("w", "val"), "") if name_el is not None else "").lower()
            if heading_level is None:
                match = re.search(r"heading\s*([1-6])", style_name) or re.search(r"heading\s*([1-6])", style_id.lower())
                if match:
                    heading_level = int(match.group(1))
                elif style_name == "title" or style_id.lower() == "title":
                    heading_level = 1
                elif style_name == "subtitle" or style_id.lower() == "subtitle":
                    heading_level = 2
                # 識別雲科大 thesis 常見的「標題樣式」（用於前置區塊如中文摘要、目錄等）
                elif "標題樣式" in style_name and "字元" not in style_name:
                    heading_level = 1

            styles[style_id] = StyleInfo(heading_level=heading_level)

        return styles

    def _parse_numbering(self, archive: zipfile.ZipFile) -> dict[str, dict[int, str]]:
        try:
            root = self._load_xml(archive, "word/numbering.xml")
        except KeyError:
            return {}

        abstract_formats: dict[str, dict[int, str]] = {}
        for abstract in root.findall("w:abstractNum", NS):
            abstract_id = abstract.attrib.get(qn("w", "abstractNumId"))
            if not abstract_id:
                continue
            levels: dict[int, str] = {}
            for level in abstract.findall("w:lvl", NS):
                ilvl_raw = level.attrib.get(qn("w", "ilvl"))
                num_fmt = level.find("w:numFmt", NS)
                if ilvl_raw is None or not ilvl_raw.isdigit() or num_fmt is None:
                    continue
                levels[int(ilvl_raw)] = num_fmt.attrib.get(qn("w", "val"), "bullet")
            abstract_formats[abstract_id] = levels

        number_formats: dict[str, dict[int, str]] = {}
        for num in root.findall("w:num", NS):
            num_id = num.attrib.get(qn("w", "numId"))
            abstract_ref = num.find("w:abstractNumId", NS)
            if not num_id or abstract_ref is None:
                continue
            abstract_id = abstract_ref.attrib.get(qn("w", "val"))
            if abstract_id and abstract_id in abstract_formats:
                number_formats[num_id] = abstract_formats[abstract_id]

        return number_formats

    def _convert_paragraph(self, archive: zipfile.ZipFile, paragraph: ET.Element) -> list[str]:
        segments: list[str | InlineImage] = []
        for child in paragraph:
            segments.extend(self._walk_inline(archive, child))

        blocks: list[str] = []
        text_buffer: list[str] = []

        def flush_text() -> None:
            text = normalize_text("".join(text_buffer))
            text_buffer.clear()
            if text:
                blocks.append(text)

        for segment in segments:
            if isinstance(segment, InlineImage):
                flush_text()
                image_path = self._extract_image(archive, segment.rel_id)
                if image_path:
                    alt_text = segment.alt_text or Path(image_path).stem
                    blocks.append(f"![{alt_text}]({image_path})")
            elif segment == "__PAGE_BREAK__":
                flush_text()
                blocks.append("---")
            else:
                text_buffer.append(segment)

        flush_text()
        if not blocks:
            return []

        heading_level = self._heading_level(paragraph)
        list_info = self._list_info(paragraph)

        if heading_level is not None:
            for index, block in enumerate(blocks):
                if not block.startswith("![") and block != "---":
                    blocks[index] = f'{"#" * heading_level} {block}'
                    break
            return blocks

        if list_info is not None:
            prefix = "- "
            indent = "  " * list_info.level
            for index, block in enumerate(blocks):
                if block.startswith("!["):
                    blocks[index] = f"{indent}{block}"
                elif block == "---":
                    blocks[index] = block
                elif index == 0:
                    blocks[index] = f"{indent}{prefix}{block}"
                else:
                    continuation = block.replace("\n", f"\n{indent}  ")
                    blocks[index] = f"{indent}  {continuation}"
            return blocks

        return blocks

    def _convert_table(self, archive: zipfile.ZipFile, table: ET.Element) -> str:
        rows: list[tuple[list[str], bool]] = []
        for row in table.findall("w:tr", NS):
            cells: list[str] = []
            for cell in row.findall("w:tc", NS):
                cell_parts: list[str] = []
                for paragraph in cell.findall("w:p", NS):
                    segments = []
                    for child in paragraph:
                        segments.extend(self._walk_inline(archive, child))
                    pieces: list[str] = []
                    for segment in segments:
                        if isinstance(segment, InlineImage):
                            image_path = self._extract_image(archive, segment.rel_id)
                            if image_path:
                                pieces.append(f"![{segment.alt_text or Path(image_path).stem}]({image_path})")
                        elif segment == "__PAGE_BREAK__":
                            continue
                        else:
                            pieces.append(segment)
                    text = normalize_text("".join(pieces))
                    if text:
                        cell_parts.append(text)
                cells.append(escape_table_cell("\n".join(cell_parts)))
            if any(cell for cell in cells):
                rows.append((cells, self._row_is_header(row)))

        if not rows:
            return ""

        column_count = max(len(row) for row, _ in rows)
        normalized_rows = [(row + [""] * (column_count - len(row)), is_header) for row, is_header in rows]

        if normalized_rows[0][1]:
            header = normalized_rows[0][0]
            body_rows = [row for row, _ in normalized_rows[1:]]
        else:
            header = [""] * column_count
            body_rows = [row for row, _ in normalized_rows]

        separator = ["---"] * column_count

        lines = [
            "| " + " | ".join(header) + " |",
            "| " + " | ".join(separator) + " |",
        ]
        for row in body_rows:
            lines.append("| " + " | ".join(row) + " |")
        return "\n".join(lines)

    def _walk_inline(self, archive: zipfile.ZipFile, node: ET.Element) -> list[str | InlineImage]:
        tag = self._local_name(node.tag)
        if tag in {"t", "delText", "instrText"}:
            return [node.text or ""]
        if tag == "tab":
            return ["\t"]
        if tag in {"br", "cr"}:
            break_type = node.attrib.get(qn("w", "type"))
            return ["__PAGE_BREAK__"] if break_type == "page" else ["\n"]
        if tag == "noBreakHyphen":
            return ["-"]
        if tag == "softHyphen":
            return ["-"]
        if tag == "drawing":
            return self._extract_inline_images(node)
        if tag == "pict":
            return self._extract_inline_images(node)
        if tag == "hyperlink":
            return self._extract_hyperlink(archive, node)

        items: list[str | InlineImage] = []
        for child in node:
            items.extend(self._walk_inline(archive, child))
        return items

    def _extract_hyperlink(self, archive: zipfile.ZipFile, node: ET.Element) -> list[str | InlineImage]:
        items: list[str | InlineImage] = []
        for child in node:
            items.extend(self._walk_inline(archive, child))

        rel_id = node.attrib.get(qn("r", "id"))
        anchor = node.attrib.get(qn("w", "anchor"))
        href = None
        if rel_id:
            href = self.hyperlink_relationships.get(rel_id)
        elif anchor:
            href = f"#{anchor}"

        if not href:
            return items

        if any(isinstance(item, InlineImage) for item in items):
            return items

        link_text = normalize_text(
            "".join(item for item in items if isinstance(item, str) and item != "__PAGE_BREAK__")
        )
        if not link_text:
            return items
        return [f"[{link_text}]({href})"]

    def _extract_inline_images(self, node: ET.Element) -> list[InlineImage]:
        alt_candidates = [
            node.find(".//wp:docPr", NS),
            node.find(".//pic:cNvPr", NS),
            node.find(".//v:imagedata", NS),
        ]
        alt_text = ""
        for candidate in alt_candidates:
            if candidate is None:
                continue
            # 優先使用 descr 或 title（使用者設定的描述）
            alt_text = (
                candidate.attrib.get("descr")
                or candidate.attrib.get("title")
                or ""
            ).strip()
            if alt_text:
                break
            # name 屬性是 Word 內部物件名稱，過濾掉「圖片 XX」「Picture XX」等模式
            name = candidate.attrib.get("name", "").strip()
            if name and not re.match(r"^(圖片|Picture|Image|图片)\s*\d+$", name, re.IGNORECASE):
                alt_text = name
                break

        images: list[InlineImage] = []
        for blip in node.findall(".//a:blip", NS):
            rel_id = blip.attrib.get(qn("r", "embed"))
            if rel_id:
                images.append(InlineImage(rel_id=rel_id, alt_text=alt_text))
        for imagedata in node.findall(".//v:imagedata", NS):
            rel_id = imagedata.attrib.get(qn("r", "id"))
            if rel_id:
                images.append(InlineImage(rel_id=rel_id, alt_text=alt_text))
        return images

    def _extract_image(self, archive: zipfile.ZipFile, rel_id: str) -> str | None:
        if rel_id in self.image_cache:
            return self.image_cache[rel_id]

        target = self.image_relationships.get(rel_id)
        if not target:
            return None

        internal_path = posixpath.normpath(posixpath.join("word", target))
        if not internal_path.startswith("word/"):
            print(f"警告：忽略不安全的圖片路徑 {target!r}", file=sys.stderr)
            return None

        try:
            data = archive.read(internal_path)
        except KeyError:
            print(f"警告：找不到圖片資源 {internal_path!r}（rel_id={rel_id}）", file=sys.stderr)
            return None

        source_name = Path(target).name
        output_name = self._unique_image_name(source_name)
        output_path = self.image_dir / output_name
        try:
            output_path.write_bytes(data)
        except OSError as exc:
            print(f"警告：寫入圖片 {output_path} 失敗：{exc}", file=sys.stderr)
            return None

        relative_path = output_path.relative_to(self.md_path.parent).as_posix()
        self.image_cache[rel_id] = relative_path
        self.image_count += 1
        return relative_path

    def _unique_image_name(self, filename: str) -> str:
        path = Path(filename)
        stem = path.stem or "image"
        suffix = path.suffix or ".bin"
        count = self.image_name_counts.get(filename, 0)
        self.image_name_counts[filename] = count + 1
        if count == 0:
            return f"{stem}{suffix}"
        return f"{stem}_{count + 1}{suffix}"

    def _heading_level(self, paragraph: ET.Element) -> int | None:
        p_style = paragraph.find("w:pPr/w:pStyle", NS)
        if p_style is not None:
            style_id = p_style.attrib.get(qn("w", "val"))
            if style_id and style_id in self.styles:
                return self.styles[style_id].heading_level

        outline = paragraph.find("w:pPr/w:outlineLvl", NS)
        if outline is not None:
            raw_level = outline.attrib.get(qn("w", "val"))
            if raw_level is not None and raw_level.isdigit():
                return min(int(raw_level) + 1, 6)
        return None

    def _list_info(self, paragraph: ET.Element) -> ListInfo | None:
        num_pr = paragraph.find("w:pPr/w:numPr", NS)
        if num_pr is None:
            return None

        ilvl_el = num_pr.find("w:ilvl", NS)
        num_id_el = num_pr.find("w:numId", NS)
        if ilvl_el is None or num_id_el is None:
            return None

        ilvl_raw = ilvl_el.attrib.get(qn("w", "val"))
        num_id = num_id_el.attrib.get(qn("w", "val"))
        if ilvl_raw is None or num_id is None or not ilvl_raw.isdigit():
            return None

        level = int(ilvl_raw)
        return ListInfo(level=level)

    def _row_is_header(self, row: ET.Element) -> bool:
        return row.find("w:trPr/w:tblHeader", NS) is not None

    def _cleanup_blocks(self, blocks: Iterable[str]) -> str:
        cleaned: list[str] = []
        previous_blank = True
        for block in blocks:
            stripped = block.rstrip()
            if not stripped:
                if not previous_blank:
                    cleaned.append("")
                previous_blank = True
                continue

            if stripped.strip() == "---" and cleaned and cleaned[-1] != "":
                cleaned.append("")
            cleaned.append(stripped)
            previous_blank = False

        text = "\n\n".join(part for part in cleaned if part != "")
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        return text

    @staticmethod
    def _local_name(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="將 DOCX 的文字與圖片提取為 Markdown。")
    parser.add_argument("docx", type=Path, help="來源 DOCX 檔案")
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        help="輸出目錄，預設為來源檔同層的 <檔名>_export",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="若輸出目錄已存在且非空，先清空後再寫入。",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    docx_path: Path = args.docx.expanduser().resolve()
    if not docx_path.exists():
        parser.error(f"找不到檔案：{docx_path}")
    if docx_path.suffix.lower() != ".docx":
        parser.error("來源檔案必須是 .docx")

    output_dir = args.output_dir.expanduser().resolve() if args.output_dir else docx_path.parent / f"{docx_path.stem}_export"
    if args.force and output_dir.exists():
        import shutil
        shutil.rmtree(output_dir)
    converter = DocxToMarkdownConverter(docx_path=docx_path, output_dir=output_dir)
    md_path, image_count = converter.convert()

    print(f"Markdown: {md_path}")
    print(f"圖片數量: {image_count}")
    print(f"圖片目錄: {converter.image_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
