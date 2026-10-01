from pathlib import Path
import argparse
from xml.sax.saxutils import escape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer


def render(source, destination):
    styles = getSampleStyleSheet()
    styles['BodyText'].fontSize = 10
    styles['BodyText'].leading = 14
    styles['BodyText'].spaceAfter = 7
    styles['BodyText'].splitLongWords = True
    story = []
    for block in source.read_text(encoding='utf-8').split('\n\n'):
        text = block.strip()
        if not text:
            continue
        if text.startswith('## '):
            story.append(Paragraph(escape(text[3:]), styles['Heading2']))
        elif text.startswith('# '):
            story.append(Paragraph(escape(text[2:]), styles['Title']))
        else:
            story.append(Paragraph(escape(text).replace('\n', '<br/>'), styles['BodyText']))
        story.append(Spacer(1, 3))

    def footer(canvas, doc):
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(colors.HexColor('#37413b'))
        canvas.drawString(40, 25, 'Kantor RPG | PRD v0.1 | Konsep, bukan gambar konstruksi')
        canvas.drawRightString(A4[0] - 40, 25, str(doc.page))

    SimpleDocTemplate(str(destination), pagesize=A4, rightMargin=40, leftMargin=40,
                      topMargin=40, bottomMargin=45,
                      title='Kantor RPG: PRD v0.1', author='Max / Air Buddy').build(
                          story, onFirstPage=footer, onLaterPages=footer)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path('PRD/PRD-v0.1.md'))
    parser.add_argument('--output', type=Path, default=Path('PRD/PRD-v0.1.pdf'))
    args = parser.parse_args()
    render(args.source, args.output)
    print(args.output)
