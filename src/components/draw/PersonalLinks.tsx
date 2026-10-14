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
  return `Hi ${name}! Here's your Secret Santa link. Tap it to see who you drew, and keep it to yourself: ${link}`;
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
              <span className={styles.shareUrl}>{linkFor(p.reveal_token)}</span>
            </div>
            <div className={styles.personalLinkActions}>
              <button className="btn btn-secondary" onClick={() => handleCopy(p.reveal_token)}>
                {copied?.token === p.reveal_token ? (copied.ok ? '✓ Copied' : 'Copy failed') : 'Copy'}
              </button>
              {/* "?&body=" is the form both iPhone and Android read; no number, so they pick who */}
              <a
                className={`btn btn-secondary ${styles.textLink}`}
                href={`sms:?&body=${encodeURIComponent(textMessage(p.name, linkFor(p.reveal_token)))}`}
                aria-label={`Text ${p.name} their link`}
              >
                Text
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
