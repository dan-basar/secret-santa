import type { jsPDF as JsPdf } from 'jspdf';
import { detailLines, listColumns, sortedPairs } from '@/lib/match-list';
import type { GetDrawResponse, ExchangeDetails } from '@/types/api';

// The organizer's list of matches as a PDF (F6), made in the browser so nobody's
// names or emails leave it. jsPDF loads only when the organizer asks for the PDF

// The page's colors from globals.css, as RGB
const INK: [number, number, number] = [26, 23, 20];
const INK_LIGHT: [number, number, number] = [107, 101, 96];
const BORDER: [number, number, number] = [228, 223, 217];
const PAPER_WARM: [number, number, number] = [242, 237, 230];
const ACCENT: [number, number, number] = [200, 75, 47];

const MARGIN = 54; // points: 3/4 inch
const BODY_SIZE = 10.5;
const EMAIL_SIZE = 8.5;
const LINE_FACTOR = 1.15; // jsPDF's default line height

// jsPDF's built-in fonts cover Latin-1 and a few more marks (curly quotes, dashes, €).
// Anything else would print as garbage: an emoji is left out, and a letter from another script shows as "?"
const WIN_ANSI_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function pdfText(text: string): string {
  return Array.from(text.replace(/[\p{Extended_Pictographic}‍️]/gu, ''), (ch) => {
    const code = ch.codePointAt(0)!;
    return (code >= 0x20 && code <= 0xff && !(code >= 0x7f && code < 0xa0)) || WIN_ANSI_EXTRAS.includes(ch) ? ch : '?';
  }).join('').replace(/\s+/g, ' ').trim();
}

/** The matches as a US Letter PDF: title, the details box if there is one, then the table */
export async function buildMatchesPdf(draw: GetDrawResponse, details: ExchangeDetails): Promise<JsPdf> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const width = pageWidth - MARGIN * 2;
  const cols = listColumns(draw.participants);
  const pairs = sortedPairs(draw.participants, draw.matches);

  doc.setProperties({ title: 'Secret Santa matches' });

  let y = MARGIN;
  doc.setFont('times', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...INK);
  doc.text('Secret Santa matches', MARGIN, y + 16);
  y += 34;

  const created = new Date(draw.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...INK_LIGHT);
  doc.text(`Draw created ${created}  ·  ${pairs.length} participant${pairs.length !== 1 ? 's' : ''}`, MARGIN, y);
  y += 22;

  // The details box: a warm panel with an accent bar, as the emails show it
  const lines = detailLines(details);
  if (lines.length > 0) {
    const pad = 12;
    const labelWidth = 62;
    doc.setFontSize(BODY_SIZE);
    const wrapped = lines.map((line) => doc.splitTextToSize(pdfText(line.value), width - pad * 2 - labelWidth - 4) as string[]);
    const lineHeight = BODY_SIZE * LINE_FACTOR;
    const boxHeight = pad * 2 + wrapped.reduce((sum, w) => sum + w.length * lineHeight, 0) + (lines.length - 1) * 4;
    doc.setFillColor(...PAPER_WARM);
    doc.rect(MARGIN, y, width, boxHeight, 'F');
    doc.setFillColor(...ACCENT);
    doc.rect(MARGIN, y, 3, boxHeight, 'F');
    let lineY = y + pad + BODY_SIZE * 0.8;
    lines.forEach((line, i) => {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...INK);
      doc.text(line.label, MARGIN + pad, lineY);
      doc.setFont('helvetica', 'normal');
      doc.text(wrapped[i], MARGIN + pad + labelWidth, lineY);
      lineY += wrapped[i].length * lineHeight + 4;
    });
    y += boxHeight + 20;
  }

  const head = ['SECRET SANTA', ...(cols.groups ? ['GROUP'] : []), 'GIFTING TO', ...(cols.groups ? ['GROUP'] : [])];
  // Each name cell's email, drawn smaller and grey under the name, as on the page
  const emails = pairs.map((m) => [m.giver, m.receiver].map((p) => (p.email ? pdfText(p.email) : '')));
  // A blank second line makes room for the email
  const nameCell = (name: string, email: string) => (email ? `${pdfText(name)}\n` : pdfText(name));
  const body = pairs.map((m, i) => [
    nameCell(m.giver.name, emails[i][0]),
    ...(cols.groups ? [pdfText(m.giver.group_name || 'No group')] : []),
    nameCell(m.receiver.name, emails[i][1]),
    ...(cols.groups ? [pdfText(m.receiver.group_name || 'No group')] : []),
  ]);
  const groupCols = cols.groups ? [1, 3] : [];
  const receiverCol = cols.groups ? 2 : 1;

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN + 10 },
    theme: 'plain',
    styles: {
      font: 'helvetica', fontSize: BODY_SIZE, textColor: INK, cellPadding: { top: 8, bottom: 8, left: 8, right: 8 },
      lineColor: BORDER, overflow: 'linebreak', valign: 'top',
    },
    headStyles: { fontSize: 9, fontStyle: 'bold', textColor: INK },
    columnStyles: cols.groups ? { 1: { cellWidth: 100 }, 3: { cellWidth: 100 } } : {},
    didParseCell: (data) => {
      // A rule under the header and between rows, like the table on the page
      data.cell.styles.lineWidth = data.section === 'head' ? { bottom: 1.5 } : { bottom: 0.5 };
      if (data.section === 'body' && data.row.index === body.length - 1) data.cell.styles.lineWidth = 0;
      if (data.section === 'body' && groupCols.includes(data.column.index) && data.cell.raw === 'No group') {
        data.cell.styles.textColor = INK_LIGHT;
        data.cell.styles.fontStyle = 'italic';
      }
    },
    didDrawCell: (data) => {
      if (data.section !== 'body' || (data.column.index !== 0 && data.column.index !== receiverCol)) return;
      // autoTable also draws a stand-in row (index -1) when it measures a page break
      const email = emails[data.row.index]?.[data.column.index === 0 ? 0 : 1];
      if (!email) return;
      doc.setFont('helvetica', 'normal');
      // A long address is set smaller to stay on its one line
      const room = data.cell.width - data.cell.padding('horizontal');
      doc.setFontSize(EMAIL_SIZE);
      const size = Math.max(6, Math.min(EMAIL_SIZE, (EMAIL_SIZE * room) / doc.getTextWidth(email)));
      doc.setFontSize(size);
      doc.setTextColor(...INK_LIGHT);
      doc.text(email, data.cell.x + data.cell.padding('left'), data.cell.y + data.cell.padding('top') + BODY_SIZE * LINE_FACTOR + size * 0.85);
    },
  });

  // On every page: a reminder that the list gives the game away, and the page number
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK_LIGHT);
    doc.text('Keep this list private! It shows everyone’s secret match.', MARGIN, pageHeight - MARGIN + 14);
    if (pages > 1) doc.text(`Page ${page} of ${pages}`, pageWidth - MARGIN, pageHeight - MARGIN + 14, { align: 'right' });
  }

  return doc;
}
