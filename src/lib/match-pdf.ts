import type { jsPDF as JsPdf } from 'jspdf';
import { detailLines, listColumns, listSubtitle, sortedPairs } from '@/lib/match-list';
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

// The PDF's text font. Noto Sans (SIL Open Font License, public/fonts/OFL.txt), cut down
// to Latin, Greek and Cyrillic, so Croatian, Russian or Greek names print as typed. If it
// can't be loaded, jsPDF's built-in Helvetica stands in, which covers only Latin-1 and a
// few more marks (curly quotes, dashes, €)
export interface PdfFonts {
  regular: ArrayBuffer;
  bold: ArrayBuffer;
}
export const PDF_FONT_FILES = { regular: 'noto-sans-pdf-regular.ttf', bold: 'noto-sans-pdf-bold.ttf' };

// What public/fonts/noto-sans-pdf-*.ttf keep (the --unicodes given to pyftsubset; see docs/OPERATIONS.md, PDF font)
const NOTO_RANGES: [number, number][] = [
  [0x20, 0x7e], [0xa0, 0x24f], [0x300, 0x36f], [0x370, 0x3ff], [0x400, 0x52f],
  [0x1e00, 0x1eff], [0x2000, 0x206f], [0x20a0, 0x20cf], [0x2122, 0x2122],
];
const WIN_ANSI_EXTRAS = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const inNoto = (code: number) => NOTO_RANGES.some(([from, to]) => code >= from && code <= to);
const inHelvetica = (ch: string, code: number) =>
  (code >= 0x20 && code <= 0xff && !(code >= 0x7f && code < 0xa0)) || WIN_ANSI_EXTRAS.includes(ch);

// A name is cleaned up for the font first: accents are composed (e + ´ becomes é), tabs and
// line breaks become spaces, invisible marks (zero-width spaces, direction overrides) and
// emoji are left out, and a letter the font doesn't have, such as Chinese, shows as "?".
// A name that was all emoji shows as "?"
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u20e3\ufe00-\ufe0f]/gu;
export function pdfText(text: string, font: 'noto' | 'helvetica' = 'helvetica'): string {
  const cleaned = Array.from(
    text.normalize('NFC').replace(/[\p{Cc}\s]/gu, ' ').replace(/\p{Cf}/gu, '').replace(EMOJI, ''),
    (ch) => {
      const code = ch.codePointAt(0)!;
      return (font === 'noto' ? inNoto(code) : inHelvetica(ch, code)) ? ch : '?';
    },
  ).join('').replace(/ +/g, ' ').trim();
  return cleaned || (text.trim() ? '?' : '');
}

/** Fetches the PDF font from public/fonts; null if it can't be had, so the PDF falls back to Helvetica */
export async function loadPdfFonts(basePath: string): Promise<PdfFonts | null> {
  try {
    const [regular, bold] = await Promise.all([PDF_FONT_FILES.regular, PDF_FONT_FILES.bold].map(async (file) => {
      const res = await fetch(`${basePath}/fonts/${file}`);
      if (!res.ok) throw new Error(`${file}: ${res.status}`);
      return res.arrayBuffer();
    }));
    return { regular, bold };
  } catch {
    return null;
  }
}

// jsPDF takes a font file as a base64 string
function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Loads jsPDF; the page calls it early on phones, where the share sheet must open soon after the tap */
export function loadPdfLibrary() {
  return Promise.all([import('jspdf'), import('jspdf-autotable')]);
}

