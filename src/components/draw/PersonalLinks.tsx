import { useState } from 'react';
import type { AdminParticipant } from '@/types/api';
import styles from '@/styles/Draw.module.css';

interface Props {
  participants: AdminParticipant[];
  emailsSent: boolean;
  linkFor: (revealToken: string) => string;
}

// What the Text button fills in; the link goes last so the messages app shows a preview of it
function textMessage(name: string, link: string): string {
  return `Hi ${name}, your Secret Santa match is ready: ${link}`;
}

// Each participant's personal reveal link, for the organizer to send by text or chat.
// On phones a Text button opens the messages app with the link filled in
export default function PersonalLinks({ participants, emailsSent, linkFor }: Props) {
  const hasEmails = participants.some((p) => p.email);
  // The row whose copy button last settled, and whether the write worked
  const [copied, setCopied] = useState<{ token: string; ok: boolean } | null>(null);

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
      <ul className={styles.personalLinks}>
        {participants.map((p, i) => (
          <li key={i} className={styles.personalLinkRow}>
            <div className={styles.personalLinkText}>
              <span className={styles.name}>{p.name}</span>
              <span className={styles.shareUrl}>{linkFor(p.reveal_code)}</span>
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
        ))}
      </ul>
    </section>
  );
}
