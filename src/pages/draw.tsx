import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import { formFromParticipants } from '@/lib/groups';
import { organizerUrl, revealUrl } from '@/lib/site';
import { isAdminKey, isCutShort, ADMIN_KEY_LENGTH } from '@/lib/tokens';
import { formatBudget, hasDetails, noteError, parseBudget, sameDetails, typedDetails } from '@/lib/details';
import { hasLink } from '@/lib/sanitize';
import { EMAIL_DRAFT_KEY, readEmailDraft, type EmailDraft } from '@/lib/email-draft';
import OrganizerLink from '@/components/draw/OrganizerLink';
import MatchesTable from '@/components/draw/MatchesTable';
import PersonalLinks from '@/components/draw/PersonalLinks';
import DetailsCard from '@/components/draw/DetailsCard';
import EmailSection from '@/components/draw/EmailSection';
import MatchListExport from '@/components/draw/MatchListExport';
import PrintSheet from '@/components/draw/PrintSheet';
import DeleteSection from '@/components/draw/DeleteSection';
import styles from '@/styles/Draw.module.css';
import logo from '../../public/logo.svg';
import type { ApiError, ExchangeDetails, GetDrawResponse, SaveDetailsResponse, SendEmailsError, SendEmailsResponse } from '@/types/api';

type PageState = 'loading' | 'loaded' | 'deleted' | 'not-found' | 'incomplete' | 'busy' | 'error';

// When a send's outcome is unknown: the people it reached show as sent once the
// page reloads, and anyone still being emailed shows as sent within minutes
const MAYBE_SENT = 'We couldn\'t confirm the send. Some emails may still be going out, so check the list below again in a few minutes before resending.';

