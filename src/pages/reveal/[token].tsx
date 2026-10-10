import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import styles from '@/styles/Reveal.module.css';

interface RevealData {
  name: string;
  match_name: string;
  created_at: string;
  organizer_name: string | null;
}

type PageState = 'loading' | 'loaded' | 'deleted' | 'not-found' | 'error';

export default function RevealPage() {
  const router = useRouter();
  const { token } = router.query;

  const [state, setState] = useState<PageState>('loading');
  const [data, setData] = useState<RevealData | null>(null);
  // Hidden until tapped, so a glance over someone's shoulder doesn't spoil it
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (typeof token !== 'string') return;
    fetch(`${router.basePath}/api/reveal?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 410) { setState('deleted'); return; }
        if (res.status === 404) { setState('not-found'); return; }
        if (!res.ok) { setState('error'); return; }
        setData(await res.json());
        setState('loaded');
      })
      .catch(() => setState('error'));
  }, [token, router.basePath]);

  // The token in the URL is the only key to this match: keep the page out of
  // search engines and never send the URL to another site as a referrer
  const head = (
    <Head>
      <title>Your Secret Santa match</title>
      <meta name="robots" content="noindex, nofollow" />
      <meta name="referrer" content="no-referrer" />
    </Head>
  );

  if (state === 'loading') {
    return (
      <>
        {head}
        <div className={styles.centered}>
          <p className={styles.muted}>Loading…</p>
        </div>
      </>
    );
  }

  if (state === 'deleted' || state === 'not-found' || state === 'error' || !data) {
    const message = state === 'deleted'
      ? { icon: '🚫', title: 'This draw is no longer available', text: 'The organizer has deleted this draw.' }
      : state === 'not-found'
        ? { icon: '🔍', title: 'Link not found', text: 'This personal link is not valid. Check the link in your email, or ask your organizer for it again.' }
        : { icon: '⚠️', title: 'Something went wrong', text: 'Please refresh the page to try again.' };
    return (
      <>
        {head}
        <div className={styles.centered}>
          <div className={`card ${styles.card}`}>
            <span className={styles.bigIcon}>{message.icon}</span>
            <h1 style={{ fontSize: 24 }}>{message.title}</h1>
            <p className={styles.muted}>{message.text}</p>
          </div>
        </div>
      </>
    );
  }

  const createdDate = new Date(data.created_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  return (
    <>
      {head}
      <div className={styles.centered}>
        <div className={`card ${styles.card}`}>
          <span className={styles.bigIcon}>🎁</span>
          <h1 style={{ fontSize: 26 }}>Hi {data.name},</h1>
          <p className={styles.lead}>you&rsquo;re the Secret Santa for&hellip;</p>

          {revealed ? (
            <p className={`${styles.matchName} fade-in`}>{data.match_name}</p>
          ) : (
            <button className={`btn btn-primary ${styles.revealButton}`} onClick={() => setRevealed(true)}>
              Tap to reveal
            </button>
          )}

          <p className={styles.meta}>
            Draw made on {createdDate}
            {data.organizer_name && <><br />Organized by {data.organizer_name}</>}
            <br />Keep this link to yourself: it shows only your match.
          </p>
          <Link href="/" className={styles.muted}>Secret Santa Picker</Link>
        </div>
      </div>
    </>
  );
}
