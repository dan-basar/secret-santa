import { useRef, type Ref } from 'react';
import { sortedPairs, type MatchPair } from '@/lib/match-list';
import type { AdminMatch, AdminParticipant } from '@/types/api';
import styles from '@/styles/Draw.module.css';

interface Props {
  participants: AdminParticipant[];
  matches: AdminMatch[];
  emailsSent: boolean;
  onEditAndRedraw: () => void;
  shown: boolean; // kept by the page, which also unlocks the save and print card with it
  onShow: () => void;
}

// The organizer's matches table, with Edit & Redraw until emails are sent. Group columns appear only
// when someone is in a group. The table starts hidden: an organizer who is also taking part would
// otherwise see who has them as soon as the page opens
export default function MatchesTable({ participants, matches, emailsSent, onEditAndRedraw, shown, onShow }: Props) {
  const hasGroups = participants.some((p) => p.group_name);
  // Grouped people first, by group, then by giver name
  const sorted = sortedPairs(participants, matches);
  // Set by the Show button so the table takes focus as it appears, the way the button it replaces had it
  const focusTable = useRef(false);

  return (
    <section className={`card ${styles.section}`}>
      <div className={styles.matchesTitleRow}>
        <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>Matches</h2>
        {/* Hidden once emails go out: a redraw would leave people holding the wrong match */}
        {!emailsSent && (
          <button className="btn btn-secondary" onClick={onEditAndRedraw}>
            ← Edit &amp; Redraw
          </button>
        )}
      </div>
      <p className={styles.sectionDesc}>
        {matches.length} participant{matches.length !== 1 ? 's' : ''} — each person will give a gift to the person listed beside them.
        Only you can see this table.
      </p>

      {!shown ? (
        // A blurred stand-in table with made-up names in the real table's shape, so the organizer can see
        // what the button opens. The real names never reach the page until it's pressed: a blur only stops
        // eyes, while find-in-page, copying or a screen reader would still find text underneath
        <div className={styles.matchesLocked}>
          <div className={styles.matchesBlur} aria-hidden="true" inert>
            <PairsTable rows={standInRows(sorted)} hasGroups={hasGroups} />
          </div>
          <div className={styles.matchesHidden}>
            <button className="btn btn-primary" onClick={() => { focusTable.current = true; onShow(); }}>
              Show all matches
            </button>
            <p className={styles.sectionDesc}>
              Taking part yourself? Skip this and open your own personal link below, so the surprise stays a surprise.
            </p>
          </div>
        </div>
      ) : (
        <PairsTable
          rows={sorted}
          hasGroups={hasGroups}
          tableRef={(el) => {
            if (el && focusTable.current) { focusTable.current = false; el.focus(); }
          }}
        />
      )}
    </section>
  );
}

// The table itself, for the real pairs or the blurred stand-ins
function PairsTable({ rows, hasGroups, tableRef }: { rows: MatchPair[]; hasGroups: boolean; tableRef?: Ref<HTMLTableElement> }) {
  return (
    <table className={styles.table} aria-label="Matches" tabIndex={-1} ref={tableRef}>
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
        {rows.map((m, i) => (
          <tr key={i}>
            <td className={styles.nameCell}>
              <span className={styles.name}>{m.giver.name}</span>
              {hasGroups && (
                <span className={styles.mobileGroup}>
                  <GroupBadge group={m.giver.group_name} labelled />
                </span>
              )}
              {m.giver.email && <span className={styles.email}>{m.giver.email}</span>}
            </td>
            {hasGroups && (
              <td className={styles.groupCol}>
                <GroupBadge group={m.giver.group_name} />
              </td>
            )}
            {hasGroups && <td className={styles.spacerCol} />}
            <td className={styles.nameCell}>
              <span className={styles.name}>{m.receiver.name}</span>
              {hasGroups && (
                <span className={styles.mobileGroup}>
                  <GroupBadge group={m.receiver.group_name} labelled />
                </span>
              )}
            </td>
            {hasGroups && (
              <td className={styles.groupCol}>
                <GroupBadge group={m.receiver.group_name} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// One made-up row per real one ("Name1 → Name2"), keeping only whether each cell has a group or an email,
// so the blurred table is the real one's size
function standInRows(rows: MatchPair[]): MatchPair[] {
  const standIn = (p: AdminParticipant, n: number): AdminParticipant => ({
    name: `Name${n}`,
    email: p.email && `name${n}@example.com`,
    group_name: p.group_name && 'Group',
    reveal_code: '',
    email_sent_at: null,
    revealed_at: null,
  });
  return rows.map((m, i) => ({ giver: standIn(m.giver, i + 1), receiver: standIn(m.receiver, ((i + 1) % rows.length) + 1) }));
}

// labelled adds "Group: " for the mobile layout, where there is no Group column header
function GroupBadge({ group, labelled = false }: { group: string | null; labelled?: boolean }) {
  if (!group) return <span className={styles.noGroup}>No Group</span>;
  return <span className={styles.groupBadge}>{labelled ? `Group: ${group}` : group}</span>;
}
