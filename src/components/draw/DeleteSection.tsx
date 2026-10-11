import { useState } from 'react';
import styles from '@/styles/Draw.module.css';

interface Props {
  onDelete: () => Promise<void>;
  loading: boolean;
  error: string;
}

// Soft-deletes the draw after a confirm step
export default function DeleteSection({ onDelete, loading, error }: Props) {
  const [confirming, setConfirming] = useState(false);

  const handleConfirm = async () => {
    await onDelete();
    setConfirming(false);
  };

  return (
    <section className={`card ${styles.section} ${styles.dangerSection}`}>
      <h2 className={styles.sectionTitle}>Delete this draw</h2>
      <p className={styles.sectionDesc}>
        Permanently removes access to this draw. The shareable link and every personal link will stop working.
        This cannot be undone.
      </p>
      {error && <p className="error-msg" style={{ marginBottom: 12 }}>{error}</p>}

      {!confirming ? (
        <button className="btn btn-danger" onClick={() => setConfirming(true)}>
          Delete draw
        </button>
      ) : (
        <div className={styles.confirmRow}>
          <p className={styles.confirmText}>Are you sure? This cannot be undone.</p>
          <div className={styles.confirmBtns}>
            <button
              className="btn btn-danger"
              onClick={handleConfirm}
              disabled={loading}
            >
              {loading ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
