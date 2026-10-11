import { useState } from 'react';
import styles from '@/styles/Draw.module.css';

// The draw's shareable link (names only), with a copy button
export default function ShareBar({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`card ${styles.shareBar}`}>
      <div>
        <p className={styles.shareLabel}>Shareable link</p>
        <p className={styles.shareUrl}>{url}</p>
      </div>
      <button className="btn btn-secondary" onClick={handleCopy}>
        {copied ? '✓ Copied' : 'Copy link'}
      </button>
    </div>
  );
}
