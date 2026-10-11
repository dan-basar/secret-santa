import { useCallback, useEffect, useRef } from 'react';
import Script from 'next/script';

interface Props {
  onToken: (token: string) => void;
}

// The Cloudflare Turnstile CAPTCHA for the send and resend forms. The script
// loads only when one of those forms renders, not on every page. The widget is
// rendered explicitly, because Turnstile's own scan for .cf-turnstile runs once
// at script load and would miss a form that appears later. Remount it (change
// its key) for a fresh token after each send: a token works once.
export default function TurnstileWidget({ onToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const render = useCallback(() => {
    if (!containerRef.current || !window.turnstile || widgetId.current !== null) return;
    widgetId.current = window.turnstile.render(containerRef.current, {
      sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!,
      callback: onToken,
    });
  }, [onToken]);

  // onReady below covers a script that finishes loading after mount. This
  // covers one already loaded, including after React StrictMode's remount,
  // when next/script doesn't call onReady again
  useEffect(() => {
    render();
    return () => {
      if (widgetId.current !== null) {
        window.turnstile?.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [render]);

  return (
    <>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" onReady={render} />
      <div ref={containerRef} />
    </>
  );
}