/** The matches as a US Letter PDF: title, the details box if there is one, then the table */
export async function buildMatchesPdf(
  draw: GetDrawResponse, details: ExchangeDetails, organizerName: string, fonts: PdfFonts | null,
): Promise<JsPdf> {
  const [{ jsPDF }, { autoTable }] = await loadPdfLibrary();
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  let font = 'helvetica';
  if (fonts) {
    doc.addFileToVFS(PDF_FONT_FILES.regular, base64(fonts.regular));
    doc.addFont(PDF_FONT_FILES.regular, 'NotoSans', 'normal');
    doc.addFileToVFS(PDF_FONT_FILES.bold, base64(fonts.bold));
    doc.addFont(PDF_FONT_FILES.bold, 'NotoSans', 'bold');
    font = 'NotoSans';
  }
  const text = (value: string) => pdfText(value, fonts ? 'noto' : 'helvetica');
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

  doc.setFont(font, 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...INK_LIGHT);
  doc.text(text(listSubtitle(organizerName, draw.created_at, pairs.length)).replace(/ · /g, '  ·  '), MARGIN, y, { maxWidth: width });
  y += 22;

  // The details box: a warm panel with an accent bar, as the emails show it
  const lines = detailLines(details);
  if (lines.length > 0) {
    const pad = 12;
    const labelWidth = 62;
    doc.setFontSize(BODY_SIZE);
    const wrapped = lines.map((line) => doc.splitTextToSize(text(line.value), width - pad * 2 - labelWidth - 4) as string[]);
    const lineHeight = BODY_SIZE * LINE_FACTOR;
    const boxHeight = pad * 2 + wrapped.reduce((sum, w) => sum + w.length * lineHeight, 0) + (lines.length - 1) * 4;
    doc.setFillColor(...PAPER_WARM);
    doc.rect(MARGIN, y, width, boxHeight, 'F');
    doc.setFillColor(...ACCENT);
    doc.rect(MARGIN, y, 3, boxHeight, 'F');
    let lineY = y + pad + BODY_SIZE * 0.8;
    lines.forEach((line, i) => {
      doc.setFont(font, 'bold');
      doc.setTextColor(...INK);
      doc.text(line.label, MARGIN + pad, lineY);
      doc.setFont(font, 'normal');
      doc.text(wrapped[i], MARGIN + pad + labelWidth, lineY);
      lineY += wrapped[i].length * lineHeight + 4;
    });
    y += boxHeight + 20;
  }

  const head = ['SECRET SANTA', ...(cols.groups ? ['GROUP'] : []), 'GIFTING TO', ...(cols.groups ? ['GROUP'] : [])];
  // Each name cell's email, drawn smaller and grey under the name, as on the page
  const emails = pairs.map((m) => [m.giver, m.receiver].map((p) => (p.email ? text(p.email) : '')));
  // A blank second line makes room for the email
  const nameCell = (name: string, email: string) => (email ? `${text(name)}\n` : text(name));
  const body = pairs.map((m, i) => [
    nameCell(m.giver.name, emails[i][0]),
    ...(cols.groups ? [text(m.giver.group_name ?? '')] : []),
    nameCell(m.receiver.name, emails[i][1]),
    ...(cols.groups ? [text(m.receiver.group_name ?? '')] : []),
  ]);
  const receiverCol = cols.groups ? 2 : 1;

  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN + 10 },
    theme: 'plain',
    styles: {
      font, fontSize: BODY_SIZE, textColor: INK, cellPadding: { top: 8, bottom: 8, left: 8, right: 8 },
      lineColor: BORDER, overflow: 'linebreak', valign: 'top',
    },
    headStyles: { fontSize: 9, fontStyle: 'bold', textColor: INK },
    columnStyles: cols.groups ? { 1: { cellWidth: 100 }, 3: { cellWidth: 100 } } : {},
    didParseCell: (data) => {
      // A rule under the header and between rows, like the table on the page
      data.cell.styles.lineWidth = data.section === 'head' ? { bottom: 1.5 } : { bottom: 0.5 };
      if (data.section === 'body' && data.row.index === body.length - 1) data.cell.styles.lineWidth = 0;
    },
    didDrawCell: (data) => {
      if (data.section !== 'body' || (data.column.index !== 0 && data.column.index !== receiverCol)) return;
      // autoTable also draws a stand-in row (index -1) when it measures a page break
      const email = emails[data.row.index]?.[data.column.index === 0 ? 0 : 1];
      if (!email) return;
      // The blank last line kept for it, below a name that may wrap onto several lines
      const emailLine = data.cell.text.length - 1;
      doc.setFont(font, 'normal');
      // A long address is set smaller to stay on its one line
      const room = data.cell.width - data.cell.padding('horizontal');
      doc.setFontSize(EMAIL_SIZE);
      const size = Math.max(6, Math.min(EMAIL_SIZE, (EMAIL_SIZE * room) / doc.getTextWidth(email)));
      doc.setFontSize(size);
      doc.setTextColor(...INK_LIGHT);
      doc.text(email, data.cell.x + data.cell.padding('left'), data.cell.y + data.cell.padding('top') + emailLine * BODY_SIZE * LINE_FACTOR + size * 0.85);
    },
  });

  // On every page: a reminder that the list gives the game away, and the page number
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont(font, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK_LIGHT);
    doc.text('Keep this list private! It shows everyone’s secret match.', MARGIN, pageHeight - MARGIN + 14);
    if (pages > 1) doc.text(`Page ${page} of ${pages}`, pageWidth - MARGIN, pageHeight - MARGIN + 14, { align: 'right' });
  }

  return doc;
}
