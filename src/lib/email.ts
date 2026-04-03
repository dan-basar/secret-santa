import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

export async function sendMatchEmail(
  toName: string,
  toEmail: string,
  matchName: string,
  organizerName: string,
  organizerEmail: string
): Promise<void> {
  await transporter.sendMail({
    from: `Secret Santa <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: "🎁 Your Secret Santa Match",
    text: `Dear ${toName},\n\nYou have drawn ${matchName}'s name for the gift exchange.\n\nThis secret message was sent by ${organizerName}. You can contact the organizer at ${organizerEmail} if you need to. Happy Gifting!!`,
    html: `
      <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px; color: #1a1a1a;">
        <p style="font-size: 18px; margin-bottom: 24px;">Dear ${toName},</p>
        <p style="font-size: 16px; line-height: 1.6;">
          You have drawn <strong>${matchName}</strong>'s name for the gift exchange.
        </p>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">This secret message was sent by ${organizerName}. You can contact the organizer at ${organizerEmail} if you need to. Happy Gifting!!</p>
      </div>
    `,
  });
}

