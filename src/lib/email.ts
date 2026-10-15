import nodemailer from 'nodemailer';
import { escapeHtml } from '@/lib/sanitize';
import { siteUrl } from '@/lib/site';
import { budgetLine, formatExchangeDate, hasDetails } from '@/lib/details';
import type { ExchangeDetails } from '@/types/api';

// Nodemailer waits up to 2 minutes to connect and 10 minutes on an idle socket by
// default, far past send-emails' 60s function limit. 15s makes a stalled send
// fail as a normal error, so its claim is released while the function is alive
const SMTP_TIMEOUT_MS = 15_000;

// A draw's emails share 3 reused SMTP connections instead of opening one per
// email, which is faster and less likely to be throttled by Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  pool: true,
  maxConnections: 3,
  connectionTimeout: SMTP_TIMEOUT_MS,
  greetingTimeout: SMTP_TIMEOUT_MS,
  socketTimeout: SMTP_TIMEOUT_MS,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

/** Public URL of a participant's private reveal page */
export function revealUrl(revealToken: string): string {
  return siteUrl(`/reveal/${encodeURIComponent(revealToken)}`);
}

export async function sendMatchEmail(
  toName: string,
  toEmail: string,
  matchName: string,
  organizerName: string,
  organizerEmail: string,
  revealToken: string,
  details: ExchangeDetails
): Promise<void> {
  const link = revealUrl(revealToken);

  // Values are stored as plain text, so escape each one before it goes into HTML
  const htmlToName = escapeHtml(toName);
  const htmlMatchName = escapeHtml(matchName);
  const htmlOrganizerName = escapeHtml(organizerName);
  const htmlOrganizerEmail = escapeHtml(organizerEmail);
  const htmlLink = escapeHtml(link);
  // Hosted rather than attached; the 192px icon keeps it sharp at 96px on high-DPI screens
  const logoUrl = escapeHtml(siteUrl('/icon-192.png'));

  // The organizer's note, budget and date, each only when set, come before the match
  const withDetails = hasDetails(details);
  const detailLines: { label: string; value: string }[] = [];
  if (details.budget_cents !== null) detailLines.push({ label: 'Budget', value: budgetLine(details.budget_cents) });
  if (details.exchange_date) detailLines.push({ label: 'Exchange', value: formatExchangeDate(details.exchange_date) });

  const textDetails = withDetails
    ? [
      'First, some details:',
      ...(details.organizer_note ? ['A note from your organizer:', `"${details.organizer_note}"`] : []),
      ...detailLines.map(line => `${line.label}: ${line.value}`),
      '',
      'And now the big reveal:',
      '',
      '',
    ].join('\n')
    : '';
  const htmlDetails = withDetails ? `
        <p style="font-size: 16px; line-height: 1.6;">First, some details:</p>
        <div style="border-left: 3px solid #c84b2f; background: #faf8f5; padding: 12px 16px; margin: 8px 0 0; font-size: 15px; line-height: 1.5;">${
          details.organizer_note ? `
          <p style="margin: 0 0 8px;"><strong>A note from your organizer:</strong><br>&ldquo;${escapeHtml(details.organizer_note)}&rdquo;</p>` : ''}${
          detailLines.map(line => `
          <p style="margin: 0 0 4px;"><strong>${line.label}:</strong> ${escapeHtml(line.value)}</p>`).join('')}
        </div>
        <p style="font-size: 16px; line-height: 1.6; margin-top: 32px;">And now the big reveal:</p>` : '';

  // The match is named a few lines down so a phone's inbox preview, which shows
  // the first line or two of the body, doesn't give it away
  await transporter.sendMail({
    from: `Secret Santa <${process.env.GMAIL_USER}>`,
    to: toEmail,
    // A participant who hits Reply reaches the organizer, not the app's Gmail inbox
    replyTo: organizerEmail,
    subject: "🎁 Your Secret Santa Match",
    text: `Hi ${toName},\n\nThe Secret Santa draw is done, and your match is below.\n\n${textDetails}You have drawn ${matchName}'s name for the gift exchange!\n\nView your match any time: ${link}\n\nThis secret message was sent by ${organizerName}. You can contact the organizer at ${organizerEmail} if you need to. Happy Gifting!!`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px; color: #1a1a1a;">
        <img src="${logoUrl}" width="96" height="96" alt="Secret Santa Picker" style="display: block; margin: 0 auto 24px; border: 0;">
        <p style="font-size: 18px; margin-bottom: 24px;">Hi ${htmlToName},</p>
        <p style="font-size: 16px; line-height: 1.6;">The Secret Santa draw is done, and your match is below.</p>${htmlDetails}
        <p style="font-size: 20px; line-height: 1.5; margin-top: ${withDetails ? 16 : 32}px;">
          You have drawn <strong>${htmlMatchName}</strong>'s name for the gift exchange!
        </p>
        <p style="margin: 32px 0;">
          <a href="${htmlLink}" style="display: inline-block; padding: 12px 24px; background: #c84b2f; color: #ffffff; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 16px;">View your match</a>
        </p>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">This secret message was sent by ${htmlOrganizerName}. You can contact the organizer at ${htmlOrganizerEmail} if you need to. Happy Gifting!!</p>
      </div>
    `,
  });
}

/** Public URL of the organizer's page; the admin key rides in the fragment */
export function organizerUrl(adminKey: string): string {
  return siteUrl(`/draw#${encodeURIComponent(adminKey)}`);
}

// The organizer's own copy of their link, so losing the tab doesn't lose the
// draw. It goes out with the first send, or on its own when nobody has an email
export async function sendOrganizerLinkEmail(
  toName: string,
  toEmail: string,
  adminKey: string
): Promise<void> {
  const link = organizerUrl(adminKey);

  const htmlToName = escapeHtml(toName);
  const htmlLink = escapeHtml(link);
  const logoUrl = escapeHtml(siteUrl('/icon-192.png'));

  await transporter.sendMail({
    from: `Secret Santa <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: "🎁 Your Secret Santa organizer link",
    text: `Hi ${toName},\n\nHere is your organizer link for your Secret Santa draw. Keep it private: it shows everyone's matches! It's the only way back to your draw's page.\n\nYour organizer link: ${link}\n\nHappy Gifting!!`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px; color: #1a1a1a;">
        <img src="${logoUrl}" width="96" height="96" alt="Secret Santa Picker" style="display: block; margin: 0 auto 24px; border: 0;">
        <p style="font-size: 18px; margin-bottom: 24px;">Hi ${htmlToName},</p>
        <p style="font-size: 16px; line-height: 1.6;">Here is your organizer link for your Secret Santa draw.</p>
        <p style="font-size: 16px; line-height: 1.6;">Keep it private: it shows everyone&rsquo;s matches! It&rsquo;s the only way back to your draw&rsquo;s page.</p>
        <p style="margin: 32px 0;">
          <a href="${htmlLink}" style="display: inline-block; padding: 12px 24px; background: #c84b2f; color: #ffffff; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 16px;">Open your draw</a>
        </p>
        <p style="font-size: 14px; color: #888; margin-top: 32px; word-break: break-all;">${htmlLink}</p>
      </div>
    `,
  });
}
