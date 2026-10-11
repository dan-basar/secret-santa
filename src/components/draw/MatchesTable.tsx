import type { AdminMatch } from '@/types/api';
import styles from '@/styles/Draw.module.css';

interface Props {
  matches: AdminMatch[];
  emailsSent: boolean;
  onEditAndRedraw: () => void;
}

// The organizer's matches table, with Edit & Redraw. Group columns appear only
// when someone is in a group
export default function MatchesTable({ matches, emailsSent, onEditAndRedraw }: Props) {
  const hasGroups = matches.some((m) => m.giver_group || m.receiver_group);

  // Grouped people first, by group, then by giver name
  const sorted = [...matches].sort((a, b) => {
    const aGroup = a.giver_group || '';
    const bGroup = b.giver_group || '';
    if (aGroup && !bGroup) return -1;
    if (!aGroup && bGroup) return 1;
    const groupCmp = aGroup.localeCompare(bGroup);
    if (groupCmp !== 0) return groupCmp;
    return a.giver_name.localeCompare(b.giver_name);
  });

  return (
    <section className={`card ${styles.section}`}>
      <div className={styles.matchesTitleRow}>
        <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>Matches</h2>
        <button
          className="btn btn-secondary"
          onClick={onEditAndRedraw}
          disabled={emailsSent}
          title={emailsSent ? 'Emails have already been sent for this draw' : undefined}
        >
          ← Edit &amp; Redraw
        </button>
      </div>
      {emailsSent && (
        <p className={styles.sectionDesc}>
          Edit &amp; Redraw is off because emails have already gone out. A redraw would leave people holding the wrong match.
        </p>
      )}
      <p className={styles.sectionDesc}>
        {matches.length} participant{matches.length !== 1 ? 's' : ''} — each person will give a gift to the person listed beside them.
        Only you can see this table; the shareable link shows names only.
      </p>

      <table className={styles.table}>
        <colgroup>
          {hasGroups ? (
            <>
              <col />
              <col style={{ width: '1px' }} />
              <col style={{ width: '100%' }} />
              <col />
              <col style={{ width: '1px' }} />
            </>
          ) : (
            <>
              <col style={{ width: '50%' }} />
              <col style={{ width: '50%' }} />
            </>
          )}
        </colgroup>
        <thead>
          <tr>
            <th>SECRET SANTA</th>
            {hasGroups && <th className={styles.groupCol}>Group</th>}
            {hasGroups && <th className={styles.spacerCol} />}
            <th>→ Gifting to</th>
            {hasGroups && <th className={styles.groupCol}>Group</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((m, i) => (
            <tr key={i}>
              <td className={styles.nameCell}>
                <span className={styles.name}>{m.giver_name}</span>
                {hasGroups && (
                  <span className={styles.mobileGroup}>
                    <GroupBadge group={m.giver_group} labelled />
                  </span>
                )}
                {m.giver_email && <span className={styles.email}>{m.giver_email}</span>}
              </td>
              {hasGroups && (
                <td className={styles.groupCol}>
                  <GroupBadge group={m.giver_group} />
                </td>
              )}
              {hasGroups && <td className={styles.spacerCol} />}
              <td className={styles.nameCell}>
                <span className={styles.name}>{m.receiver_name}</span>
                {hasGroups && (
                  <span className={styles.mobileGroup}>
                    <GroupBadge group={m.receiver_group} labelled />
                  </span>
                )}
              </td>
              {hasGroups && (
                <td className={styles.groupCol}>
                  <GroupBadge group={m.receiver_group} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// labelled adds "Group: " for the mobile layout, where there is no Group column header
function GroupBadge({ group, labelled = false }: { group: string | null; labelled?: boolean }) {
  if (!group) return <span className={styles.noGroup}>No Group</span>;
  return <span className={styles.groupBadge}>{labelled ? `Group: ${group}` : group}</span>;
}
