import { useState } from 'react';
import type { AdminParticipant } from '@/types/api';
import { isValidEmail } from '@/lib/email-address';
import styles from '@/styles/Draw.module.css';

interface Props {
  participants: AdminParticipant[];
  emailsSent: boolean;
  linkFor: (revealToken: string) => string;
  // Resends to one person whose email didn't go out, to a corrected address when given
  onResend: (person: number, email?: string) => void;
  // False while a send is running or until the security check in the email card has a token
  canResend: boolean;
  // The person a resend from this list is running for, and the last one's error
  resendingPerson: number | null;
  resendError: { person: number; message: string } | null;
}

// One line under each name: whether their email went out and whether they've opened their link
function statusFor(p: AdminParticipant, emailsSent: boolean): { text: string; failed: boolean } | null {
  const parts: string[] = [];
  let failed = false;
  if (!p.email) parts.push('No email address');
  else if (p.email_sent_at) parts.push(`✓ Emailed to ${p.email}`);
  else if (emailsSent) {
    parts.push(`Not delivered to ${p.email}`);
    failed = true;
  }
  if (p.revealed_at) parts.push('Opened their link');
  return parts.length ? { text: parts.join(' · '), failed } : null;
}

// What the Text button fills in; the link goes last so the messages app shows a preview of it
function textMessage(name: string, link: string): string {
  return `Hi ${name}, your Secret Santa match is ready: ${link}`;
}

// Each participant's personal reveal link, for the organizer to send by text or chat.
// On phones a Text button opens the messages app with the link filled in. After the
// emails go out, each row says whether that person's email went out and whether they
// have opened their link; a row whose email failed can resend it, or fix the address
// and send to that
export default function PersonalLinks({ participants, emailsSent, linkFor, onResend, canResend, resendingPerson, resendError }: Props) {
  const hasEmails = participants.some((p) => p.email);
  // The row whose copy button last settled, and whether the write worked
  const [copied, setCopied] = useState<{ token: string; ok: boolean } | null>(null);
  // The row whose address is being corrected, and the address as typed
  const [editing, setEditing] = useState<{ person: number; email: string } | null>(null);

  // Clipboard access can be refused, so say "Copied" only once the write succeeded
  const handleCopy = async (token: string) => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(linkFor(token));
    } catch {
      ok = false;
    }
    setCopied({ token, ok });
    setTimeout(() => setCopied((current) => (current?.token === token ? null : current)), 2000);
  };

  return (
    <section className={`card ${styles.section}`}>
      <h2 className={styles.sectionTitle}>Personal links</h2>
      <p className={styles.sectionDesc}>
        Each link shows one person only who they drew. Send each person their own link by text or chat.
        {emailsSent ? ' Everyone the emails reached already has theirs.' : hasEmails ? ' The emails above include these links too.' : ''}
      </p>
      {!canResend && resendingPerson === null && emailsSent && participants.some((p) => p.email && !p.email_sent_at) && (
        <p className={styles.sectionDesc}>Resend becomes available once the security check in Email notifications above has finished.</p>
      )}
      <ul className={styles.personalLinks}>
        {participants.map((p, i) => {
          const status = statusFor(p, emailsSent);
          const typed = editing?.person === i ? editing.email.trim() : '';
          const typedValid = isValidEmail(typed);
          return (
            <li key={i} className={styles.personalLinkRow}>
              <div className={styles.personalLinkText}>
                <span className={styles.name}>{p.name}</span>
                <span className={styles.shareUrl}>{linkFor(p.reveal_code)}</span>
                {status && (
                  <span className={`${styles.linkStatus} ${status.failed ? styles.linkStatusFailed : ''} break-anywhere`}>{status.text}</span>
                )}
                {status?.failed && (editing?.person === i ? (
                  <div className={styles.fixEmail}>
                    <label htmlFor={`fix-email-${i}`} className="visually-hidden">{p.name}&rsquo;s email</label>
                    <input
                      id={`fix-email-${i}`}
                      type="email"
                      className={styles.organizerInput}
                      value={editing.email}
                      onChange={(e) => setEditing({ person: i, email: e.target.value })}
                      maxLength={320}
                      aria-invalid={(typed.length > 0 && !typedValid) || undefined}
                    />
                    <button
                      className="btn btn-success"
                      disabled={!canResend || !typedValid}
                      onClick={() => { onResend(i, typed); setEditing(null); }}
                    >
                      Save &amp; send
                    </button>
                    <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                ) : (
                  <div className={styles.fixEmail}>
                    <button className="btn btn-success" disabled={!canResend} onClick={() => onResend(i)}>
                      {resendingPerson === i ? 'Sending…' : 'Resend'}
                    </button>
                    <button className="btn btn-secondary" disabled={resendingPerson !== null} onClick={() => setEditing({ person: i, email: p.email ?? '' })}>
                      Change email
                    </button>
                  </div>
                ))}
                {resendError?.person === i && <p className="error-msg" role="alert">{resendError.message}</p>}
              </div>
              <div className={styles.personalLinkActions}>
                <button className="btn btn-secondary" onClick={() => handleCopy(p.reveal_code)}>
                  <svg className={styles.phoneIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="9" width="12" height="12" rx="2" />
                    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
                  </svg>
                  {copied?.token === p.reveal_code ? (copied.ok ? '✓ Copied' : 'Copy failed') : 'Copy'}
                </button>
                {/* "?&body=" is the form both iPhone and Android read; no number, so they pick who */}
                <a
                  className={`btn btn-secondary ${styles.textLink}`}
                  href={`sms:?&body=${encodeURIComponent(textMessage(p.name, linkFor(p.reveal_code)))}`}
                  aria-label={`Text ${p.name} their link`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z" />
                  </svg>
                  Text
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
