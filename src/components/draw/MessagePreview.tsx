import { budgetLine, formatExchangeDate, noteError } from '@/lib/details';
import styles from '@/styles/Draw.module.css';

interface Props {
  toName: string;
  matchName: string;
  organizerName: string;
  // The details as typed in the details card, which is what the first send sends
  note: string;
  budgetCents: number | null;
  exchangeDate: string;
}

// A live stand-in for the first match email, in the email card above the send button
export default function MessagePreview({ toName, matchName, organizerName, note, budgetCents, exchangeDate }: Props) {
  const trimmedNote = note.trim();
  const showNote = !!trimmedNote && !noteError(trimmedNote);
  const lines = [
    ...(budgetCents !== null ? [{ label: 'Budget', value: budgetLine(budgetCents) }] : []),
    ...(exchangeDate ? [{ label: 'Exchange', value: formatExchangeDate(exchangeDate) }] : []),
  ];
  const hasDetails = !!trimmedNote || lines.length > 0;

  return (
    <div className={`${styles.preview} ${styles.previewInCard}`} aria-live="polite">
      <p className={styles.previewHead}>Message preview</p>
      <p>Hi {toName},</p>
      <p>The Secret Santa draw is done, and your match is below.</p>
      {hasDetails && (
        <>
          <p>First, some details:</p>
          <div className={styles.previewBox}>
            {showNote && (
              <p className="break-anywhere"><strong>A note from your organizer:</strong><br />&ldquo;{trimmedNote}&rdquo;</p>
            )}
            {lines.map((line) => (
              <p key={line.label}><strong>{line.label}:</strong> {line.value}</p>
            ))}
          </div>
          <p className={styles.previewSpaced}>And now the big reveal:</p>
        </>
      )}
      <p className={hasDetails ? styles.previewReveal : `${styles.previewReveal} ${styles.previewSpaced}`}>
        You have drawn <strong>{matchName}</strong>&rsquo;s name for the gift exchange!
      </p>
      <span className={styles.previewButton}>View your match</span>
      <p className={styles.previewFoot}>This secret message was sent by {organizerName || 'your organizer'}.</p>
    </div>
  );
}
