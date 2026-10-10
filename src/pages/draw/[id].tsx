import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import styles from '@/styles/Draw.module.css';

interface Match {
  giver_name: string;
  giver_email?: string;
  giver_group: string | null;
  receiver_name: string;
  receiver_group: string | null;
}

// The shared link gets participant names only; email, group_name, reveal_token,
// participantsWithEmailCount and matches come back for the organizer alone
interface DrawData {
  id: string;
  created_at: string;
  emails_sent_at: string | null;
  isAdmin: boolean;
  participantsWithEmailCount?: number;
  participants: Array<{ name: string; email?: string | null; group_name?: string | null; reveal_token?: string }>;
  matches?: Match[];
}

type PageState = 'loading' | 'loaded' | 'deleted' | 'not-found' | 'error';

export default function DrawPage() {
  const router = useRouter();
  const { id } = router.query;
  const adminKey = typeof router.query.key === 'string' ? router.query.key : '';

  const [state, setState] = useState<PageState>('loading');
  const [draw, setDraw] = useState<DrawData | null>(null);

  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [organizerName, setOrganizerName] = useState('');
  const [organizerEmail, setOrganizerEmail] = useState('');

  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [redrawLoading, setRedrawLoading] = useState(false);
  const [redrawError, setRedrawError] = useState('');

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  // Explicitly render the Turnstile widget once the email form is visible.
  // We cannot rely on Turnstile's auto-scan (which only fires once on script load)
  // because the .cf-turnstile container doesn't exist yet when the script first executes —
  // the page is still in "loading" state at that point.
  useEffect(() => {
    if (state !== 'loaded' || !draw?.isAdmin || draw.emails_sent_at) return;

    let scriptEl: HTMLScriptElement | null = null;

    const render = () => {
      if (!turnstileContainerRef.current || !(window as any).turnstile) return;
      if (turnstileWidgetId.current !== null) return; // already rendered
      turnstileWidgetId.current = (window as any).turnstile.render(turnstileContainerRef.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
      });
    };

    if ((window as any).turnstile) {
      render();
    } else {
      // Script is still loading — fire render once it finishes.
      scriptEl = document.querySelector('script[src*="turnstile"]') as HTMLScriptElement | null;
      if (scriptEl) {
        scriptEl.addEventListener('load', render, { once: true });
        // Fallback: if the script finished loading between our window.turnstile
        // check above and attaching the listener, the load event won't fire again.
        if ((window as any).turnstile) render();
      }
    }

    return () => {
      if (scriptEl) scriptEl.removeEventListener('load', render);
      if (turnstileWidgetId.current !== null && (window as any).turnstile) {
        (window as any).turnstile.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
      }
    };
  }, [state, draw?.isAdmin, draw?.emails_sent_at]);

  useEffect(() => {
    if (!id) return;
    const key = router.query.key;
    const keyParam = key ? `&key=${encodeURIComponent(key as string)}` : '';
    fetch(`${router.basePath}/api/get-draw?id=${id}${keyParam}`)
      .then(async (res) => {
        if (res.status === 410) { setState('deleted'); return; }
        if (res.status === 404) { setState('not-found'); return; }
        if (!res.ok) { setState('error'); return; }
        const data = await res.json();
        setDraw(data);
        setState('loaded');
      })
      .catch(() => setState('error'));
  }, [id, router.query.key]);

  const handleSendEmails = async () => {
    if (!draw) return;
    setEmailLoading(true);
    setEmailError('');
    try {
      const res = await fetch(`${router.basePath}/api/send-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draw.id, key: adminKey, organizerName: organizerName.trim(), organizerEmail: organizerEmail.trim(), turnstileToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setEmailError(data.error || 'Failed to send emails.');
        if ((window as any).turnstile) (window as any).turnstile.reset();
        setTurnstileToken(null);
      } else {
        setEmailSuccess(true);
        setDraw((d) => d ? { ...d, emails_sent_at: new Date().toISOString() } : d);
      }
    } catch {
      setEmailError('Network error. Please try again.');
      if ((window as any).turnstile) (window as any).turnstile.reset();
      setTurnstileToken(null);
    } finally {
      setEmailLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!draw) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      const res = await fetch(`${router.basePath}/api/delete-draw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draw.id, key: adminKey }),
      });
      if (res.ok) {
        setDeleted(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error || 'Failed to delete the draw. Please try again.');
      }
    } catch {
      setDeleteError('Network error. Please try again.');
    } finally {
      setDeleteLoading(false);
      setDeleteConfirm(false);
    }
  };

  const shareableUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}`
    : '';

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareableUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const personalUrl = (token: string) => typeof window !== 'undefined'
    ? `${window.location.origin}${router.basePath}/reveal/${token}`
    : '';

  const handleCopyPersonalLink = (token: string) => {
    navigator.clipboard.writeText(personalUrl(token));
    setCopiedToken(token);
    setTimeout(() => setCopiedToken((current) => (current === token ? null : current)), 2000);
  };

  const handleEditAndRedraw = async () => {
    // Emails can't be taken back, so a redraw after sending would leave people
    // holding the wrong match; the button is disabled in that case too
    if (!draw || draw.emails_sent_at) return;
    setRedrawLoading(true);
    setRedrawError('');
    try {
      const res = await fetch(`${router.basePath}/api/delete-draw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: draw.id, key: adminKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRedrawError(data.error || 'Could not remove this draw to redraw it. Please try again.');
        return;
      }
    } catch {
      setRedrawError('Network error. Please try again.');
      return;
    } finally {
      setRedrawLoading(false);
    }

    const groups = Array.from(new Set(draw.participants.map((p) => p.group_name).filter((g): g is string => !!g)));
    const participants = draw.participants.map((p) => ({
      id: Math.random().toString(36).slice(2),
      name: p.name ?? '',
      email: p.email ?? '',
      group: p.group_name ?? '',
    }));
    sessionStorage.setItem('editDraftData', JSON.stringify({
      groups: groups.length > 0 ? groups : [''],
      participants,
    }));
    router.push('/');
  };

  if (state === 'loading') {
    return (
      <div className={styles.centered}>
        <p className={styles.muted}>Loading draw…</p>
      </div>
    );
  }

  if (state === 'deleted' || deleted) {
    return (
      <>
        <Head><title>Draw unavailable — Secret Santa Picker</title></Head>
        <div className={styles.centered}>
          <div className={`card ${styles.messageCard}`}>
            <span className={styles.bigIcon}>🚫</span>
            <h2>This draw is no longer available</h2>
            <p className={styles.muted}>The person who created it has deleted the results.</p>
            <Link href="/" className="btn btn-secondary" style={{ marginTop: 16 }}>
              Start a new draw
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (state === 'not-found') {
    return (
      <>
        <Head><title>Draw not found — Secret Santa Picker</title></Head>
        <div className={styles.centered}>
          <div className={`card ${styles.messageCard}`}>
            <span className={styles.bigIcon}>🔍</span>
            <h2>Draw not found</h2>
            <p className={styles.muted}>This link may be invalid or expired.</p>
            <Link href="/" className="btn btn-secondary" style={{ marginTop: 16 }}>
              Start a new draw
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (state === 'error' || !draw) {
    return (
      <div className={styles.centered}>
        <p className={styles.muted}>Something went wrong. Please refresh.</p>
      </div>
    );
  }

  const createdDate = new Date(draw.created_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  const emailsSentDate = draw.emails_sent_at
    ? new Date(draw.emails_sent_at).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null;

  const matches = draw.isAdmin ? draw.matches ?? [] : null;

  return (
    <>
      <Head>
        <title>Draw results — Secret Santa Picker</title>
      </Head>

      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <Link href="/" className={styles.homeLink}>🎅🎁 Secret Santa Picker App</Link>
            <span className={styles.headerMeta}>Draw created {createdDate}</span>
          </div>
        </header>

        <main className={styles.main}>
          {/* Share bar */}
          <div className={`card ${styles.shareBar}`}>
            <div>
              <p className={styles.shareLabel}>Shareable link</p>
              <p className={styles.shareUrl}>{shareableUrl}</p>
            </div>
            <button className="btn btn-secondary" onClick={handleCopyLink}>
              {copied ? '✓ Copied' : 'Copy link'}
            </button>
          </div>

          {/* Public view: pairings stay private on the shared link */}
          {!matches && (
            <section className={`card ${styles.section}`}>
              <h2 className={styles.sectionTitle}>Participants</h2>
              <p className={styles.sectionDesc}>
                {draw.participants.length} participant{draw.participants.length !== 1 ? 's' : ''} in this draw. Matches are private:
                each person sees only who they drew, through their own personal link. If you don&rsquo;t have yours,
                ask your organizer for your personal link.
              </p>
              <ul className={styles.participantList}>
                {draw.participants.map((p, i) => (
                  <li key={i} className={styles.name}>{p.name}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Matches table (organizer only) */}
          {matches && <section className={`card ${styles.section}`}>
            <div className={styles.matchesTitleRow}>
              <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>Matches</h2>
              <button
                className="btn btn-secondary"
                onClick={handleEditAndRedraw}
                disabled={!!draw.emails_sent_at || redrawLoading}
                title={draw.emails_sent_at ? 'Emails have already been sent for this draw' : undefined}
              >
                {redrawLoading ? 'Removing…' : '← Edit & Redraw'}
              </button>
            </div>
            {draw.emails_sent_at && (
              <p className={styles.sectionDesc}>
                Edit &amp; Redraw is off because emails have already gone out. A redraw would leave people holding the wrong match.
              </p>
            )}
            {redrawError && <p className="error-msg" style={{ marginBottom: 12 }}>{redrawError}</p>}
            <p className={styles.sectionDesc}>
              {matches.length} participant{matches.length !== 1 ? 's' : ''} — each person will give a gift to the person listed beside them.
              Only you can see this table; the shareable link shows names only.
            </p>

            {(() => {
              const hasGroups = matches.some((m) => m.giver_group || m.receiver_group);
              return (
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
                    {[...matches].sort((a, b) => {
                      const aGroup = a.giver_group || '';
                      const bGroup = b.giver_group || '';
                      if (aGroup && !bGroup) return -1;
                      if (!aGroup && bGroup) return 1;
                      const groupCmp = aGroup.localeCompare(bGroup);
                      if (groupCmp !== 0) return groupCmp;
                      return a.giver_name.localeCompare(b.giver_name);
                    }).map((m, i) => (
                      <tr key={i}>
                        <td className={styles.nameCell}>
                          <span className={styles.name}>{m.giver_name}</span>
                          {hasGroups && (
                            <span className={styles.mobileGroup}>
                              {m.giver_group
                                ? <span className={styles.groupBadge}>Group: {m.giver_group}</span>
                                : <span className={styles.noGroup}>No Group</span>}
                            </span>
                          )}
                          {m.giver_email && <span className={styles.email}>{m.giver_email}</span>}
                        </td>
                        {hasGroups && (
                          <td className={styles.groupCol}>
                            {m.giver_group
                              ? <span className={styles.groupBadge}>{m.giver_group}</span>
                              : <span className={styles.noGroup}>No Group</span>}
                          </td>
                        )}
                        {hasGroups && <td className={styles.spacerCol} />}
                        <td className={styles.nameCell}>
                          <span className={styles.name}>{m.receiver_name}</span>
                          {hasGroups && (
                            <span className={styles.mobileGroup}>
                              {m.receiver_group
                                ? <span className={styles.groupBadge}>Group: {m.receiver_group}</span>
                                : <span className={styles.noGroup}>No Group</span>}
                            </span>
                          )}
                        </td>
                        {hasGroups && (
                          <td className={styles.groupCol}>
                            {m.receiver_group
                              ? <span className={styles.groupBadge}>{m.receiver_group}</span>
                              : <span className={styles.noGroup}>No Group</span>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
          </section>}

          {/* Personal reveal links (organizer only) */}
          {matches && <section className={`card ${styles.section}`}>
            <h2 className={styles.sectionTitle}>Personal links</h2>
            <p className={styles.sectionDesc}>
              Each link shows one person only who they drew. Send each person their own link by text or chat.
              {draw.emails_sent_at ? ' Everyone with an email address already got theirs in the email.' : ' The emails below include these links too.'}
            </p>
            <ul className={styles.personalLinks}>
              {draw.participants.map((p, i) => p.reveal_token && (
                <li key={i} className={styles.personalLinkRow}>
                  <div className={styles.personalLinkText}>
                    <span className={styles.name}>{p.name}</span>
                    <span className={styles.shareUrl}>{personalUrl(p.reveal_token)}</span>
                  </div>
                  <button className="btn btn-secondary" onClick={() => handleCopyPersonalLink(p.reveal_token!)}>
                    {copiedToken === p.reveal_token ? '✓ Copied' : 'Copy'}
                  </button>
                </li>
              ))}
            </ul>
          </section>}

          {/* Email section */}
          {draw.isAdmin && <section className={`card ${styles.section}`}>
            <h2 className={styles.sectionTitle}>Email notifications</h2>

            {(() => {
              const emailCount = draw.participantsWithEmailCount ?? 0;
              const hasEmails = emailCount > 0;

              if (emailsSentDate) {
                return (
                  <p className="success-msg">
                    ✓ Emails were sent on {emailsSentDate}. Each participant has been notified of their match.
                  </p>
                );
              }

              const organizerEmailInvalid = organizerEmail.trim().length > 0 && !/\S+@\S+\.\S+/.test(organizerEmail.trim());
              const canSend = hasEmails && organizerName.trim().length > 0 && organizerEmail.trim().length > 0 && !organizerEmailInvalid;

              return (
                <>
                  <p className={styles.sectionDesc}>
                    {hasEmails
                      ? `Send each participant an email revealing who they drew. This can only be done once. ${emailCount} of ${draw.participants.length} participant${draw.participants.length !== 1 ? 's' : ''} have an email address.`
                      : 'No participants have an email address. Add emails to participants to enable this feature.'}
                  </p>
                  <div className={styles.organizerFields}>
                    <div className={styles.organizerField}>
                      <label className={styles.organizerLabel} htmlFor="organizerName">Organizer Name</label>
                      <input
                        id="organizerName"
                        type="text"
                        className={styles.organizerInput}
                        value={organizerName}
                        onChange={(e) => setOrganizerName(e.target.value)}
                        placeholder="Your name"
                        disabled={emailLoading || emailSuccess}
                      />
                    </div>
                    <div className={styles.organizerField}>
                      <label className={styles.organizerLabel} htmlFor="organizerEmail">Organizer Email</label>
                      <input
                        id="organizerEmail"
                        type="email"
                        className={styles.organizerInput}
                        value={organizerEmail}
                        onChange={(e) => setOrganizerEmail(e.target.value)}
                        placeholder="your@email.com"
                        disabled={emailLoading || emailSuccess}
                      />
                      {organizerEmailInvalid && (
                        <p className={styles.organizerFieldError}>Please enter a valid email address.</p>
                      )}
                    </div>
                  </div>
                  {organizerName.trim() && (
                    <p className={styles.organizerPreview}>
                      Preview: <em>&ldquo;This secret message was sent by <strong>{organizerName.trim()}</strong>.&rdquo;</em>
                    </p>
                  )}
                  {emailError && <p className="error-msg" style={{ marginBottom: 12 }}>{emailError}</p>}
                  {emailSuccess && (
                    <p className="success-msg" style={{ marginBottom: 12 }}>
                      ✓ Emails sent successfully!
                    </p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <div ref={turnstileContainerRef} />
                    <button
                      className="btn btn-success"
                      onClick={handleSendEmails}
                      disabled={emailLoading || emailSuccess || !canSend || !turnstileToken}
                      title={!hasEmails ? 'No participants have an email address' : !organizerName.trim() || !organizerEmail.trim() ? 'Enter your name and email to send' : undefined}
                    >
                      {emailLoading ? 'Sending…' : `📧 Send emails to ${emailCount} participant${emailCount !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                </>
              );
            })()}
          </section>}

          {/* Delete section */}
          {draw.isAdmin && <section className={`card ${styles.section} ${styles.dangerSection}`}>
            <h2 className={styles.sectionTitle}>Delete this draw</h2>
            <p className={styles.sectionDesc}>
              Permanently removes access to this draw. The shareable link and every personal link will stop working.
              This cannot be undone.
            </p>
            {deleteError && <p className="error-msg" style={{ marginBottom: 12 }}>{deleteError}</p>}

            {!deleteConfirm ? (
              <button className="btn btn-danger" onClick={() => setDeleteConfirm(true)}>
                Delete draw
              </button>
            ) : (
              <div className={styles.confirmRow}>
                <p className={styles.confirmText}>Are you sure? This cannot be undone.</p>
                <div className={styles.confirmBtns}>
                  <button
                    className="btn btn-danger"
                    onClick={handleDelete}
                    disabled={deleteLoading}
                  >
                    {deleteLoading ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setDeleteConfirm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>}
        </main>

        <footer className={styles.footer}>
          <Link href="/">← Start a new draw</Link>
        </footer>
      </div>
    </>
  );
}