// The parts of Cloudflare Turnstile's explicit-render API that TurnstileWidget uses.
// The widget loads the script, so window.turnstile is undefined until it finishes.
interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
  // Return true to mark the error handled
  'error-callback'?: (errorCode: string) => boolean | void;
}

interface Turnstile {
  render(container: HTMLElement | string, options: TurnstileRenderOptions): string;
  remove(widgetId: string): void;
}

interface Window {
  turnstile?: Turnstile;
}
