import { listColumns, listSubtitle, sortedPairs } from '@/lib/match-list';
import { detailLines } from '@/lib/details';
import type { ExchangeDetails, GetDrawResponse } from '@/types/api';
import styles from '@/styles/Draw.module.css';

interface Props {
  draw: GetDrawResponse;
  details: ExchangeDetails;
  organizerName: string; // '' leaves out "Organized by"
}

// What the draw page prints once the matches are shown: a title, the details box if there
// is one and the matches table, in place of the page. Hidden on screen (Draw.module.css)
export default function PrintSheet({ draw, details, organizerName }: Props) {
  const cols = listColumns(draw.participants);
  const pairs = sortedPairs(draw.participants, draw.matches);
  const lines = detailLines(details);

  return (
    <div className={styles.printSheet}>
      <h1 className={styles.printTitle}>Secret Santa matches</h1>
      <p className={styles.printMeta}>{listSubtitle(organizerName, draw.created_at, pairs.length)}</p>
      {lines.length > 0 && (
        <dl className={styles.printDetails}>
          {lines.map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              <dd>{line.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <table className={styles.printTable}>
        <thead>
          <tr>
            <th>Secret Santa</th>
            {cols.groups && <th>Group</th>}
            <th className={styles.printArrow} aria-hidden="true" />
            <th>Gifting to</th>
            {cols.groups && <th>Group</th>}
          </tr>
        </thead>
        <tbody>
          {pairs.map((m, i) => (
            <tr key={i}>
              <td>
                <span className={styles.name}>{m.giver.name}</span>
                {m.giver.email && <span className={styles.printEmail}>{m.giver.email}</span>}
              </td>
              {cols.groups && <td className={m.giver.group_name ? '' : styles.printNoGroup}>{m.giver.group_name || 'No Group'}</td>}
              <td className={styles.printArrow} aria-hidden="true">&rarr;</td>
              <td>
                <span className={styles.name}>{m.receiver.name}</span>
                {m.receiver.email && <span className={styles.printEmail}>{m.receiver.email}</span>}
              </td>
              {cols.groups && <td className={m.receiver.group_name ? '' : styles.printNoGroup}>{m.receiver.group_name || 'No Group'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.printFoot}>Keep this list private! It shows everyone&rsquo;s secret match.</p>
    </div>
  );
}
