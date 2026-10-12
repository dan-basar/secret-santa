import { Html, Head, Main, NextScript } from 'next/document';

// Only here to set the page language, so screen readers pick the right voice
// and browsers don't offer to translate
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
