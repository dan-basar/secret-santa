import { MAX_PARTICIPANTS } from '@/lib/groups';
import styles from '@/styles/Home.module.css';

// Plain text below the form, so visitors and search engines can tell what the app does
// and answer the questions people search for before trying it
export default function HowItWorks() {
  return (
    <section className={`${styles.section} card ${styles.about}`}>
      <h2 className={styles.sectionTitle}>How it works</h2>
      <ol className={styles.howSteps}>
        <li>
          <strong>Add everyone.</strong> Type each person&rsquo;s name, and an email address if you&rsquo;d like the app
          to tell them who they drew. Up to {MAX_PARTICIPANTS} people.
        </li>
        <li>
          <strong>Keep people apart.</strong> Put couples, families or teams in the same group, and nobody draws someone
          from their own group.
        </li>
        <li>
          <strong>Draw and share.</strong> Draw matches, then email everyone or send each person their own link by text or
          chat. Each person sees only who they drew.
        </li>
      </ol>

      <h2 className={styles.sectionTitle}>Frequently Asked Questions</h2>
      <div className={styles.faq}>
        <h3>Is it free?</h3>
        <p>Yes! There&rsquo;s no sign-up and no account.</p>
        <h3>Do I need everyone&rsquo;s email?</h3>
        <p>No! Emails are fully optional.</p>
        <h3>Can the organizer take part?</h3>
        <p>Yes! Your organizer page keeps the matches hidden unless you choose to show them.</p>
        <h3>Can I set a budget or date?</h3>
        <p>Yes! Add a budget, exchange date, or note after the draw, and everyone sees them with their match.</p>
      </div>
    </section>
  );
}
