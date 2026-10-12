import { useState } from 'react';
import styles from '@/styles/Draw.module.css';

// The draw's shareable link (names only), with a copy button
export default function ShareBar({ url }: { url: string }) {
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
    <div className={`card ${styles.shareBar}`}>
      <div>
        <p className={styles.shareLabel}>Shareable link</p>
        <p className={styles.shareUrl}>{url}</p>
      </div>
      <button className="btn btn-secondary" onClick={handleCopy}>
        {copyState === 'copied' ? '✓ Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy link'}
      </button>
    </div>
  );
}
