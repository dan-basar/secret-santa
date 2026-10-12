import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';

interface Props {
  onToken: (token: string) => void;
}

// How long to wait for Cloudflare's script before saying it didn't load
const LOAD_TIMEOUT_MS = 15_000;

// The Cloudflare Turnstile CAPTCHA for the send and resend forms. The script
// loads only when one of those forms renders, not on every page. The widget is
// rendered explicitly, because Turnstile's own scan for .cf-turnstile runs once
// at script load and would miss a form that appears later. Remount it (change
// its key) for a fresh token after each send: a token works once.
//
// If the script is blocked (some work networks, strict privacy settings) or the
// widget errors, no token ever arrives and Send stays disabled, so say why and
// point at the personal links instead.
export default function TurnstileWidget({ onToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  const render = useCallback(() => {
    if (!containerRef.current || !window.turnstile || widgetId.current !== null) return;
    widgetId.current = window.turnstile.render(containerRef.current, {
      sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!,
      callback: (token) => {
        setFailed(false);
        onToken(token);
      },
      // Turnstile keeps retrying after an error; a later success clears the message.
      // Returning true tells it the error was handled
      'error-callback': () => {
        setFailed(true);
        return true;
      },
    });
  }, [onToken]);

  // onReady below covers a script that finishes loading after mount. This
  // covers one already loaded, including after React StrictMode's remount,
  // when next/script doesn't call onReady again
  useEffect(() => {
    render();
    const timer = setTimeout(() => {
      if (widgetId.current === null) setFailed(true);
    }, LOAD_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      if (widgetId.current !== null) {
        window.turnstile?.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [render]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onReady={render}
        onError={() => setFailed(true)}
      />
      <div ref={containerRef} />
      {failed && (
        <p className="error-msg" role="alert">
          The security check didn&rsquo;t load. Try another browser or network, or send each person their personal link below.
        </p>
      )}
    </>
  );
}
