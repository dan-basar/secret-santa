import { useState } from 'react';
import type { AdminParticipant } from '@/types/api';
import styles from '@/styles/Draw.module.css';

interface Props {
  participants: AdminParticipant[];
  emailsSent: boolean;
  linkFor: (revealToken: string) => string;
}

// Each participant's personal reveal link, for the organizer to send by text or chat
export default function PersonalLinks({ participants, emailsSent, linkFor }: Props) {
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const handleCopy = (token: string) => {
    navigator.clipboard.writeText(linkFor(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken((current) => (current === token ? null : current)), 2000);
  };

  return (
    <section className={`card ${styles.section}`}>
      <h2 className={styles.sectionTitle}>Personal links</h2>
      <p className={styles.sectionDesc}>
        Each link shows one person only who they drew. Send each person their own link by text or chat.
        {emailsSent ? ' Everyone the emails reached already has theirs.' : ' The emails below include these links too.'}
      </p>
      <ul className={styles.personalLinks}>
        {participants.map((p, i) => (
          <li key={i} className={styles.personalLinkRow}>
            <div className={styles.personalLinkText}>
              <span className={styles.name}>{p.name}</span>
              <span className={styles.shareUrl}>{linkFor(p.reveal_token)}</span>
            </div>
            <button className="btn btn-secondary" onClick={() => handleCopy(p.reveal_token)}>
              {copiedToken === p.reveal_token ? '✓ Copied' : 'Copy'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
