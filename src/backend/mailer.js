// Outgoing email (password reset). SMTP settings come from the environment:
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, SMTP_SECURE ("true" for port 465),
//   MAIL_FROM (default "Gnumbat <no-reply@gnumbat>")
// Any provider with SMTP works (Resend, Postmark, SendGrid, Mailgun, Gmail app password, ...).
// Not configured (or nodemailer not installed yet) => the message is printed to this server's
// console instead, so the whole flow can still be tested locally.
let transport = null
let nodemailer = null
try { nodemailer = require('nodemailer') } catch { nodemailer = null }

function getTransport() {
  if (transport || !nodemailer || !process.env.SMTP_HOST) return transport
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  })
  return transport
}

async function sendMail({ to, subject, text }) {
  const t = getTransport()
  if (!t) {
    console.log(`\n[mailer] SMTP not configured -- email NOT sent. Would have sent to ${to}:\n  Subject: ${subject}\n${text.split('\n').map(l => '  ' + l).join('\n')}\n`)
    return { sent: false }
  }
  await t.sendMail({ from: process.env.MAIL_FROM || 'Gnumbat <no-reply@gnumbat>', to, subject, text })
  return { sent: true }
}

module.exports = { sendMail }
