import type { AppProps } from 'next/app';
import Head from 'next/head';
import '@/styles/globals.css';

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
      <Component {...pageProps} />
    </>
  );
}
