-- Exchange details (F1): the organizer can add a note, a budget and an exchange
-- date on the organizer page. They go into each match email and show on each
-- personal link page. All three are optional, so every column is nullable and
-- existing draws simply have none.
-- * organizer_note: up to 150 characters of plain text, no links (send-emails.ts)
-- * budget_cents: the budget in cents; NULL = no budget set. 0 is allowed and
--   shows as "No limit set". Capped at $10,000
-- * exchange_date: the day of the exchange, with no time or time zone
-- Run once against each database (Neon dev branch first, then production).

BEGIN;

ALTER TABLE Draws
     ADD COLUMN organizer_note varchar(150) NULL
    ,ADD COLUMN budget_cents integer NULL
    ,ADD COLUMN exchange_date date NULL
    ,ADD CONSTRAINT CK_Draws_BudgetCents CHECK (budget_cents BETWEEN 0 AND 1000000);

COMMIT;
