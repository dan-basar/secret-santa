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
    <section className={`card ${styles.section}`}>
      <h2 className={styles.sectionTitle}>Your organizer link</h2>
      <p className={styles.sectionDesc}>
        Keep it private: it shows everyone&rsquo;s matches! It&rsquo;s the only way back to this page.
      </p>
      <div className={styles.organizerLinkRow}>
        <span className={styles.shareUrl}>{url}</span>
        <button className="btn btn-secondary" onClick={handleCopy}>
          {copyState === 'copied' ? '✓ Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy link'}
        </button>
      </div>
    </section>
  );
}
