/**
 * One-off copy of every row from the old Azure SQL database into Neon Postgres.
 *
 * Usage (PowerShell, from the repo root). Apply sql/setup.sql to the Neon
 * database first; the script refuses to run if Neon already has any draws.
 *
 *   $env:AZURE_SQL_SERVER   = 'your-server.database.windows.net'
 *   $env:AZURE_SQL_DATABASE = 'your-database-name'
 *   $env:AZURE_SQL_USER     = 'your-db-username'
 *   $env:AZURE_SQL_PASSWORD = 'your-db-password'
 *   $env:DATABASE_URL       = 'postgresql://...neon.tech/neondb?sslmode=require'
 *   npx tsx scripts/copy-azure-to-neon.ts
 *
 * Draw GUIDs and participant/match ids are kept as-is (so existing links and
 * foreign keys still line up), soft-deleted draws are included, and
 * Participants.position is filled from id order within each draw. The whole
 * Neon write is one transaction: it either all lands or none of it does.
 */
import mssql from 'mssql';
import { neon } from '@neondatabase/serverless';

const TABLES = ['Draws', 'Participants', 'Matches', 'DailyEmailLog'] as const;

const toIso = (value: Date | null) => (value ? value.toISOString() : null);

async function main() {
  const azure = await mssql.connect({
    server: process.env.AZURE_SQL_SERVER!,
    database: process.env.AZURE_SQL_DATABASE!,
    user: process.env.AZURE_SQL_USER!,
    password: process.env.AZURE_SQL_PASSWORD!,
    options: { encrypt: true, trustServerCertificate: false },
    connectionTimeout: 30000,
    requestTimeout: 30000,
  });
  const sql = neon(process.env.DATABASE_URL!);

  try {
    const existing = await sql`SELECT COUNT(*)::int as draw_count FROM Draws`;
    if (existing[0].draw_count > 0) {
      throw new Error(`Neon already has ${existing[0].draw_count} draws. Run this only against an empty schema.`);
    }

    const draws = (await azure.request().query(`
      SELECT
           id
          ,created_at
          ,emails_sent_at
          ,deleted_at
          ,organizer_name
          ,organizer_email
          ,admin_key
      FROM Draws
    `)).recordset;

    const participants = (await azure.request().query(`
      SELECT
           id
          ,draw_id
          ,ROW_NUMBER() OVER (PARTITION BY draw_id ORDER BY id) as position
          ,name
          ,email
          ,group_name
      FROM Participants
    `)).recordset;

    const matches = (await azure.request().query(`
      SELECT
           id
          ,draw_id
          ,giver_participant_id
          ,receiver_participant_id
      FROM Matches
    `)).recordset;

    const emailLog = (await azure.request().query(`
      SELECT
           log_date
          ,emails_sent
      FROM DailyEmailLog
    `)).recordset;

    console.log(`Read from Azure: ${draws.length} draws, ${participants.length} participants, ${matches.length} matches, ${emailLog.length} email log rows`);

    // Arrays are sent as bind parameters and unpacked with unnest, so each table
    // is one INSERT regardless of row count
    await sql.transaction([
      sql`
        INSERT INTO Draws (id, created_at, emails_sent_at, deleted_at, organizer_name, organizer_email, admin_key)
        SELECT
             source.id
            ,source.created_at
            ,source.emails_sent_at
            ,source.deleted_at
            ,source.organizer_name
            ,source.organizer_email
            ,source.admin_key
        FROM unnest(${draws.map(d => d.id)}::uuid[], ${draws.map(d => toIso(d.created_at))}::timestamptz[], ${draws.map(d => toIso(d.emails_sent_at))}::timestamptz[], ${draws.map(d => toIso(d.deleted_at))}::timestamptz[], ${draws.map(d => d.organizer_name)}::varchar[], ${draws.map(d => d.organizer_email)}::varchar[], ${draws.map(d => d.admin_key)}::varchar[]) as source(id, created_at, emails_sent_at, deleted_at, organizer_name, organizer_email, admin_key)
      `,
      sql`
        INSERT INTO Participants (id, draw_id, position, name, email, group_name)
        OVERRIDING SYSTEM VALUE
        SELECT
             source.id
            ,source.draw_id
            ,source.position
            ,source.name
            ,source.email
            ,source.group_name
        FROM unnest(${participants.map(p => p.id)}::int[], ${participants.map(p => p.draw_id)}::uuid[], ${participants.map(p => Number(p.position))}::int[], ${participants.map(p => p.name)}::varchar[], ${participants.map(p => p.email || null)}::varchar[], ${participants.map(p => p.group_name)}::varchar[]) as source(id, draw_id, position, name, email, group_name)
      `,
      sql`
        INSERT INTO Matches (id, draw_id, giver_participant_id, receiver_participant_id)
        OVERRIDING SYSTEM VALUE
        SELECT
             source.id
            ,source.draw_id
            ,source.giver_participant_id
            ,source.receiver_participant_id
        FROM unnest(${matches.map(m => m.id)}::int[], ${matches.map(m => m.draw_id)}::uuid[], ${matches.map(m => m.giver_participant_id)}::int[], ${matches.map(m => m.receiver_participant_id)}::int[]) as source(id, draw_id, giver_participant_id, receiver_participant_id)
      `,
      sql`
        INSERT INTO DailyEmailLog (log_date, emails_sent)
        SELECT
             source.log_date
            ,source.emails_sent
        FROM unnest(${emailLog.map(l => (l.log_date as Date).toISOString().slice(0, 10))}::date[], ${emailLog.map(l => l.emails_sent)}::int[]) as source(log_date, emails_sent)
      `,
      // Move the identity sequences past the copied ids so new rows don't collide
      sql`SELECT setval(pg_get_serial_sequence('participants', 'id'), COALESCE((SELECT MAX(id) FROM Participants), 0) + 1, false)`,
      sql`SELECT setval(pg_get_serial_sequence('matches', 'id'), COALESCE((SELECT MAX(id) FROM Matches), 0) + 1, false)`,
    ]);

    console.log('\nRow counts (Azure -> Neon):');
    for (const table of TABLES) {
      // Table names come from the constant list above, not from input
      const azureCount = (await azure.request().query(`SELECT COUNT(*) as row_count FROM ${table}`)).recordset[0].row_count;
      const neonCount = (await sql.query(`SELECT COUNT(*)::int as row_count FROM ${table}`))[0].row_count;
      const status = azureCount === neonCount ? 'OK' : 'MISMATCH';
      console.log(`  ${table.padEnd(14)} ${String(azureCount).padStart(6)} -> ${String(neonCount).padStart(6)}  ${status}`);
    }
  } finally {
    await azure.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
