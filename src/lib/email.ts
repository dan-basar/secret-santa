import nodemailer from 'nodemailer';
import { escapeHtml } from '@/lib/sanitize';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

/**
 * Public URL of a participant's private reveal page. NEXT_PUBLIC_BASE_URL is the
 * site origin; the /secret-santa basePath is added here, and stripped first if
 * the setting already ends with it, so it is never doubled.
 */
export function revealUrl(revealToken: string): string {
  const origin = (process.env.NEXT_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '').replace(/\/secret-santa$/, '');
  return `${origin}/secret-santa/reveal/${encodeURIComponent(revealToken)}`;
}

export async function sendMatchEmail(
  toName: string,
  toEmail: string,
  matchName: string,
  organizerName: string,
  organizerEmail: string,
  revealToken: string
): Promise<void> {
  const link = revealUrl(revealToken);

  // Values are stored as plain text, so escape each one before it goes into HTML
  const htmlToName = escapeHtml(toName);
  const htmlMatchName = escapeHtml(matchName);
  const htmlOrganizerName = escapeHtml(organizerName);
  const htmlOrganizerEmail = escapeHtml(organizerEmail);
  const htmlLink = escapeHtml(link);

  // The match is named a few lines down so a phone's inbox preview, which shows
  // the first line or two of the body, doesn't give it away
  await transporter.sendMail({
    from: `Secret Santa <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: "🎁 Your Secret Santa Match",
    text: `Hi ${toName},\n\nThe Secret Santa draw is done, and your match is waiting for you.\n\nYou have drawn ${matchName}'s name for the gift exchange.\n\nView your match any time: ${link}\n\nThis secret message was sent by ${organizerName}. You can contact the organizer at ${organizerEmail} if you need to. Happy Gifting!!`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px; color: #1a1a1a;">
        <p style="font-size: 18px; margin-bottom: 24px;">Hi ${htmlToName},</p>
        <p style="font-size: 16px; line-height: 1.6;">The Secret Santa draw is done, and your match is waiting for you.</p>
        <p style="font-size: 16px; line-height: 1.6; margin-top: 32px;">
          You have drawn <strong>${htmlMatchName}</strong>'s name for the gift exchange.
        </p>
        <p style="margin: 32px 0;">
          <a href="${htmlLink}" style="display: inline-block; padding: 12px 24px; background: #c84b2f; color: #ffffff; text-decoration: none; border-radius: 6px; font-family: Arial, sans-serif; font-size: 16px;">View your match</a>
        </p>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">This secret message was sent by ${htmlOrganizerName}. You can contact the organizer at ${htmlOrganizerEmail} if you need to. Happy Gifting!!</p>
      </div>
    `,
  });
}
