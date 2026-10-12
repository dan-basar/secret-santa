import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// A real Postgres (PGlite, Postgres compiled to WebAssembly, in memory) behind
// the same interface as the Neon client in src/lib/db.ts: sql`...` with bind
// parameters, and sql.transaction([...]) running every statement in one
// transaction. Tests mock @/lib/db with it so the routes' SQL actually runs
// against the schema in sql/setup.sql.

interface Query extends PromiseLike<Record<string, unknown>[]> {
  text: string;
  values: unknown[];
}

export async function createTestSql() {
  const pg = new PGlite();
  await pg.exec(readFileSync(new URL('../../sql/setup.sql', import.meta.url), 'utf8'));

  function sql(strings: TemplateStringsArray, ...values: unknown[]): Query {
    const text = strings.reduce((acc, part, i) => acc + `$${i}` + part);
    return {
      text,
      values,
      then(onFulfilled, onRejected) {
        return pg.query<Record<string, unknown>>(text, values).then(r => r.rows).then(onFulfilled, onRejected);
      },
    };
  }

  sql.transaction = (queries: Query[], _options?: { readOnly?: boolean }) =>
    pg.transaction(async tx => {
      const results: Record<string, unknown>[][] = [];
      for (const q of queries) results.push((await tx.query<Record<string, unknown>>(q.text, q.values)).rows);
      return results;
    });

  return { sql, pg };
}
