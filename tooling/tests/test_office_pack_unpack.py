from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from tooling.scripts.office.pack import pack_docx_directory
from tooling.scripts.office.unpack import unpack_docx


class OfficePackUnpackTests(unittest.TestCase):
    def create_docx(self, docx_path: Path) -> None:
        with zipfile.ZipFile(docx_path, "w") as archive:
            archive.writestr("[Content_Types].xml", "<types />")
            archive.writestr("_rels/.rels", "<rels />")
            archive.writestr("word/document.xml", "<document>v1</document>")
            archive.writestr("word/styles.xml", "<styles />")

    def test_unpack_then_pack_preserves_original_entry_order(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            original_docx = root / "original.docx"
            unpacked_dir = root / "unpacked"
            output_docx = root / "repacked.docx"

            self.create_docx(original_docx)
            unpack_docx(original_docx, unpacked_dir)

            (unpacked_dir / "word" / "document.xml").write_text(
                "<document>v2</document>",
                encoding="utf-8",
            )
            custom_dir = unpacked_dir / "custom"
            custom_dir.mkdir()
            (custom_dir / "note.txt").write_text("custom", encoding="utf-8")

            pack_docx_directory(unpacked_dir, output_docx, original_docx=original_docx)

            with zipfile.ZipFile(output_docx) as archive:
                self.assertEqual(
                    archive.namelist(),
                    [
                        "[Content_Types].xml",
                        "_rels/.rels",
                        "word/document.xml",
                        "word/styles.xml",
                        "custom/note.txt",
                    ],
                )
                self.assertEqual(
                    archive.read("word/document.xml").decode("utf-8"),
                    "<document>v2</document>",
                )
                self.assertEqual(
                    archive.read("word/styles.xml").decode("utf-8"),
                    "<styles />",
                )
                self.assertEqual(
                    archive.read("custom/note.txt").decode("utf-8"),
                    "custom",
                )


if __name__ == "__main__":
    unittest.main()
