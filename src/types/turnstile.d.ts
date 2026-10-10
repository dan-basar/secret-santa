// The parts of Cloudflare Turnstile's explicit-render API that draw/[id].tsx uses.
// The script loads from _app.tsx, so window.turnstile is undefined until it finishes.
interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
}

interface Turnstile {
  render(container: HTMLElement | string, options: TurnstileRenderOptions): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

interface Window {
  turnstile?: Turnstile;
}
