import { useRef, useState } from 'react';
import {
  NOTE_MAX_LENGTH, budgetLine, formatBudget, formatExchangeDate, noteError, parseBudget, shortExchangeDate,
} from '@/lib/details';
import styles from '@/styles/Draw.module.css';

interface Props {
  note: string;
  budget: string; // as typed, without the "$"
  exchangeDate: string; // YYYY-MM-DD, or '' for no date
  onNoteChange: (value: string) => void;
  onBudgetChange: (value: string) => void;
  onExchangeDateChange: (value: string) => void;
  disabled: boolean;
  // What the first match email will look like; left out when nobody has an email
  preview: { toName: string; matchName: string; organizerName: string } | null;
}

// The folded "Add a note, budget, or date" row of the email card, with a live
// preview of the match email beside the fields. The values live in the page,
// which sends them with the first send; this keeps only whether it's open
export default function ExchangeDetailsFields({
  note, budget, exchangeDate, onNoteChange, onBudgetChange, onExchangeDateChange, disabled, preview,
}: Props) {
  const [open, setOpen] = useState(false);
  const dateInput = useRef<HTMLInputElement>(null);

  const trimmedNote = note.trim();
  const badNote = noteError(trimmedNote);
  const budgetCents = parseBudget(budget);
  const badBudget = budgetCents === 'invalid';
  const cents = typeof budgetCents === 'number' ? budgetCents : null;

  // All lowercase; "note added" leads only once a note is typed
  const summary = [
    ...(trimmedNote ? ['note added'] : []),
    cents !== null ? formatBudget(cents) : badBudget ? `$${budget.trim()}` : 'no $ limit',
    exchangeDate ? shortExchangeDate(exchangeDate) : 'no date',
  ].join(' · ');

  const previewLines = [
    ...(cents !== null ? [{ label: 'Budget', value: budgetLine(cents) }] : []),
    ...(exchangeDate ? [{ label: 'Exchange', value: formatExchangeDate(exchangeDate) }] : []),
  ];
  const previewHasDetails = !!trimmedNote || previewLines.length > 0;

  const openPicker = () => {
    const input = dateInput.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      // Older browsers: let the person type the date instead
      input.focus();
    }
  };

  return (
    <div className={styles.details}>
      <button
        type="button"
        className={styles.detailsToggle}
        aria-expanded={open}
        aria-controls="exchangeDetails"
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.detailsChevron} aria-hidden="true">▸</span>
        <span>Add a note, budget, or date</span>
        <span className={styles.detailsSummary}><span className={styles.detailsDot}>· </span>{summary}</span>
      </button>

      <div id="exchangeDetails" className={preview ? styles.detailsBody : styles.detailsBodySingle} hidden={!open}>
        <div className={styles.detailsFields}>
          <div className={styles.organizerField}>
            <label className={styles.organizerLabel} htmlFor="organizerNote">Organizer Note</label>
            <textarea
              id="organizerNote"
              className={`${styles.organizerInput} ${styles.noteInput}`}
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="Where and when, dress code, anything everyone should know"
              maxLength={NOTE_MAX_LENGTH}
              rows={3}
              disabled={disabled}
              aria-invalid={!!badNote}
            />
            <div className={styles.noteFooter}>
              {badNote && <p className={styles.organizerFieldError}>{badNote}</p>}
              <span className={styles.noteCount}>{note.length} / {NOTE_MAX_LENGTH}</span>
            </div>
          </div>

          <div className={styles.organizerField}>
            <span className={styles.organizerLabel} id="budgetLabel">Budget</span>
            <div className={styles.seg} role="group" aria-labelledby="budgetLabel">
              <button
                type="button"
                className={styles.segNone}
                aria-pressed={!budget.trim()}
                onClick={() => onBudgetChange('')}
                disabled={disabled}
              >
                No budget set
              </button>
              <label className={`${styles.segPart} ${budget.trim() ? styles.segPartOn : ''}`}>
                <span aria-hidden="true">$</span>
                <input
                  className={styles.segInput}
                  inputMode="decimal"
                  value={budget}
                  onChange={(e) => onBudgetChange(e.target.value)}
                  placeholder="Amount"
                  aria-label="Budget in dollars"
                  maxLength={12}
                  disabled={disabled}
                  aria-invalid={badBudget}
                />
              </label>
            </div>
            {badBudget && (
              <p className={styles.organizerFieldError}>Enter a dollar amount up to $10,000, like 25 or 25.50.</p>
            )}
          </div>

          <div className={styles.organizerField}>
            <span className={styles.organizerLabel} id="dateLabel">Exchange date</span>
            <div className={styles.seg} role="group" aria-labelledby="dateLabel">
              <button
                type="button"
                className={styles.segNone}
                aria-pressed={!exchangeDate}
                onClick={() => onExchangeDateChange('')}
                disabled={disabled}
              >
                No date
              </button>
              <div className={`${styles.segPart} ${exchangeDate ? styles.segPartOn : ''}`}>
                <button type="button" className={styles.calendarButton} onClick={openPicker} aria-label="Open calendar" disabled={disabled}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4.5" width="18" height="17" rx="2" />
                    <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
                    <path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" />
                  </svg>
                </button>
                <input
                  ref={dateInput}
                  type="date"
                  className={`${styles.segInput} ${styles.dateInput}`}
                  value={exchangeDate}
                  onChange={(e) => onExchangeDateChange(e.target.value)}
                  aria-label="Date of the exchange"
                  disabled={disabled}
                />
              </div>
            </div>
          </div>
        </div>

        {preview && (
          <div className={styles.preview} aria-live="polite">
            <p className={styles.previewHead}>Message preview</p>
            <p>Hi {preview.toName},</p>
            <p>The Secret Santa draw is done, and your match is below.</p>
            {previewHasDetails && (
              <>
                <p>First, some details:</p>
                <div className={styles.previewBox}>
                  {trimmedNote && !badNote && (
                    <p className="break-anywhere"><strong>A note from your organizer:</strong><br />&ldquo;{trimmedNote}&rdquo;</p>
                  )}
                  {previewLines.map((line) => (
                    <p key={line.label}><strong>{line.label}:</strong> {line.value}</p>
                  ))}
                </div>
                <p className={styles.previewSpaced}>And now the big reveal:</p>
              </>
            )}
            <p className={previewHasDetails ? styles.previewReveal : `${styles.previewReveal} ${styles.previewSpaced}`}>
              You have drawn <strong>{preview.matchName}</strong>&rsquo;s name for the gift exchange!
            </p>
            <span className={styles.previewButton}>View your match</span>
            <p className={styles.previewFoot}>This secret message was sent by {preview.organizerName || 'your organizer'}.</p>
          </div>
        )}
      </div>
    </div>
  );
}
