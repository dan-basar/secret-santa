import { useState } from 'react';
import styles from '@/styles/Draw.module.css';

// The organizer's own link, with a copy button. Until it's shown here it lives
// only in the address bar, where it's easy to lose or to share by mistake
export default function OrganizerLink({ url }: { url: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  // Clipboard access can be refused (permissions, an insecure page), so say
  // "Copied" only once the write has succeeded
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  };

  return (
    <div className={`card ${styles.organizerLink}`}>
      <div>
        <p className={styles.organizerLinkLabel}>Your organizer link</p>
        <p className={styles.organizerLinkNote}>
          Keep it private: it shows everyone&rsquo;s matches! It&rsquo;s the only way back to this page.
        </p>
        <p className={styles.shareUrl}>{url}</p>
      </div>
      <button className="btn btn-secondary" onClick={handleCopy}>
        {copyState === 'copied' ? '✓ Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy link'}
      </button>
    </div>
  );
}
