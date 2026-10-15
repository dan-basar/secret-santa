import { useState } from 'react';
import { useRouter } from 'next/router';
import { exportFileName, matchesCsv } from '@/lib/match-list';
import type { ExchangeDetails, GetDrawResponse } from '@/types/api';
import styles from '@/styles/Draw.module.css';

interface Props {
  draw: GetDrawResponse;
  details: ExchangeDetails; // the note, budget and date as the email card holds them
  organizerName: string; // for the "Organized by" line; '' when there is none
  shown: boolean; // whether the organizer has opened the matches table
}

// Hands the browser a file to save: a download on computers, the share or Files
// sheet on phones
function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers read the file after click() returns
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// The card below the personal links for taking the matches away: a CSV download, a PDF
// and printing. Faded and disabled until Show all matches, so it never gives the list
// away to an organizer who is taking part
export default function MatchListExport({ draw, details, organizerName, shown }: Props) {
  const router = useRouter();
  const [pdfState, setPdfState] = useState<'idle' | 'saving' | 'failed'>('idle');
  const fileName = exportFileName(draw.created_at);

  const handleCsv = () => {
    // The byte order mark tells Excel the file is UTF-8, so accented names come through
    saveFile(new Blob(['\ufeff' + matchesCsv(draw.participants, draw.matches)], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`);
  };

  const makePdf = async () => {
    const { buildMatchesPdf, loadPdfFonts } = await import('@/lib/match-pdf');
    const fonts = await loadPdfFonts(router.basePath);
    return (await buildMatchesPdf(draw, details, organizerName, fonts)).output('blob');
  };

  const handlePdf = async () => {
    setPdfState('saving');
    try {
      saveFile(await makePdf(), `${fileName}.pdf`);
      setPdfState('idle');
    } catch {
      setPdfState('failed');
    }
  };

  // Phones: the PDF goes to the share sheet, which can save it to Files or send it.
  // Where files can't be shared, or the sheet won't open, the PDF downloads instead
  const handleShare = async () => {
    setPdfState('saving');
    try {
      const blob = await makePdf();
      const file = new File([blob], `${fileName}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Secret Santa matches' });
        } catch (err) {
          // AbortError: the organizer closed the sheet
          if ((err as Error).name !== 'AbortError') saveFile(blob, file.name);
        }
      } else {
        saveFile(blob, file.name);
      }
      setPdfState('idle');
    } catch {
      setPdfState('failed');
    }
  };

  return (
    <section className={`card ${styles.section} ${shown ? '' : styles.exportLocked}`} aria-labelledby="exportTitle">
      <h2 className={styles.sectionTitle} id="exportTitle">Save or print your Secret Santa</h2>
      <p className={styles.sectionDesc}>Export the full list of secret matches.</p>
      {/* Computers get CSV, PDF and Print; phones and tablets get Share and Print (Draw.module.css) */}
      <div className={styles.exportActions}>
        <button className={`btn btn-secondary ${styles.sharePdf}`} onClick={handleShare} disabled={!shown || pdfState === 'saving'}>
          {pdfState === 'saving' ? 'Making PDF…' : 'Share'}
        </button>
        <button className={`btn btn-secondary ${styles.desktopExport}`} onClick={handleCsv} disabled={!shown}>
          Download CSV
        </button>
        <button className={`btn btn-secondary ${styles.desktopExport}`} onClick={handlePdf} disabled={!shown || pdfState === 'saving'}>
          {pdfState === 'saving' ? 'Saving…' : 'Save PDF'}
        </button>
        {/* The page prints as the PrintSheet beside it once the matches are shown */}
        <button className="btn btn-secondary" onClick={() => window.print()} disabled={!shown}>
          Print
        </button>
      </div>
      {pdfState === 'failed' && (
        <p className="error-msg" style={{ marginTop: 12 }}>The PDF couldn&rsquo;t be made. Please try again.</p>
      )}
    </section>
  );
}
