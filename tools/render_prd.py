"""Render a PRD markdown file to PDF (planning document, not a drawing).

Supports '# ' title, '## ' headings, '- ' bullet blocks and paragraphs.
Footer carries version, the concept disclaimer and 'page x / y'.

Usage: python3 tools/render_prd.py --source PRD/PRD-v0.2.md --output PRD/PRD-v0.2.pdf
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.kantor.fonts import font_source_note, register  # noqa: E402

INK = colors.HexColor("#22302a")
GREEN = colors.HexColor("#1f4d3a")


def _inline(text: str) -> str:
    """Escape, then turn `code` spans into a monospace-free emphasis."""
    t = escape(text)
    return re.sub(r"`([^`]+)`", r"<font color='#1f4d3a'>\1</font>", t)


class NumberedCanvas(rl_canvas.Canvas):
    """Two-pass canvas so the footer can print the total page count."""

    footer_left = ""
    font = "Helvetica"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self.setFont(self.font, 8)
            self.setFillColor(INK)
            self.drawString(40, 25, self.footer_left)
            self.drawRightString(A4[0] - 40, 25, f"halaman {self._pageNumber} / {total}")
            super().showPage()
        super().save()


def render(source: Path, destination: Path) -> int:
    fonts = register()
    base = fonts["KR-Sans"]
    bold = fonts["KR-Sans-Bold"]
    styles = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=styles["BodyText"], fontName=base, fontSize=10.5, leading=14.5, spaceAfter=6,
                          textColor=INK, splitLongWords=True)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontName=bold, fontSize=13.5, leading=17, textColor=GREEN,
                        spaceBefore=10, spaceAfter=5)
    title = ParagraphStyle("title", parent=styles["Title"], fontName=bold, fontSize=24, leading=28, textColor=GREEN)
    text = source.read_text(encoding="utf-8")
    version = re.search(r"PRD v(\d+\.\d+)", text)
    version = version.group(1) if version else "?"
    story = []
    for block in text.split("\n\n"):
        block = block.strip()
        if not block:
            continue
        if block.startswith("## "):
            story.append(Paragraph(_inline(block[3:]), h2))
        elif block.startswith("# "):
            story.append(Paragraph(_inline(block[2:]), title))
        elif all(line.startswith("- ") for line in block.splitlines()):
            items = [ListItem(Paragraph(_inline(line[2:]), body), leftIndent=12) for line in block.splitlines()]
            story.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=12, bulletFontName=base))
        else:
            story.append(Paragraph(_inline(block).replace("\n", "<br/>"), body))
        story.append(Spacer(1, 2))
    story.append(Spacer(1, 8))
    story.append(Paragraph(_inline(font_source_note(fonts)) + " Dokumen perencanaan, bukan gambar CAD atau blueprint.", body))

    NumberedCanvas.footer_left = f"Kantor RPG | PRD v{version} | Konsep, bukan gambar konstruksi"
    NumberedCanvas.font = base
    doc = SimpleDocTemplate(str(destination), pagesize=A4, rightMargin=44, leftMargin=44, topMargin=42, bottomMargin=48,
                            title=f"Kantor RPG: PRD v{version}", author="Max / Air Buddy; revisi Claude Code cloud",
                            subject="Product requirements, konsep", creator="tools/render_prd.py (ReportLab)")
    doc.build(story, canvasmaker=NumberedCanvas)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path("PRD/PRD-v0.2.md"))
    parser.add_argument("--output", type=Path, default=Path("PRD/PRD-v0.2.pdf"))
    args = parser.parse_args()
    render(args.source, args.output)
    print(args.output)
