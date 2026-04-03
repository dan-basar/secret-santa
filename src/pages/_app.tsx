import type { AppProps } from 'next/app';
import Script from 'next/script';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <Component {...pageProps} />
    </>
  );
}
