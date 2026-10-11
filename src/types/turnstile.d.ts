// The parts of Cloudflare Turnstile's explicit-render API that TurnstileWidget uses.
// The widget loads the script, so window.turnstile is undefined until it finishes.
interface TurnstileRenderOptions {
  sitekey: string;
  callback?: (token: string) => void;
}

interface Turnstile {
  render(container: HTMLElement | string, options: TurnstileRenderOptions): string;
  remove(widgetId: string): void;
}

interface Window {
  turnstile?: Turnstile;
}
