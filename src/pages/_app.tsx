import type { AppProps } from 'next/app';
import Head from 'next/head';
import Script from 'next/script';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      {/* The basePath moves these off the domain root, where browsers look by default */}
      <Head>
        <link rel="icon" href="/secret-santa/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/secret-santa/favicon-32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/secret-santa/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/secret-santa/apple-touch-icon.png" />
      </Head>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <Component {...pageProps} />
    </>
  );
}
