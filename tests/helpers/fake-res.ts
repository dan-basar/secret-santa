import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

// What a route sent back: its status, headers and JSON body
export interface RouteResult<Body = unknown> {
  statusCode: number;
  body: Body;
  headers: Record<string, string>;
}

/**
 * Calls an API route the way Next.js would, with a stand-in response that
 * records what the route sends. Request fields left out are empty
 */
export async function callRoute<Body = unknown>(
  handler: NextApiHandler,
  req: { method: string; body?: unknown; query?: Record<string, unknown>; headers?: Record<string, unknown> }
): Promise<RouteResult<Body>> {
  const res = {
    statusCode: 0,
    body: undefined as unknown as Body,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: Body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
  await handler({ query: {}, headers: {}, ...req } as unknown as NextApiRequest, res as unknown as NextApiResponse);
  return res;
}