export default function DrawPage() {
  const router = useRouter();
  // The organizer's link is /draw#<adminKey>. The key lives in the fragment,
  // which browsers never send to the server, so it stays out of request logs.
  // null until it has been read after mount
  const [adminKey, setAdminKey] = useState<string | null>(null);

  const [state, setState] = useState<PageState>('loading');
  const [draw, setDraw] = useState<GetDrawResponse | null>(null);

  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  // Whether the organizer's own link went out with their last send
  const [organizerLinkNotice, setOrganizerLinkNotice] = useState('');
  const [organizerName, setOrganizerName] = useState('');
  const [organizerEmail, setOrganizerEmail] = useState('');
  // The optional exchange details, as typed: budget without its "$", date YYYY-MM-DD
  const [organizerNote, setOrganizerNote] = useState('');
  const [budget, setBudget] = useState('');
  const [exchangeDate, setExchangeDate] = useState('');
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  // The admin key whose draw filled the details, once per draw, so a reload after a send never wipes what's typed
  const detailsLoadedFor = useRef<string | null>(null);
  // The admin key the loaded draw was fetched with: adminKey changes before its draw
  // arrives, so requests use this one to act on the draw on screen
  const drawKey = useRef<string | null>(null);

  // Whether the organizer has opened the matches table; it also unlocks saving and printing them
  const [matchesShown, setMatchesShown] = useState(false);

  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // Bumped after each send to remount the CAPTCHA: a Turnstile token works once
  const [turnstileKey, setTurnstileKey] = useState(0);

  // People with an email address who haven't been sent one: everyone before the
  // first send, and anyone whose email failed after it
  const unsentCount = draw ? draw.participants.filter((p) => p.email && !p.email_sent_at).length : 0;

  // Pasting another organizer link into this tab changes only the fragment,
  // which doesn't reload the page, so read the key again whenever it changes
  useEffect(() => {
    const readKey = () => setAdminKey(window.location.hash.slice(1));
    readKey();
    window.addEventListener('hashchange', readKey);
    return () => window.removeEventListener('hashchange', readKey);
  }, []);

  // Another organizer link pasted into this tab opens with its matches hidden again
  useEffect(() => setMatchesShown(false), [adminKey]);

  const loadDraw = useCallback(async () => {
    if (adminKey === null) return;
    // Too short: almost always a link cut short when pasted
    if (isCutShort(adminKey, ADMIN_KEY_LENGTH)) { setState('incomplete'); return; }
    if (!isAdminKey(adminKey)) { setState('not-found'); return; }
    try {
      const res = await fetch(`${router.basePath}/api/get-draw`, {
        headers: { 'X-Admin-Key': adminKey },
      });
      if (res.status === 410) { setState('deleted'); return; }
      if (res.status === 404) { setState('not-found'); return; }
      if (res.status === 429) { setState('busy'); return; }
      if (!res.ok) { setState('error'); return; }
      const data: GetDrawResponse = await res.json();
      if (detailsLoadedFor.current !== adminKey) {
        detailsLoadedFor.current = adminKey;
        setOrganizerNote(data.organizer_note ?? '');
        setBudget(data.budget_cents !== null ? formatBudget(data.budget_cents).slice(1) : '');
        setExchangeDate(data.exchange_date ?? '');
        // Before the first send the organizer's name and email are only in this tab's
        // draft. The details come from it too, unless some are saved: the saved copy wins
        const typed = data.emails_sent_at ? null : readEmailDraft(adminKey);
        if (typed) {
          setOrganizerName(typed.organizerName);
          setOrganizerEmail(typed.organizerEmail);
          if (!hasDetails(data)) {
            setOrganizerNote(typed.organizerNote);
            setBudget(typed.budget);
            setExchangeDate(typed.exchangeDate);
          }
        }
      }
      drawKey.current = adminKey;
      setDraw(data);
      setState('loaded');
    } catch {
      setState('error');
    }
  }, [adminKey, router.basePath]);

  useEffect(() => {
    loadDraw();
  }, [loadDraw]);

  // Save the email card as it is typed. Waits until the draft has been read back for
  // this draw, or the empty card would overwrite it, and stops once the emails are sent
  useEffect(() => {
    const key = drawKey.current;
    if (!draw || !key || draw.emails_sent_at || detailsLoadedFor.current !== key) return;
    try {
      const fields = [organizerName, organizerEmail, organizerNote, budget, exchangeDate];
      if (fields.some((f) => f)) {
        const draft: EmailDraft = { drawKey: key, organizerName, organizerEmail, organizerNote, budget, exchangeDate };
        sessionStorage.setItem(EMAIL_DRAFT_KEY, JSON.stringify(draft));
      } else if (readEmailDraft(key)) {
        // Emptied by hand; another draw's draft is left alone
        sessionStorage.removeItem(EMAIL_DRAFT_KEY);
      }
    } catch {
      // Storage can be blocked or full; typing still works, it just isn't kept
    }
  }, [draw, organizerName, organizerEmail, organizerNote, budget, exchangeDate]);

  // Saves the details as typed, so they show on each personal link without any email
  const handleSaveDetails = async () => {
    if (!draw) return;
    const key = drawKey.current;
    setDetailsSaving(true);
    setDetailsError('');
    try {
      const res = await fetch(`${router.basePath}/api/save-details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, organizerNote: organizerNote.trim(), budget: budget.trim(), exchangeDate }),
      });
      if (res.ok) {
        const saved: SaveDetailsResponse = await res.json();
        // Unless another organizer link was opened in this tab meanwhile
        if (drawKey.current === key) setDraw((d) => d && { ...d, ...saved });
      } else {
        const data: Partial<ApiError> = await res.json().catch(() => ({}));
        setDetailsError(data.error || 'Failed to save the details. Please try again.');
        // Sent or deleted meanwhile: show the draw as it now is
        if (res.status === 409 || res.status === 410) await loadDraw();
      }
    } catch {
      setDetailsError('Network error. Please try again.');
    } finally {
      setDetailsSaving(false);
    }
  };

  // retryFailed resends only to people whose email didn't go out; the server
  // reuses the organizer name and email saved by the first send
  const handleSendEmails = async (retryFailed: boolean) => {
    if (!draw) return;
    setEmailLoading(true);
    setEmailError('');
    setOrganizerLinkNotice('');
    try {
      const res = await fetch(`${router.basePath}/api/send-emails`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retryFailed
          ? { key: drawKey.current, turnstileToken, retryFailed: true }
          : {
            key: drawKey.current, organizerName: organizerName.trim(), organizerEmail: organizerEmail.trim(),
            organizerNote: organizerNote.trim(), budget: budget.trim(), exchangeDate, turnstileToken,
          }),
      });
      if (res.ok && !retryFailed) {
        // Sent and saved on the server, so the next draw in this tab starts with an empty card
        try { sessionStorage.removeItem(EMAIL_DRAFT_KEY); } catch { /* storage blocked */ }
        const data: SendEmailsResponse = await res.json();
        setOrganizerLinkNotice(data.organizerLinkSent
          ? `✓ Your organizer link was emailed to ${organizerEmail.trim()}.`
          : 'We couldn\'t email you your organizer link. Copy it from the top of this page instead.');
      }
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
        body: JSON.stringify({ key: drawKey.current }),
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

  const handleShowMatches = () => {
    setMatchesShown(true);
    // On phones Share must open the share sheet soon after the tap, so load the PDF library
    // and font now (the browser caches the font files for the tap)
    if (window.matchMedia?.('(hover: none) and (pointer: coarse)').matches) {
      import('@/lib/match-pdf').then((m) => Promise.all([m.loadPdfLibrary(), m.loadPdfFonts(router.basePath)])).catch(() => {});
    }
  };

  const handleEditAndRedraw = () => {
    // Emails can't be taken back, so a redraw after sending would leave people
    // holding the wrong match; the button is disabled in that case too
    if (!draw || draw.emails_sent_at) return;

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
      replacesKey: drawKey.current,
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
            <p className={styles.muted}>It was deleted, or replaced when its matches were redrawn. A redrawn draw has a new organizer link.</p>
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
            <p className={styles.muted}>This organizer link doesn&rsquo;t match any draw. Check you copied the whole link.</p>
            <Link href="/" className="btn btn-secondary" style={{ marginTop: 16 }}>
              Start a new draw
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (state === 'busy') {
    return (
      <div className={styles.centered}>
        <p className={styles.muted}>Too many tries from this network in the last hour. Please try again later.</p>
      </div>
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

  const savedDetails: ExchangeDetails = {
    organizer_note: draw.organizer_note,
    budget_cents: draw.budget_cents,
    exchange_date: draw.exchange_date,
  };
  // What's typed, leaving out any value the server would refuse
  const typed = typedDetails(organizerNote, budget, exchangeDate);
  const detailsValid = !noteError(organizerNote.trim()) && parseBudget(budget) !== 'invalid';
  // The saved and printed list carries the saved details, or what's typed while none are saved
  const listDetails: ExchangeDetails = hasDetails(savedDetails) ? savedDetails : typed;
  // The name saved by the first send, or the one typed in the email card before it
  const typedName = organizerName.trim();
  const listOrganizer = draw.organizer_name || (hasLink(typedName) ? '' : typedName);

  return (
    <>
      <Head>
        <title>Draw results — Secret Santa Picker</title>
      </Head>

      {/* Printing the page prints this in its place once the matches are shown */}
      {matchesShown && <PrintSheet draw={draw} details={listDetails} organizerName={listOrganizer} />}
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
          {/* Built from NEXT_PUBLIC_BASE_URL like the links in the emails, so an organizer
              who opened the page on another address (vercel.app) still copies the public one */}
          <OrganizerLink url={organizerUrl(adminKey ?? '')} />
          <MatchesTable
            participants={draw.participants}
            matches={draw.matches}
            emailsSent={!!draw.emails_sent_at}
            onEditAndRedraw={handleEditAndRedraw}
            shown={matchesShown}
            onShow={handleShowMatches}
          />
          <DetailsCard
            saved={savedDetails}
            emailsSent={!!draw.emails_sent_at}
            note={organizerNote}
            budget={budget}
            exchangeDate={exchangeDate}
            onNoteChange={setOrganizerNote}
            onBudgetChange={setBudget}
            onExchangeDateChange={setExchangeDate}
            unsaved={!detailsValid || !sameDetails(typed, savedDetails)}
            valid={detailsValid}
            saving={detailsSaving}
            disabled={emailLoading}
            error={detailsError}
            onSave={handleSaveDetails}
          />
          <EmailSection
            draw={draw}
            unsentCount={unsentCount}
            organizerName={organizerName}
            organizerEmail={organizerEmail}
            onOrganizerNameChange={setOrganizerName}
            onOrganizerEmailChange={setOrganizerEmail}
            organizerNote={organizerNote}
            budget={budget}
            exchangeDate={exchangeDate}
            loading={emailLoading || detailsSaving}
            error={emailError}
            organizerLinkNotice={organizerLinkNotice}
            turnstileKey={turnstileKey}
            onTurnstileToken={setTurnstileToken}
            hasTurnstileToken={!!turnstileToken}
            onSend={handleSendEmails}
          />
          <PersonalLinks
            participants={draw.participants}
            emailsSent={!!draw.emails_sent_at}
            linkFor={revealUrl}
          />
          <MatchListExport draw={draw} details={listDetails} organizerName={listOrganizer} shown={matchesShown} />
          <DeleteSection onDelete={handleDelete} loading={deleteLoading} error={deleteError} />
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
