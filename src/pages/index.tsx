import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import styles from '@/styles/Home.module.css';

interface Participant {
  id: string;
  name: string;
  email: string;
  group: string;
}

const MAX_PARTICIPANTS = 50;

function generateId() {
  return Math.random().toString(36).slice(2);
}

function emptyParticipant(): Participant {
  return { id: generateId(), name: '', email: '', group: '' };
}

export default function Home() {
  const router = useRouter();

  // Groups
  const [groups, setGroups] = useState<string[]>(['']);

  // Participants
  const [participants, setParticipants] = useState<Participant[]>([
    emptyParticipant(),
    emptyParticipant(),
  ]);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch(`${router.basePath}/api/ping`).catch(() => {});
    const draft = sessionStorage.getItem('editDraftData');
    if (draft) {
      sessionStorage.removeItem('editDraftData');
      try {
        const { groups: g, participants: p } = JSON.parse(draft);
        setGroups(g);
        setParticipants(p);
      } catch {
        // ignore malformed data
      }
    }
  }, []);

  // --- Group handlers ---
  const addGroup = () => {
    setGroups((g) => [...g, '']);
  };

  const updateGroup = (index: number, value: string) => {
    setGroups((g) => {
      const next = [...g];
      next[index] = value;
      return next;
    });
  };

  const removeGroup = (index: number) => {
    const removed = groups[index].trim();
    setGroups((g) => g.filter((_, i) => i !== index));
    // Clear any participants referencing this group
    if (removed) {
      setParticipants((ps) =>
        ps.map((p) =>
          p.group === removed ? { ...p, group: '' } : p
        )
      );
    }
  };

  const validGroups = groups.map((g) => g.trim()).filter(Boolean);

  // --- Participant handlers ---
  const addParticipant = () => {
    if (participants.length >= MAX_PARTICIPANTS) return;
    setParticipants((ps) => [...ps, emptyParticipant()]);
  };

  const updateParticipant = (id: string, field: keyof Participant, value: string) => {
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
      (p) => !p.name.trim() || (p.email.trim() && !/\S+@\S+\.\S+/.test(p.email))
    );

    if (filled.length < 2) {
      setError('Please enter at least 2 participants.');
      return;
    }
    if (invalid.length > 0) {
      setError('Please make sure every participant has a valid name and email address.');
      return;
    }

    const payload = filled.map((p) => ({
      name: p.name.trim(),
      email: p.email.trim(),
      group: p.group,
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
        body: JSON.stringify({ participants: payload }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        return;
      }

      router.push(`/draw/${data.drawId}?key=${data.adminKey}`);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      if (slowTimerRef.current) clearTimeout(slowTimerRef.current);
      setStatusMsg('');
      setLoading(false);
    }
  }, [participants, router]);

  const filledCount = participants.filter((p) => p.name.trim()).length;

  return (
    <>
      <Head>
        <title>Secret Santa Picker</title>
        <meta name="description" content="Draw Secret Santa matches and notify everyone by email." />
      </Head>

      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <span className={styles.icon}>🎅🎁</span>
            <div>
              <h1 className={styles.title}>Secret Santa Picker App</h1>
              <p className={styles.subtitle}>Enter your groups and participants, then draw matches.</p>
            </div>
          </div>
        </header>

        <main className={styles.main}>
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
                <div key={i} className={styles.groupRow}>
                  <input
                    type="text"
                    placeholder={`Group ${i + 1} name`}
                    value={g}
                    onChange={(e) => updateGroup(i, e.target.value)}
                    maxLength={100}
                  />
                  <button
                    className={`btn btn-secondary ${styles.removeBtn}`}
                    onClick={() => removeGroup(i)}
                    title="Remove group"
                    disabled={groups.length === 1}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button className={`btn btn-secondary ${styles.addBtn}`} onClick={addGroup} disabled={groups.length >= 20}>
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

            <div className={styles.participantHeader}>
              <span>Name</span>
              <span>Group</span>
              <span>Email</span>
              <span />
            </div>

            <div className={styles.participantList}>
              {participants.map((p, i) => (
                <div key={p.id} className={`${styles.participantRow} fade-in`}>
                  <input
                    type="text"
                    placeholder={`Person ${i + 1}`}
                    value={p.name}
                    onChange={(e) => updateParticipant(p.id, 'name', e.target.value)}
                    maxLength={200}
                  />
                  <select
                    value={p.group}
                    onChange={(e) => updateParticipant(p.id, 'group', e.target.value)}
                  >
                    <option value="">No group</option>
                    {validGroups.map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                  <input
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
        </footer>
      </div>
    </>
  );
}