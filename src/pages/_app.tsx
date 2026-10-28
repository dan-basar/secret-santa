import type { AppProps } from 'next/app';
import Head from 'next/head';
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';
import { DM_Sans, Young_Serif } from 'next/font/google';
import '@/styles/globals.css';

// Downloaded at build time and served from this site, so visitors never request
// Google's servers and text doesn't jump when the fonts arrive
const serif = Young_Serif({ weight: '400', subsets: ['latin'], display: 'swap' });
const sans = DM_Sans({ weight: ['300', '400', '500'], subsets: ['latin'], display: 'swap' });

// A personal link's path is its secret, so page views report the route instead
function hideRevealCode(event: BeforeSendEvent): BeforeSendEvent {
  return { ...event, url: event.url.replace(/\/reveal\/[^/?#]+/, '/reveal/[code]') };
}

export default function App({ Component, pageProps, router }: AppProps) {
  return (
    <>
      {/* The basePath moves these off the domain root, where browsers look by default */}
      <Head>
        <link rel="icon" href={`${router.basePath}/favicon.ico`} sizes="48x48" />
        <link rel="icon" href={`${router.basePath}/favicon-32.png`} sizes="32x32" type="image/png" />
        <link rel="icon" href={`${router.basePath}/favicon.svg`} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={`${router.basePath}/apple-touch-icon.png`} />
      </Head>
      {/* globals.css builds --font-serif and --font-sans from these */}
      <style jsx global>{`
        :root {
          --font-young-serif: ${serif.style.fontFamily};
          --font-dm-sans: ${sans.style.fontFamily};
        }
      `}</style>
      <Component {...pageProps} />
      {/* Vercel would load its script from the domain root, which belongs to
          baseworkshop-home; these go through the rewrite in next.config.js */}
      <Analytics
        scriptSrc={`${router.basePath}/_vercel/insights/script.js`}
        viewEndpoint={`${router.basePath}/_vercel/insights/view`}
        eventEndpoint={`${router.basePath}/_vercel/insights/event`}
        sessionEndpoint={`${router.basePath}/_vercel/insights/session`}
        beforeSend={hideRevealCode}
      />
    </>
  );
}
