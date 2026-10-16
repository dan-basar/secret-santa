import type { ExchangeDetails } from '@/types/api';
import { budgetLine, formatExchangeDate, hasDetails } from '@/lib/details';
import ExchangeDetailsFields from '@/components/draw/ExchangeDetailsFields';
import styles from '@/styles/Draw.module.css';

interface Props {
  // What's saved on the server: shown read-only once the emails have gone out
  saved: ExchangeDetails;
  emailsSent: boolean;
  note: string;
  budget: string;
  exchangeDate: string;
  onNoteChange: (value: string) => void;
  onBudgetChange: (value: string) => void;
  onExchangeDateChange: (value: string) => void;
  // Whether what's typed differs from what's saved
  unsaved: boolean;
  // Whether what's typed can be saved (no note or budget the server would refuse)
  valid: boolean;
  saving: boolean;
  // While emails are being sent
  disabled: boolean;
  error: string;
  onSave: () => void;
}

// The note, budget and date card above the email card. Save puts them on each
// personal link page without sending anything; the first send saves them too, and
// after it they are locked, as they now match the emails that went out
export default function DetailsCard(props: Props) {
  const { saved, emailsSent, unsaved, valid, saving, disabled, error, onSave } = props;

  if (emailsSent) {
    if (!hasDetails(saved)) return null;
    return (
      <section className={`card ${styles.section}`}>
        <h2 className={styles.sectionTitle}>Note, budget and date</h2>
        <dl className={styles.detailsSent} aria-label="Details sent">
          {saved.organizer_note && <><dt>Note</dt><dd>{saved.organizer_note}</dd></>}
          {saved.budget_cents !== null && <><dt>Budget</dt><dd>{budgetLine(saved.budget_cents)}</dd></>}
          {saved.exchange_date && <><dt>Exchange</dt><dd>{formatExchangeDate(saved.exchange_date)}</dd></>}
        </dl>
      </section>
    );
  }

  return (
    <section className={`card ${styles.section} ${styles.detailsCard}`} aria-label="Note, budget and date">
      <ExchangeDetailsFields
        note={props.note}
        budget={props.budget}
        exchangeDate={props.exchangeDate}
        onNoteChange={props.onNoteChange}
        onBudgetChange={props.onBudgetChange}
        onExchangeDateChange={props.onExchangeDateChange}
        disabled={disabled || saving}
        unsaved={unsaved}
      >
        <div className={styles.detailsSave}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onSave}
            disabled={disabled || saving || !unsaved || !valid}
          >
            {saving ? 'Saving…' : 'Save details'}
          </button>
          <span className={unsaved ? styles.detailsSaveStatus : `${styles.detailsSaveStatus} ${styles.detailsSaved}`} aria-live="polite">
            {unsaved ? 'Not saved yet' : hasDetails(saved) ? '✓ Saved' : ''}
          </span>
        </div>
        <p className={styles.detailsSaveHint}>Saved details show on each personal link, with or without emails.</p>
        {error && <p className="error-msg" role="alert">{error}</p>}
      </ExchangeDetailsFields>
    </section>
  );
}
