import type { AppProps } from 'next/app';
import Head from 'next/head';
import { Analytics } from '@vercel/analytics/next';
import { DM_Sans, Libre_Baskerville } from 'next/font/google';
import '@/styles/globals.css';

// Downloaded at build time and served from this site, so visitors never request
// Google's servers and text doesn't jump when the fonts arrive
const serif = Libre_Baskerville({ weight: ['400', '700'], style: ['normal', 'italic'], subsets: ['latin'], display: 'swap' });
const sans = DM_Sans({ weight: ['300', '400', '500'], subsets: ['latin'], display: 'swap' });

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
          --font-libre-baskerville: ${serif.style.fontFamily};
          --font-dm-sans: ${sans.style.fontFamily};
        }
      `}</style>
      <Component {...pageProps} />
      <Analytics />
    </>
  );
}
