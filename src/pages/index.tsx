import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import { siteUrl } from '@/lib/site';
import { isValidEmail } from '@/lib/email-address';
import { hasLink } from '@/lib/sanitize';
import { FormGroup, FormParticipant, groupNameFor, newId } from '@/lib/groups';
import styles from '@/styles/Home.module.css';
import logo from '../../public/logo.svg';
import type { ApiError, CreateDrawResponse } from '@/types/api';

const MAX_PARTICIPANTS = 50;
const MAX_GROUPS = 20;

const TITLE = 'Secret Santa Picker';
const DESCRIPTION = 'Draw Secret Santa matches and notify everyone by email.';

function emptyParticipant(): FormParticipant {
  return { id: newId(), name: '', email: '', groupId: '' };
}

export default function Home() {
  const router = useRouter();

  // Groups
  const [groups, setGroups] = useState<FormGroup[]>([{ id: newId(), name: '' }]);

  // Participants
  const [participants, setParticipants] = useState<FormParticipant[]>([
    emptyParticipant(),
    emptyParticipant(),
  ]);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Set by Edit & Redraw: the earlier draw stays live until this form submits
  const [replaces, setReplaces] = useState<{ drawId: string; key: string } | null>(null);

  useEffect(() => {
    const draft = sessionStorage.getItem('editDraftData');
    if (draft) {
      sessionStorage.removeItem('editDraftData');
      try {
        const { groups: g, participants: p, replacesDrawId, replacesKey } = JSON.parse(draft);
        // Built by formFromParticipants() on the draw page; skip anything else
        if (!Array.isArray(g) || !g.every((group) => typeof group?.name === 'string')) return;
        if (!Array.isArray(p) || !p.every((person) => typeof person?.groupId === 'string')) return;
        setGroups(g);
        setParticipants(p);
        if (typeof replacesDrawId === 'string' && typeof replacesKey === 'string') {
          setReplaces({ drawId: replacesDrawId, key: replacesKey });
        }
      } catch {
        // ignore malformed data
      }
    }
  }, []);

  // --- Group handlers ---
  const addGroup = () => {
    setGroups((g) => [...g, { id: newId(), name: '' }]);
  };

  // Participants reference groups by id, so a rename carries them along
  const updateGroup = (id: string, name: string) => {
    setGroups((g) => g.map((group) => (group.id === id ? { ...group, name } : group)));
  };

  const removeGroup = (id: string) => {
    setGroups((g) => g.filter((group) => group.id !== id));
    // Clear any participants referencing this group
    setParticipants((ps) =>
      ps.map((p) => (p.groupId === id ? { ...p, groupId: '' } : p))
    );
  };

  // A group with a blank name drops out of the dropdowns until it is named
  // again; its participants keep their groupId but are sent with no group
  const namedGroups = groups.filter((g) => g.name.trim());

  // --- Participant handlers ---
  const addParticipant = () => {
    if (participants.length >= MAX_PARTICIPANTS) return;
    setParticipants((ps) => [...ps, emptyParticipant()]);
  };

  const updateParticipant = (id: string, field: keyof FormParticipant, value: string) => {
    setParticipants((ps) =>
      ps.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const removeParticipant = (id: string) => {
    if (participants.length <= 2) return;
    setParticipants((ps) => ps.filter((p) => p.id !== id));
  };

  // --- Submit ---
  const handleSubmit = useCallback(async () => {
    setError('');

    const filled = participants.filter((p) => p.name.trim() || p.email.trim());
    const invalid = filled.filter(
      (p) => !p.name.trim() || (p.email.trim() && !isValidEmail(p.email.trim()))
    );

    if (filled.length < 2) {
      setError('Please enter at least 2 participants.');
      return;
    }
    if (invalid.length > 0) {
      setError('Please make sure every participant has a valid name and email address.');
      return;
    }
    // Names go into the match emails, so the server refuses web addresses in them
    const linkNames = filled.filter((p) => hasLink(p.name));
    if (linkNames.length > 0) {
      setError(`Names cannot contain web addresses: ${linkNames.map((p) => p.name.trim()).join(', ')}`);
      return;
    }

    const payload = filled.map((p) => ({
      name: p.name.trim(),
      email: p.email.trim(),
      group: groupNameFor(groups, p.groupId),
    }));

    if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
    setStatusMsg('Randomizing...');
    setLoading(true);
    slowTimerRef.current = setTimeout(() => {
      setStatusMsg('Randomizing... Connection to the database is taking longer than usual, please stand by...');
    }, 8000);
    try {
      const res = await fetch(`${router.basePath}/api/create-draw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participants: payload,
          replacesDrawId: replaces?.drawId,
          replacesKey: replaces?.key,
        }),
      });

      if (!res.ok) {
        // An error from Vercel itself (a timeout, say) has no JSON body
        const data: Partial<ApiError> = await res.json().catch(() => ({}));
        // The earlier draw is gone, so there is nothing left to replace;
        // submitting again creates a plain new draw
        if (res.status === 410) setReplaces(null);
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      const data: CreateDrawResponse = await res.json();
      // In the fragment, never the query string, so the key stays out of server logs
      router.push(`/draw/${data.drawId}#key=${encodeURIComponent(data.adminKey)}`);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
      setStatusMsg('');
      setLoading(false);
    }
  }, [participants, groups, replaces, router]);

  const filledCount = participants.filter((p) => p.name.trim()).length;

  return (
    <>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <link rel="canonical" href={siteUrl()} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={TITLE} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:url" content={siteUrl()} />
        <meta property="og:image" content={siteUrl('/og-image.png')} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Secret Santa Picker: draw matches, keep groups apart, and email everyone their person." />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={TITLE} />
        <meta name="twitter:description" content={DESCRIPTION} />
        <meta name="twitter:image" content={siteUrl('/og-image.png')} />
      </Head>

      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <Image src={logo} alt="Secret Santa Picker logo" width={55} height={64} className={styles.logo} priority />
            <div className={styles.heroText}>
              <h1 className={styles.title}>Secret Santa Picker App</h1>
              <p className={styles.subtitle}>
                {/* Each half stays whole, so a wrap can only fall after the comma */}
                <span className={styles.nowrapPart}>Enter your groups and participants,</span>{' '}
                <span className={styles.nowrapPart}>then draw matches.</span>
              </p>
            </div>
            <Image src={logo} alt="" width={55} height={64} className={`${styles.logo} ${styles.logoRight}`} priority />
          </div>
        </header>

        <main className={styles.main}>
          {replaces && (
            <p className={`status-msg ${styles.replaceBanner}`}>
              <span>This will replace your earlier draw. Its links keep working until you draw new matches.</span>
              <Link href={`/draw/${replaces.drawId}#key=${encodeURIComponent(replaces.key)}`}>
                Cancel
              </Link>
            </p>
          )}

          {/* Step 1: Groups */}
          <section className={`${styles.section} card`}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <span className={styles.step}>1</span>
                Groups
              </h2>
              <p className={styles.sectionDesc}>
                Optional. Members of the same group<b> will not </b>be matched with each other.
              </p>
            </div>

            <div className={styles.groupList}>
              {groups.map((g, i) => (
                <div key={g.id} className={styles.groupRow}>
                  <label htmlFor={`group-${i + 1}`} className="visually-hidden">Group {i + 1} name</label>
                  <input
                    id={`group-${i + 1}`}
                    type="text"
                    placeholder={`Group ${i + 1} name`}
                    value={g.name}
                    onChange={(e) => updateGroup(g.id, e.target.value)}
                    maxLength={200}
                  />
                  <button
                    className={`btn btn-secondary ${styles.removeBtn}`}
                    onClick={() => removeGroup(g.id)}
                    title="Remove group"
                    aria-label={`Remove group ${i + 1}`}
                    disabled={groups.length === 1}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button className={`btn btn-secondary ${styles.addBtn}`} onClick={addGroup} disabled={groups.length >= MAX_GROUPS}>
              + Add group
            </button>
          </section>

          {/* Step 2: Participants */}
          <section className={`${styles.section} card`}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <span className={styles.step}>2</span>
                Participants
                <span className={styles.count}>{filledCount} / {MAX_PARTICIPANTS}</span>
              </h2>
              <p className={styles.sectionDesc}>
                Enter each person's name, email, and optionally assign them to a group.
              </p>
            </div>

            {/* Visual column headings; each input has its own label for screen readers */}
            <div className={styles.participantHeader} aria-hidden="true">
              <span>Name</span>
              <span>Group</span>
              <span>Email</span>
              <span />
            </div>

            <div className={styles.participantList}>
              {participants.map((p, i) => (
                <div key={p.id} className={`${styles.participantRow} fade-in`}>
                  <label htmlFor={`person-${i + 1}-name`} className="visually-hidden">Person {i + 1} name</label>
                  <input
                    id={`person-${i + 1}-name`}
                    type="text"
                    placeholder={`Person ${i + 1}`}
                    value={p.name}
                    onChange={(e) => updateParticipant(p.id, 'name', e.target.value)}
                    maxLength={200}
                  />
                  <label htmlFor={`person-${i + 1}-group`} className="visually-hidden">Person {i + 1} group</label>
                  <select
                    id={`person-${i + 1}-group`}
                    value={namedGroups.some((g) => g.id === p.groupId) ? p.groupId : ''}
                    onChange={(e) => updateParticipant(p.id, 'groupId', e.target.value)}
                  >
                    <option value="">No group</option>
                    {namedGroups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name.trim()}</option>
                    ))}
                  </select>
                  <label htmlFor={`person-${i + 1}-email`} className="visually-hidden">Person {i + 1} email</label>
                  <input
                    id={`person-${i + 1}-email`}
                    type="email"
                    placeholder="email (optional)"
                    value={p.email}
                    onChange={(e) => updateParticipant(p.id, 'email', e.target.value)}
                    maxLength={320}
                  />
                  <button
                    className={`btn btn-secondary ${styles.removeBtn}`}
                    onClick={() => removeParticipant(p.id)}
                    disabled={participants.length <= 2}
                    title="Remove participant"
                    aria-label={`Remove person ${i + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {participants.length < MAX_PARTICIPANTS && (
              <button className={`btn btn-secondary ${styles.addBtn}`} onClick={addParticipant}>
                + Add participant
              </button>
            )}
          </section>

          {statusMsg && <p className="status-msg fade-in">{statusMsg}</p>}
          {error && <p className="error-msg fade-in">{error}</p>}

          <div className={styles.submitRow}>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? 'Drawing matches…' : '🎁 Draw matches'}
            </button>
          </div>
        </main>

        <footer className={styles.footer}>
          <p>Matches are randomly generated and saved with a shareable link.</p>
          {/* The policy lives on the root site, outside this app's base path */}
          <p className={styles.footerLink}><a href="/privacy">Privacy policy</a></p>
        </footer>
      </div>
    </>
  );
}