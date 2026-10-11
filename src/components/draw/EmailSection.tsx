import type { RefObject } from 'react';
import type { AdminDraw } from '@/types/api';
import { isValidEmail } from '@/lib/email-address';
import styles from '@/styles/Draw.module.css';

interface Props {
  draw: AdminDraw;
  // People with an email address who haven't been sent one
  unsentCount: number;
  organizerName: string;
  organizerEmail: string;
  onOrganizerNameChange: (value: string) => void;
  onOrganizerEmailChange: (value: string) => void;
  loading: boolean;
  error: string;
  // The page renders the Turnstile widget into this; it sits in whichever form is showing
  turnstileRef: RefObject<HTMLDivElement>;
  hasTurnstileToken: boolean;
  onSend: (retryFailed: boolean) => void;
}

// Email notifications: the first send, then a resend for anyone not reached,
// then a confirmation once everyone has their email
export default function EmailSection(props: Props) {
  const { draw, unsentCount } = props;

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
      {content}
    </section>
  );
}

function FirstSendForm({
  draw, organizerName, organizerEmail, onOrganizerNameChange, onOrganizerEmailChange,
  loading, error, turnstileRef, hasTurnstileToken, onSend,
}: Props) {
  const emailCount = draw.participants.filter((p) => p.email).length;
  const hasEmails = emailCount > 0;
  const name = organizerName.trim();
  const email = organizerEmail.trim();
  const emailInvalid = email.length > 0 && !isValidEmail(email);
  const canSend = hasEmails && name.length > 0 && email.length > 0 && !emailInvalid;

  return (
    <>
      <p className={styles.sectionDesc}>
        {hasEmails
          ? `Send each participant an email revealing who they drew. This can only be done once. ${emailCount} of ${draw.participants.length} participant${draw.participants.length !== 1 ? 's' : ''} have an email address.`
          : 'No participants have an email address. Add emails to participants to enable this feature.'}
      </p>
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
            disabled={loading}
          />
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
            disabled={loading}
          />
          {emailInvalid && (
            <p className={styles.organizerFieldError}>Please enter a valid email address.</p>
          )}
        </div>
      </div>
      {name && (
        <p className={styles.organizerPreview}>
          Preview: <em>&ldquo;This secret message was sent by <strong>{name}</strong>.&rdquo;</em>
        </p>
      )}
      {error && <p className="error-msg" style={{ marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div ref={turnstileRef} />
        <button
          className="btn btn-success"
          onClick={() => onSend(false)}
          disabled={loading || !canSend || !hasTurnstileToken}
          title={!hasEmails ? 'No participants have an email address' : !name || !email ? 'Enter your name and email to send' : undefined}
        >
          {loading ? 'Sending…' : `📧 Send emails to ${emailCount} participant${emailCount !== 1 ? 's' : ''}`}
        </button>
      </div>
    </>
  );
}

function ResendForm({ draw, unsentCount, loading, error, turnstileRef, hasTurnstileToken, onSend }: Props) {
  const emailCount = draw.participants.filter((p) => p.email).length;
  const notDelivered = draw.participants.filter((p) => p.email && !p.email_sent_at).map((p) => p.name);

  return (
    <>
      <p className="error-msg" style={{ marginBottom: 12 }}>
        Sent to {emailCount - unsentCount} of {emailCount}. Not delivered: {notDelivered.join(', ')}
      </p>
      <p className={styles.sectionDesc}>
        Resend tries again for just {unsentCount === 1 ? 'this person' : 'these people'}. Everyone else already has their email.
        You can also send {unsentCount === 1 ? 'them their' : 'each of them their'} personal link above.
      </p>
      {error && <p className="error-msg" style={{ marginBottom: 12 }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div ref={turnstileRef} />
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
