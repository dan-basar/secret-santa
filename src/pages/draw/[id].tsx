import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import { formFromParticipants } from '@/lib/groups';
import { siteUrl } from '@/lib/site';
import { isUuid } from '@/lib/uuid';
import OrganizerLink from '@/components/draw/OrganizerLink';
import ParticipantList from '@/components/draw/ParticipantList';
import MatchesTable from '@/components/draw/MatchesTable';
import PersonalLinks from '@/components/draw/PersonalLinks';
import EmailSection from '@/components/draw/EmailSection';
import DeleteSection from '@/components/draw/DeleteSection';
import styles from '@/styles/Draw.module.css';
import logo from '../../../public/logo.svg';
import type { ApiError, GetDrawResponse, SendEmailsError } from '@/types/api';

type PageState = 'loading' | 'loaded' | 'deleted' | 'not-found' | 'incomplete' | 'error';

// When a send's outcome is unknown: the people it reached show as sent once the
// page reloads, and anyone still being emailed shows as sent within minutes
const MAYBE_SENT = 'We couldn\'t confirm the send. Some emails may still be going out, so check the list below again in a few minutes before resending.';

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
  const [deleted, setDeleted] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Bumped after each send to remount the CAPTCHA: a Turnstile token works once
  const [turnstileKey, setTurnstileKey] = useState(0);

  // People with an email address who haven't been sent one: everyone before the
  // first send, and anyone whose email failed after it
  const unsentCount = draw?.isAdmin ? draw.participants.filter((p) => p.email && !p.email_sent_at).length : 0;

  useEffect(() => {
    if (!router.isReady || typeof id !== 'string') return;

    setAdminKey(new URLSearchParams(window.location.hash.slice(1)).get('key') ?? '');
  }, [router, id]);

  const loadDraw = useCallback(async () => {
    // Wait for the key, so the organizer's page doesn't load the shared view first
    if (typeof id !== 'string' || adminKey === null) return;
    // Not even shaped like a draw id: almost always a link cut short when pasted
    if (!isUuid(id)) { setState('incomplete'); return; }
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
        // A send that runs past the function's time limit gets a 504 from Vercel
        // whose body isn't JSON, while emails may still have gone out
        const data: Partial<SendEmailsError> = await res.json().catch(() => ({}));
        setEmailError(data.error || (res.status >= 500 ? MAYBE_SENT : 'Failed to send emails.'));
      }
    } catch {
      // The request may have reached the server before the connection dropped
      setEmailError(MAYBE_SENT);
    } finally {
      // Always reload for each person's sent status rather than guessing it
      await loadDraw();
      // A Turnstile token works once, so get a fresh one for any next attempt
      setTurnstileKey((k) => k + 1);
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
    }
  };

  // Built from NEXT_PUBLIC_BASE_URL like the links in the emails, so an organizer
  // who opened the page on another address (vercel.app) still copies the public one
  const organizerUrl = siteUrl(`/draw/${encodeURIComponent(String(id ?? ''))}#key=${encodeURIComponent(adminKey ?? '')}`);
  const personalUrl = (token: string) => siteUrl(`/reveal/${encodeURIComponent(token)}`);

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
            <h1>This draw is no longer available</h1>
            <p className={styles.muted}>The person who created it has deleted the results. If the draw was redone, ask your organizer for the new link.</p>
            <Link href="/" className="btn btn-secondary" style={{ marginTop: 16 }}>
              Start a new draw
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (state === 'incomplete') {
    return (
      <>
        <Head><title>Link incomplete — Secret Santa Picker</title></Head>
        <div className={styles.centered}>
          <div className={`card ${styles.messageCard}`}>
            <span className={styles.bigIcon}>🔗</span>
            <h1>This link looks incomplete</h1>
            <p className={styles.muted}>Links sometimes get cut off when they&rsquo;re pasted into a text or chat. Copy the whole link again.</p>
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
            <h1>Draw not found</h1>
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

  // The organizer's view of the draw; null on the shared link
  const admin = draw.isAdmin ? draw : null;

  return (
    <>
      <Head>
        <title>Draw results — Secret Santa Picker</title>
      </Head>

      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <Link href="/" className={styles.homeLink}>
              <Image src={logo} alt="" width={24} height={28} />
              Secret Santa Picker App
              <Image src={logo} alt="" width={24} height={28} />
            </Link>
            <span className={styles.headerMeta}>Draw created {createdDate}</span>
          </div>
        </header>

        <main className={styles.main}>
          {/* The header already names the app; this gives the page its one top-level heading */}
          <h1 className="visually-hidden">Secret Santa draw results</h1>
          {admin ? (
            <>
              <OrganizerLink url={organizerUrl} />
              <MatchesTable
                participants={admin.participants}
                matches={admin.matches}
                emailsSent={!!admin.emails_sent_at}
                onEditAndRedraw={handleEditAndRedraw}
              />
              <EmailSection
                draw={admin}
                unsentCount={unsentCount}
                organizerName={organizerName}
                organizerEmail={organizerEmail}
                onOrganizerNameChange={setOrganizerName}
                onOrganizerEmailChange={setOrganizerEmail}
                loading={emailLoading}
                error={emailError}
                turnstileKey={turnstileKey}
                onTurnstileToken={setTurnstileToken}
                hasTurnstileToken={!!turnstileToken}
                onSend={handleSendEmails}
              />
              <PersonalLinks
                participants={admin.participants}
                emailsSent={!!admin.emails_sent_at}
                linkFor={personalUrl}
              />
              <DeleteSection onDelete={handleDelete} loading={deleteLoading} error={deleteError} />
            </>
          ) : (
            <>
              {/* An organizer link whose key is wrong or was cut off when copied gets the
                  shared view, which would read as if the matches had gone */}
              {adminKey && (
                <p className="error-msg" role="alert">
                  This organizer link&rsquo;s key doesn&rsquo;t match this draw, so you&rsquo;re seeing the shared view.
                  Check you copied the whole link, including everything after <code>#key=</code>.
                </p>
              )}
              <ParticipantList participants={draw.participants} />
            </>
          )}
        </main>

        <footer className={styles.footer}>
          <Link href="/">← Start a new draw</Link>
          {/* The policy lives on the root site, outside this app's base path */}
          <a href="/privacy">Privacy policy</a>
        </footer>
      </div>
    </>
  );
}
