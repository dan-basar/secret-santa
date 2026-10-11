import styles from '@/styles/Draw.module.css';

// What the shared link shows: names only. Pairings stay private; each person
// sees their own match through their personal link
export default function ParticipantList({ participants }: { participants: { name: string }[] }) {
  return (
    <section className={`card ${styles.section}`}>
      <h2 className={styles.sectionTitle}>Participants</h2>
      <p className={styles.sectionDesc}>
        {participants.length} participant{participants.length !== 1 ? 's' : ''} in this draw. Matches are private:
        each person sees only who they drew, through their own personal link. If you don&rsquo;t have yours,
        ask your organizer for your personal link.
      </p>
      <ul className={styles.participantList}>
        {participants.map((p, i) => (
          <li key={i} className={styles.name}>{p.name}</li>
        ))}
      </ul>
    </section>
  );
}
