from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from tooling.scripts.extract_docx_to_md import DocxToMarkdownConverter


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def document_xml(body: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W_NS}" xmlns:r="{R_NS}" xmlns:a="{A_NS}" xmlns:pic="{PIC_NS}" xmlns:wp="{WP_NS}">
  <w:body>
    {body}
    <w:sectPr />
  </w:body>
</w:document>
"""


def numbering_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="{W_NS}">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet" /></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="bullet" /></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0" />
  </w:num>
</w:numbering>
"""


def ordered_numbering_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="{W_NS}">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:numFmt w:val="decimal" /></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0" />
  </w:num>
</w:numbering>
"""


def relationships_xml(entries: list[tuple[str, str, str]]) -> str:
    rels = "\n".join(
        f'  <Relationship Id="{rel_id}" Type="{rel_type}" Target="{target}" />'
        for rel_id, rel_type, target in entries
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="{REL_NS}">
{rels}
</Relationships>
"""


def heading_paragraph(text: str, level: int) -> str:
    return f"""
    <w:p>
      <w:pPr><w:outlineLvl w:val="{level - 1}" /></w:pPr>
      <w:r><w:t>{text}</w:t></w:r>
    </w:p>
    """


class ExtractDocxToMarkdownTests(unittest.TestCase):
    def create_docx(self, directory: Path, name: str, files: dict[str, str | bytes]) -> Path:
        docx_path = directory / name
        with zipfile.ZipFile(docx_path, "w") as archive:
            for archive_name, content in files.items():
                archive.writestr(archive_name, content)
        return docx_path

    def convert(self, docx_path: Path, output_dir: Path) -> tuple[str, int]:
        converter = DocxToMarkdownConverter(docx_path=docx_path, output_dir=output_dir)
        md_path, image_count = converter.convert()
        return md_path.read_text(encoding="utf-8"), image_count

    def test_nested_lists_preserve_indentation(self) -> None:
        body = """
        <w:p>
          <w:pPr><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1" /></w:numPr></w:pPr>
          <w:r><w:t>父項目</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:numPr><w:ilvl w:val="1" /><w:numId w:val="1" /></w:numPr></w:pPr>
          <w:r><w:t>子項目</w:t></w:r>
        </w:p>
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = self.create_docx(
                root,
                "nested-list.docx",
                {
                    "word/document.xml": document_xml(body),
                    "word/numbering.xml": numbering_xml(),
                },
            )
            markdown, _ = self.convert(docx_path, root / "out")

        self.assertIn("- 父項目", markdown)
        self.assertIn("  - 子項目", markdown)

    def test_ordered_lists_are_rendered_as_unordered_bullets(self) -> None:
        body = """
        <w:p>
          <w:pPr><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1" /></w:numPr></w:pPr>
          <w:r><w:t>第一項</w:t></w:r>
        </w:p>
        <w:p>
          <w:pPr><w:numPr><w:ilvl w:val="0" /><w:numId w:val="1" /></w:numPr></w:pPr>
          <w:r><w:t>第二項</w:t></w:r>
        </w:p>
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = self.create_docx(
                root,
                "ordered-list.docx",
                {
                    "word/document.xml": document_xml(body),
                    "word/numbering.xml": ordered_numbering_xml(),
                },
            )
            markdown, _ = self.convert(docx_path, root / "out")

        self.assertIn("- 第一項", markdown)
        self.assertIn("- 第二項", markdown)
        self.assertNotIn("1. 第一項", markdown)

    def test_hyperlinks_are_rendered_as_markdown_links(self) -> None:
        hyperlink_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
        body = """
        <w:p>
          <w:hyperlink r:id="rIdHyper">
            <w:r><w:t>OpenAI</w:t></w:r>
          </w:hyperlink>
        </w:p>
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = self.create_docx(
                root,
                "hyperlink.docx",
                {
                    "word/document.xml": document_xml(body),
                    "word/_rels/document.xml.rels": relationships_xml(
                        [("rIdHyper", hyperlink_type, "https://openai.com")]
                    ),
                },
            )
            markdown, _ = self.convert(docx_path, root / "out")

        self.assertIn("[OpenAI](https://openai.com)", markdown)

    def test_table_without_header_does_not_consume_first_row_as_header(self) -> None:
        body = """
        <w:tbl>
          <w:tr>
            <w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>
          </w:tr>
          <w:tr>
            <w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = self.create_docx(
                root,
                "no-header-table.docx",
                {"word/document.xml": document_xml(body)},
            )
            markdown, _ = self.convert(docx_path, root / "out")

        self.assertIn("|  |  |", markdown)
        self.assertIn("| A1 | B1 |", markdown)
        self.assertIn("| A2 | B2 |", markdown)

    def test_missing_image_is_ignored_without_crashing(self) -> None:
        image_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
        body = """
        <w:p>
          <w:r>
            <w:drawing>
              <wp:inline>
                <wp:docPr id="1" name="Broken Image" />
                <a:graphic>
                  <a:graphicData>
                    <pic:pic>
                      <pic:blipFill>
                        <a:blip r:embed="rIdImage" />
                      </pic:blipFill>
                    </pic:pic>
                  </a:graphicData>
                </a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = self.create_docx(
                root,
                "missing-image.docx",
                {
                    "word/document.xml": document_xml(body),
                    "word/_rels/document.xml.rels": relationships_xml(
                        [("rIdImage", image_type, "media/missing.png")]
                    ),
                },
            )
            markdown, image_count = self.convert(docx_path, root / "out")

        self.assertEqual(image_count, 0)
        self.assertEqual(markdown.strip(), "")

    def test_thesis_headings_are_canonicalized_without_duplicate_prefixes(self) -> None:
        body = (
            heading_paragraph("中文摘要", 1)
            + """
            <w:p><w:r><w:t>摘要內容。</w:t></w:r></w:p>
            """
            + heading_paragraph("目錄", 1)
            + heading_paragraph("第一章 第一章 開發計畫", 1)
            + heading_paragraph("第一節 第一節 發展的動機", 2)
            + heading_paragraph("1.1.1 1.1.1 中小企業 ERP 使用的痛點", 3)
            + heading_paragraph("分析與設計", 1)
            + heading_paragraph("設計", 2)
            + heading_paragraph("資料庫設計", 3)
            + heading_paragraph("核心資料表設計", 4)
            + heading_paragraph("第四章 結論", 1)
            + heading_paragraph("第二節 未來展望", 2)
            + heading_paragraph("第五章 專題心得與檢討", 1)
            + heading_paragraph("組員心得", 2)
            + heading_paragraph("附錄", 1)
            + heading_paragraph("附錄 A：工具規格", 2)
            + heading_paragraph("A.1 驗證案例", 3)
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            docx_path = self.create_docx(
                root,
                "thesis.docx",
                {"word/document.xml": document_xml(body)},
            )
            markdown, _ = self.convert(docx_path, root / "out")

        self.assertIn("# 第一章 開發計畫", markdown)
        self.assertNotIn("# 第一章 第一章 開發計畫", markdown)
        self.assertIn("## 第一節 發展的動機", markdown)
        self.assertNotIn("## 第一節 第一節 發展的動機", markdown)
        self.assertIn("### 1.1.1 中小企業 ERP 使用的痛點", markdown)
        self.assertIn("# 第二章 分析與設計", markdown)
        self.assertIn("## 第一節 設計", markdown)
        self.assertIn("### 2.1.1 資料庫設計", markdown)
        self.assertIn("#### 2.1.1.1 核心資料表設計", markdown)
        self.assertIn("# 第三章 結論", markdown)
        self.assertIn("## 第一節 未來展望", markdown)
        self.assertIn("# 第四章 專題心得與檢討", markdown)
        self.assertIn("## 第一節 組員心得", markdown)
        self.assertIn("# 附錄", markdown)
        self.assertIn("## 附錄 A：工具規格", markdown)
        self.assertIn("### A.1 驗證案例", markdown)


if __name__ == "__main__":
    unittest.main()
