// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

// The page never loads Cloudflare's script in tests; window.turnstile stands in for it
vi.mock('next/script', () => ({ default: () => null }));

import TurnstileWidget from '@/components/draw/TurnstileWidget';

const MESSAGE = /security check didn.t load/i;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.turnstile;
});

function stubTurnstile() {
  let options: TurnstileRenderOptions | undefined;
  window.turnstile = {
    render: (_el, opts) => { options = opts; return 'widget-1'; },
    remove: () => {},
  };
  return () => options!;
}

describe('TurnstileWidget', () => {
  it('shows nothing while the widget works, and passes the token on', () => {
    const options = stubTurnstile();
    const onToken = vi.fn();
    render(<TurnstileWidget onToken={onToken} />);
    act(() => options().callback!('token-1'));
    expect(onToken).toHaveBeenCalledWith('token-1');
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('says why Send is stuck when the widget errors, and clears it on a later success', () => {
    const options = stubTurnstile();
    render(<TurnstileWidget onToken={() => {}} />);
    act(() => { options()['error-callback']!('300030'); });
    expect(screen.getByRole('alert').textContent).toMatch(MESSAGE);

    act(() => options().callback!('token-1'));
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('says why when the script never loads', () => {
    vi.useFakeTimers();
    render(<TurnstileWidget onToken={() => {}} />);
    expect(screen.queryByText(MESSAGE)).toBeNull();
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(screen.getByRole('alert').textContent).toMatch(MESSAGE);
  });
});
