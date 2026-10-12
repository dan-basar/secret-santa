import { useState } from 'react';
import styles from '@/styles/Draw.module.css';

interface Props {
  onDelete: () => Promise<void>;
  loading: boolean;
  error: string;
}

// Soft-deletes the draw; the button stays off until the organizer ticks the checkbox
export default function DeleteSection({ onDelete, loading, error }: Props) {
  const [confirmed, setConfirmed] = useState(false);

  const handleDelete = async () => {
    await onDelete();
    setConfirmed(false);
  };

  return (
    <section className={`card ${styles.section} ${styles.dangerSection}`}>
      <h2 className={styles.sectionTitle}>Delete this draw</h2>
      <p className={styles.sectionDesc}>
        Permanently removes access to this draw. The shareable link and every personal link will stop working.
      </p>
      {error && <p className="error-msg" style={{ marginBottom: 12 }}>{error}</p>}

      <div className={styles.confirmRow}>
        <label className={styles.confirmCheck}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          This cannot be undone.
        </label>
        <div>
          <button className="btn btn-danger" onClick={handleDelete} disabled={!confirmed || loading}>
            {loading ? 'Deleting…' : 'Delete draw'}
          </button>
        </div>
      </div>
    </section>
  );
}
