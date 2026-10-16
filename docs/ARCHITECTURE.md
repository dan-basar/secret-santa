# Architecture

A short tour for someone new to the code. Setup and the API table are in the [README](../README.md); day-to-day operations are in [OPERATIONS.md](OPERATIONS.md).

## Two secrets, two levels of access

There are no accounts. Access comes from two random secrets of letters and digits ([`src/lib/tokens.ts`](../src/lib/tokens.ts)), each carried in a link:

| Secret | Link | Unlocks |
|---|---|---|
| **Admin key** (14 characters) | `/draw#<adminKey>` (the organizer's link) | Everything about the draw: matches, email addresses, groups, every personal reveal link, per-person email status; saving the note, budget and date, sending and resending emails, Edit & Redraw, deleting |
| **Reveal token** (8 characters) | `/reveal/<token>` (one per participant) | That one person's own match, the draw date and, once emails are sent, the organizer's name. Nothing about anyone else |

The admin key is returned once, by `create-draw`, and the organizer is redirected to their link. It travels in the URL fragment, which browsers never send to the server; the draw page reads it there and sends it to `get-draw` in an `X-Admin-Key` header (and in the JSON body to `send-emails`, `save-details` and `delete-draw`), so it never appears in a query string or request log. `get-draw` finds the draw by the key alone, so the draw's own uuid never appears in a link. The organizer page shows the link in a box with a Copy button, marked private; it is never shown to anyone else, so losing it means losing admin access. Every draw has one (`admin_key` is `NOT NULL` and `UNIQUE`).

The secrets are short so links fit in a text: the organizer link is about 61 characters and a personal link about 57. 14 characters from 62 are about 83 random bits and 8 about 48; what keeps guessing out of reach is the per-IP limit of 60 lookups an hour on `get-draw` and `reveal` (`src/proxy.ts`). Personal links get the shorter secret because each shows only one match. Links from before migration 008 (UUIDs, `/draw/<id>#key=…`, `?key=`) no longer open anything.

## Draw lifecycle

```mermaid
stateDiagram-v2
    [*] --> Created: create-draw
    Created --> EmailsSent: send-emails (first send)
    EmailsSent --> EmailsSent: send-emails retryFailed (only people whose email failed)
    Created --> Deleted: delete-draw, or Edit & Redraw saves a replacement
    EmailsSent --> Deleted: delete-draw
    Deleted --> [*]
```

- **Created.** Matches are drawn and saved with the draw. The organizer can share personal links, send emails, Edit & Redraw, or delete. When nobody has an email address, sending emails just the organizer their link (one email against the cap) and the draw stays in this state.
- **Edit & Redraw** (only before emails go out) copies the participants back into the home page form. The old draw stays live until the new one is saved; `create-draw` then soft-deletes the old draw in the **same transaction** that saves the new one, so there is never a moment with neither or both. The new draw keeps the old one's saved note, budget and date.
- **Emails sent.** Before anything goes out, one transaction checks the email cap in `EmailSendLog` (495 in any 24 hours, across all draws; `503` if it doesn't fit) and the sender's IP budget in `RateLimits` (100 in any 24 hours; `429` if it doesn't fit), on the first send records the organizer's name and email and sets `Draws.emails_sent_at`, claims each participant (`Participants.email_claimed_at`), and reserves the cap and the IP budget for everyone claimed plus one for the organizer, who is emailed their organizer link alongside the match emails. Failed emails give their reservation back. When that one email settles, `email_sent_at` is set if it went out, or the claim is released if it failed, so the organizer can resend to just those people. A claim older than 5 minutes is from a request that died mid-send and can be taken again. A second full send is refused (`409`). Redraw is blocked from here on, in the UI and in `create-draw`, because emails can't be taken back.
- **Deleted.** `deleted_at` is set; the rows stay. Every link to the draw, including personal links, then gets `410` / "no longer available".

## Request path

```
Browser
  │  /secret-santa/...   (basePath from src/lib/base-path.json)
  ▼
Vercel (region cle1)
  │
  ├─ Vercel Firewall ── /secret-santa/api/*: 60 requests a minute per IP → 429,
  │     before any function runs (set on the baseworkshop-home project; docs/OPERATIONS.md)
  │
  ├─ src/proxy.ts ── runs only on the six limited routes (health skips it)
  │     create-draw, send-emails, save-details, delete-draw, get-draw, reveal: per-IP hourly limit,
  │     counted in the RateLimits table → 429 when over; fails open on DB error
  │
  ├─ src/pages/api/<route>.ts ── validate input → query → JSON response
  │     send-emails also calls Cloudflare Turnstile (CAPTCHA) and Gmail SMTP
  │
  └─ src/lib/db.ts ── Neon serverless driver: each query is one HTTPS request
        to Neon Postgres (AWS US East 2); multi-step writes use sql.transaction()
```

Pages (`index.tsx`, `draw.tsx`, `reveal/[token].tsx`) are client-rendered React; they call the API routes with `fetch`.

## Tables

```
Draws (id uuid)
  │ 1
  ├──< Participants (draw_id, position 1..n, reveal_code, email_sent_at, email_claimed_at)
  │         ▲ giver_participant_id     ▲ receiver_participant_id
  └──< Matches (draw_id) ──────────────┘

EmailSendLog (hour_start)             — emails sent per hour, all draws
RateLimits (bucket, window_start)     — hits per hashed client (IPv4 or IPv6 /64) + route per hour, and emails per hashed client per hour (the 24-hour email budget)
```

- **Draws** — one row per draw: admin key, timestamps (`emails_sent_at`, `deleted_at` double as flags), organizer name/email once emails are sent, and the optional organizer note, budget (in cents) and exchange date.
- **Participants** — one row per person: name, optional email, optional group name, position in the draw, their reveal token, when their email went out, and a short-lived claim while it is being sent.
- **Matches** — one row per giver → receiver pair, pointing at two Participants rows. Pairs are linked by position, not by name (create-draw separately refuses names that match ignoring case and spaces, so people can tell who they drew). Each participant appears once as a giver and once as a receiver (`UNIQUE` on both columns).
- **EmailSendLog** and **RateLimits** are counters, not tied to any draw.

The schema, with comments, is [`sql/setup.sql`](../sql/setup.sql).

## What data we keep

| Data | Where | How long |
|---|---|---|
| Participant names, optional emails, group names | Participants | Kept, including after the draw is soft-deleted |
| Who drew whom | Matches | Kept with the draw |
| Organizer name and email | Draws, set on first send | Kept with the draw |
| Organizer note, budget, exchange date | Draws, set by save-details or the first send | Kept with the draw |
| Admin key, reveal tokens | Draws, Participants | Kept with the draw |
| Hashed IP + route hit counts, and emails per hashed IP | RateLimits (HMAC-SHA-256 with a secret key; raw IPs never stored) | About 2 days, then hard-deleted by `src/proxy.ts` |
| Emails sent per hour | EmailSendLog (a count only) | Kept |

Draws are only ever soft-deleted: deleting hides a draw from every link but keeps the rows. Participant and organizer email addresses are kept too, by decision for now; there is no purge job. Emails themselves are sent through the Gmail account in `GMAIL_USER`, so copies also sit in its Sent folder.
