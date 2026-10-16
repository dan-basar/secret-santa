import type { GetDrawResponse } from '@/types/api';
import { isValidEmail } from '@/lib/email-address';
import { hasLink } from '@/lib/sanitize';
import { noteError, parseBudget } from '@/lib/details';
import TurnstileWidget from '@/components/draw/TurnstileWidget';
import MessagePreview from '@/components/draw/MessagePreview';
import styles from '@/styles/Draw.module.css';

interface Props {
  draw: GetDrawResponse;
  // People with an email address who haven't been sent one
  unsentCount: number;
  organizerName: string;
  organizerEmail: string;
  onOrganizerNameChange: (value: string) => void;
  onOrganizerEmailChange: (value: string) => void;
  // The optional exchange details as typed in the details card, sent with the first send
  organizerNote: string;
  budget: string;
  exchangeDate: string;
  loading: boolean;
  error: string;
  // After a first send: whether the organizer's own link was emailed to them
  organizerLinkNotice: string;
  // Changes after each send, so the CAPTCHA remounts with a fresh token
  turnstileKey: number;
  onTurnstileToken: (token: string) => void;
  hasTurnstileToken: boolean;
  onSend: (retryFailed: boolean) => void;
}

// Email notifications: the first send (which also emails the organizer their
// link, or only that when nobody has an email), then a resend for anyone not
// reached, then a confirmation once everyone has their email. Before the first
// send it previews the match email with the details typed in the card above
export default function EmailSection(props: Props) {
  const { draw, unsentCount, organizerLinkNotice } = props;

  let content;
  if (!draw.emails_sent_at) {
    content = <FirstSendForm {...props} />;
  } else if (unsentCount > 0) {
    content = <ResendForm {...props} />;
  } else {
    const sentDate = new Date(draw.emails_sent_at).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    content = (
      <p className="success-msg">
        ✓ Emails were sent on {sentDate}. Each participant with an email address has been notified of their match.
      </p>
    );
  }

  return (
    <section className={`card ${styles.section}`}>
      <h2 className={styles.sectionTitle}>Email notifications</h2>
      {organizerLinkNotice && (
        <p className={organizerLinkNotice.startsWith('✓') ? 'success-msg' : 'error-msg'} style={{ marginTop: 12 }}>
          {organizerLinkNotice}
        </p>
      )}
      {content}
    </section>
  );
}

function FirstSendForm({
  draw, organizerName, organizerEmail, onOrganizerNameChange, onOrganizerEmailChange,
  organizerNote, budget, exchangeDate, loading, error, turnstileKey, onTurnstileToken, hasTurnstileToken, onSend,
}: Props) {
  const emailCount = draw.participants.filter((p) => p.email).length;
  const hasEmails = emailCount > 0;
  const name = organizerName.trim();
  const email = organizerEmail.trim();
  const emailInvalid = email.length > 0 && !isValidEmail(email);
  // The name goes into every email, so the server refuses a web address in it
  const nameHasLink = hasLink(name);
  const budgetCents = parseBudget(budget);
  const detailsOk = !noteError(organizerNote.trim()) && budgetCents !== 'invalid';
  const canSend = name.length > 0 && !nameHasLink && email.length > 0 && !emailInvalid && detailsOk;

  // The preview shows the first person with an email and their match, as the organizer already sees them all
  const firstWithEmail = draw.participants.findIndex((p) => p.email);
  const firstMatch = draw.matches.find((m) => m.giver === firstWithEmail);

  return (
    <>
      {hasEmails ? (
        <p className={styles.sectionDesc}>
          {`Send each participant an email revealing who they drew. This can only be done once. ${emailCount} of ${draw.participants.length} participant${draw.participants.length !== 1 ? 's' : ''} have an email address. You'll get your organizer link by email too.`}
        </p>
      ) : (
        <>
          <p className={styles.sectionDesc} style={{ marginBottom: 8 }}>
            No participants have an email address, so there are no match emails to send.
          </p>
          <p className={styles.sectionDesc}>Enter your name and email to get your organizer link by email. A note, budget or date you save above shows on each personal link.</p>
        </>
      )}
      <div className={styles.organizerFields}>
        <div className={styles.organizerField}>
          <label className={styles.organizerLabel} htmlFor="organizerName">Organizer Name</label>
          <input
            id="organizerName"
            type="text"
            className={styles.organizerInput}
            value={organizerName}
            onChange={(e) => onOrganizerNameChange(e.target.value)}
            placeholder="Your name"
            maxLength={200}
            disabled={loading}
          />
          {nameHasLink && (
            <p className={styles.organizerFieldError}>Your name can&rsquo;t contain a web address.</p>
          )}
        </div>
        <div className={styles.organizerField}>
          <label className={styles.organizerLabel} htmlFor="organizerEmail">Organizer Email</label>
          <input
            id="organizerEmail"
            type="email"
            className={styles.organizerInput}
            value={organizerEmail}
            onChange={(e) => onOrganizerEmailChange(e.target.value)}
            placeholder="your@email.com"
            maxLength={320}
            disabled={loading}
          />
          {emailInvalid && (
            <p className={styles.organizerFieldError}>Please enter a valid email address.</p>
          )}
        </div>
      </div>
      {hasEmails && firstMatch && (
        <MessagePreview
          toName={draw.participants[firstWithEmail].name}
          matchName={draw.participants[firstMatch.receiver].name}
          organizerName={name}
          note={organizerNote}
          budgetCents={typeof budgetCents === 'number' ? budgetCents : null}
          exchangeDate={exchangeDate}
        />
      )}
      {error && <p className="error-msg" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <TurnstileWidget key={turnstileKey} onToken={onTurnstileToken} />
        <button
          className="btn btn-success"
          onClick={() => onSend(false)}
          disabled={loading || !canSend || !hasTurnstileToken}
          title={!name || !email ? 'Enter your name and email to send' : !detailsOk ? 'Fix the note or budget above to send' : undefined}
        >
          {loading ? 'Sending…' : hasEmails
            ? `📧 Send emails to ${emailCount} participant${emailCount !== 1 ? 's' : ''}`
            : '📧 Email me my organizer link'}
        </button>
      </div>
    </>
  );
}

function ResendForm({ draw, unsentCount, loading, error, turnstileKey, onTurnstileToken, hasTurnstileToken, onSend }: Props) {
  const emailCount = draw.participants.filter((p) => p.email).length;
  const notDelivered = draw.participants.filter((p) => p.email && !p.email_sent_at).map((p) => p.name);

  return (
    <>
      <p className="error-msg" style={{ marginBottom: 12 }}>
        Sent to {emailCount - unsentCount} of {emailCount}. Not delivered: {notDelivered.join(', ')}
      </p>
      <p className={styles.sectionDesc}>
        Resend tries again for just {unsentCount === 1 ? 'this person' : 'these people'}. Everyone else already has their email.
        You can also send {unsentCount === 1 ? 'them their' : 'each of them their'} personal link below.
      </p>
      {error && <p className="error-msg" role="alert" style={{ marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <TurnstileWidget key={turnstileKey} onToken={onTurnstileToken} />
        <button
          className="btn btn-success"
          onClick={() => onSend(true)}
          disabled={loading || !hasTurnstileToken}
        >
          {loading ? 'Sending…' : `📧 Resend to ${unsentCount} participant${unsentCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </>
  );
}
