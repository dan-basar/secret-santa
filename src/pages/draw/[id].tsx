import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { formFromParticipants } from '@/lib/groups';
import styles from '@/styles/Draw.module.css';
import type { ApiError, GetDrawResponse, SendEmailsError } from '@/types/api';

type PageState = 'loading' | 'loaded' | 'deleted' | 'not-found' | 'error';

export default function DrawPage() {
  const router = useRouter();
  const { id } = router.query;
  // The admin key lives in the address bar's #key= fragment, which browsers never
  // send to the server, so it stays out of request logs. null until it has been
  // read after mount; '' when there is none (the shared link)
  const [adminKey, setAdminKey] = useState<string | null>(null);

  const [state, setState] = useState<PageState>('loading');
  const [draw, setDraw] = useState<GetDrawResponse | null>(null);

  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [organizerName, setOrganizerName] = useState('');
  const [organizerEmail, setOrganizerEmail] = useState('');

  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);

  // People with an email address who haven't been sent one: everyone before the
  // first send, and anyone whose email failed after it
  const unsentCount = draw?.isAdmin ? draw.participants.filter((p) => p.email && !p.email_sent_at).length : 0;

  // Explicitly render the Turnstile widget once the Send or Resend button is visible.
  // We cannot rely on Turnstile's auto-scan (which only fires once on script load)
  // because the .cf-turnstile container doesn't exist yet when the script first executes —
  // the page is still in "loading" state at that point.
  useEffect(() => {
    if (state !== 'loaded' || !draw?.isAdmin || (draw.emails_sent_at && unsentCount === 0)) return;

    let scriptEl: HTMLScriptElement | null = null;

    const render = () => {
      if (!turnstileContainerRef.current || !window.turnstile) return;
      if (turnstileWidgetId.current !== null) return; // already rendered
      turnstileWidgetId.current = window.turnstile.render(turnstileContainerRef.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!,
        callback: (token: string) => setTurnstileToken(token),
      });
    };

    if (window.turnstile) {
      render();
    } else {
      // Script is still loading — fire render once it finishes.
      scriptEl = document.querySelector('script[src*="turnstile"]') as HTMLScriptElement | null;
      if (scriptEl) {
        scriptEl.addEventListener('load', render, { once: true });
        // Fallback: if the script finished loading between our window.turnstile
        // check above and attaching the listener, the load event won't fire again.
        if (window.turnstile) render();
      }
    }

    return () => {
      if (scriptEl) scriptEl.removeEventListener('load', render);
      if (turnstileWidgetId.current !== null && window.turnstile) {
        window.turnstile.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
      }
    };
  }, [state, draw?.isAdmin, draw?.emails_sent_at, unsentCount]);

  useEffect(() => {
    if (!router.isReady || typeof id !== 'string') return;

    // Admin links from before the fragment carried ?key=. Use it, then swap it
    // for #key= so the query string isn't kept in the address bar or history
    const legacyKey = router.query.key;
    if (typeof legacyKey === 'string' && legacyKey) {
      setAdminKey(legacyKey);
      router.replace(`/draw/${id}#key=${encodeURIComponent(legacyKey)}`, undefined, { shallow: true });
      return;
    }

    setAdminKey(new URLSearchParams(window.location.hash.slice(1)).get('key') ?? '');
  }, [router, id]);

  const loadDraw = useCallback(async () => {
    // Wait for the key, so the organizer's page doesn't load the shared view first
    if (typeof id !== 'string' || adminKey === null) return;
    try {
      const res = await fetch(`${router.basePath}/api/get-draw?id=${id}`, {
        headers: adminKey ? { 'X-Admin-Key': adminKey } : {},
      });
      if (res.status === 410) { setState('deleted'); return; }
      if (res.status === 404) { setState('not-found'); return; }
      if (!res.ok) { setState('error'); return; }
      const data: GetDrawResponse = await res.json();
      setDraw(data);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, [id, adminKey, router.basePath]);

  useEffect(() => {
    loadDraw();
  }, [loadDraw]);

  // retryFailed resends only to people whose email didn't go out; the server
  // reuses the organizer name and email saved by the first send
  const handleSendEmails = async (retryFailed: boolean) => {
    if (!draw) return;
    setEmailLoading(true);
    setEmailError('');
    try {
      const res = await fetch(`${router.basePath}/api/send-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryFailed
          ? { id: draw.id, key: adminKey, turnstileToken, retryFailed: true }
          : { id: draw.id, key: adminKey, organizerName: organizerName.trim(), organizerEmail: organizerEmail.trim(), turnstileToken }),
      });
      if (!res.ok) {
        const data: SendEmailsError = await res.json();
        setEmailError(data.error || 'Failed to send emails.');
      }
      // Reload for each person's sent status rather than guessing it from the response
      await loadDraw();
    } catch {
      setEmailError('Network error. Please try again.');
    } finally {
      // A Turnstile token works once, so get a fresh one for any next attempt
      if (turnstileWidgetId.current !== null && window.turnstile) window.turnstile.reset(turnstileWidgetId.current);
      setTurnstileToken(null);
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
        const data: Partial<ApiError> = await res.json().catch(() => ({}));
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

  const handleEditAndRedraw = () => {
    // Emails can't be taken back, so a redraw after sending would leave people
    // holding the wrong match; the button is disabled in that case too
    if (!draw?.isAdmin || draw.emails_sent_at) return;

    // This draw stays live until create-draw saves its replacement, so leaving
    // the form without submitting keeps the original links working
    const { groups, participants } = formFromParticipants(draw.participants.map((p) => ({
      name: p.name ?? '',
      email: p.email ?? '',
      group: p.group_name ?? '',
    })));
    sessionStorage.setItem('editDraftData', JSON.stringify({
      groups,
      participants,
      replacesDrawId: draw.id,
      replacesKey: adminKey,
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

  // The organizer's view of the draw; null on the shared link
  const admin = draw.isAdmin ? draw : null;
  const matches = admin ? admin.matches : null;

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
                disabled={!!draw.emails_sent_at}
                title={draw.emails_sent_at ? 'Emails have already been sent for this draw' : undefined}
              >
                ← Edit &amp; Redraw
              </button>
            </div>
            {draw.emails_sent_at && (
              <p className={styles.sectionDesc}>
                Edit &amp; Redraw is off because emails have already gone out. A redraw would leave people holding the wrong match.
              </p>
            )}
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
          {admin && <section className={`card ${styles.section}`}>
            <h2 className={styles.sectionTitle}>Personal links</h2>
            <p className={styles.sectionDesc}>
              Each link shows one person only who they drew. Send each person their own link by text or chat.
              {draw.emails_sent_at ? ' Everyone the emails reached already has theirs.' : ' The emails below include these links too.'}
            </p>
            <ul className={styles.personalLinks}>
              {admin.participants.map((p, i) => p.reveal_token && (
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
                if (unsentCount === 0) {
                  return (
                    <p className="success-msg">
                      ✓ Emails were sent on {emailsSentDate}. Each participant with an email address has been notified of their match.
                    </p>
                  );
                }

                const notDelivered = draw.participants.filter((p) => p.email && !p.email_sent_at).map((p) => p.name);
                return (
                  <>
                    <p className="error-msg" style={{ marginBottom: 12 }}>
                      Sent to {emailCount - unsentCount} of {emailCount}. Not delivered: {notDelivered.join(', ')}
                    </p>
                    <p className={styles.sectionDesc}>
                      Resend tries again for just {unsentCount === 1 ? 'this person' : 'these people'}. Everyone else already has their email.
                      You can also send {unsentCount === 1 ? 'them their' : 'each of them their'} personal link above.
                    </p>
                    {emailError && <p className="error-msg" style={{ marginBottom: 12 }}>{emailError}</p>}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                      <div ref={turnstileContainerRef} />
                      <button
                        className="btn btn-success"
                        onClick={() => handleSendEmails(true)}
                        disabled={emailLoading || !turnstileToken}
                      >
                        {emailLoading ? 'Sending…' : `📧 Resend to ${unsentCount} participant${unsentCount !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  </>
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
                        disabled={emailLoading}
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
                        disabled={emailLoading}
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
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <div ref={turnstileContainerRef} />
                    <button
                      className="btn btn-success"
                      onClick={() => handleSendEmails(false)}
                      disabled={emailLoading || !canSend || !turnstileToken}
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