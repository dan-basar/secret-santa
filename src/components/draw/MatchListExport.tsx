import { useState } from 'react';
import { exportFileName, matchesCsv } from '@/lib/match-list';
import type { ExchangeDetails, GetDrawResponse } from '@/types/api';
import styles from '@/styles/Draw.module.css';

interface Props {
  draw: GetDrawResponse;
  details: ExchangeDetails; // the note, budget and date as the email card holds them
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
export default function MatchListExport({ draw, details, shown }: Props) {
  const [pdfState, setPdfState] = useState<'idle' | 'saving' | 'failed'>('idle');
  const fileName = exportFileName(draw.created_at);

  const handleCsv = () => {
    // The byte order mark tells Excel the file is UTF-8, so accented names come through
    saveFile(new Blob(['\ufeff' + matchesCsv(draw.participants, draw.matches)], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`);
  };

  const handlePdf = async () => {
    setPdfState('saving');
    try {
      const { buildMatchesPdf } = await import('@/lib/match-pdf');
      const doc = await buildMatchesPdf(draw, details);
      saveFile(doc.output('blob'), `${fileName}.pdf`);
      setPdfState('idle');
    } catch {
      setPdfState('failed');
    }
  };

  return (
    <section className={`card ${styles.section} ${shown ? '' : styles.exportLocked}`} aria-labelledby="exportTitle">
      <h2 className={styles.sectionTitle} id="exportTitle">Save or print the matches</h2>
      <p className={styles.sectionDesc}>
        {shown
          ? 'Download the list as a spreadsheet (CSV), save it as a PDF, or print it. Like the table above, it shows everyone’s match, so keep it to yourself.'
          : 'Click Show all matches above to save or print the list.'}
      </p>
      <div className={styles.exportActions}>
        <button className="btn btn-secondary" onClick={handleCsv} disabled={!shown}>
          Download CSV
        </button>
        <button className="btn btn-secondary" onClick={handlePdf} disabled={!shown || pdfState === 'saving'}>
          {pdfState === 'saving' ? 'Saving…' : 'Save PDF'}
        </button>
        {/* The page prints as the PrintSheet beside it once the matches are shown */}
        <button className="btn btn-secondary" onClick={() => window.print()} disabled={!shown}>
          Print
        </button>
      </div>
      {pdfState === 'failed' && (
        <p className="error-msg" style={{ marginTop: 12 }}>The PDF couldn&rsquo;t be made. Please try again, or use Print and choose Save as PDF.</p>
      )}
    </section>
  );
}
