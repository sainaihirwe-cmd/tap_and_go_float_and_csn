const crypto = require('crypto');
const nodemailer = require('nodemailer');

function createInvitationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  };
}

function ensureInvitationConfigured() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !process.env.FRONTEND_URL) {
    throw Object.assign(
      new Error('Email invitations are not configured. Set EMAIL_USER, EMAIL_PASS, and FRONTEND_URL on the backend.'),
      { status: 503, expose: true }
    );
  }
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmail({ to, subject, html }) {
  try {
    const info = await transporter.sendMail({
      from: `"Tap & Go" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log('Email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
}

async function sendStaffInvitation({ email, name, role, token }) {
  await sendStaffAccessEmail({
    email,
    name,
    role,
    token,
    mode: 'setup',
    subject: `Set up your Tap & Go ${role} account`,
    description: 'Your Tap & Go account is ready. Create your password using this one-time link:',
    action: 'Set up your account'
  });
}

async function sendStaffPasswordReset({ email, name, role, token }) {
  await sendStaffAccessEmail({
    email,
    name,
    role,
    token,
    mode: 'reset',
    subject: `Reset your Tap & Go ${role} password`,
    description: 'An administrator requested a password reset for your Tap & Go account. Choose a new password using this one-time link:',
    action: 'Reset your password'
  });
}

async function sendStaffAccessEmail({ email, name, role, token, mode, subject, description, action }) {
  ensureInvitationConfigured();
  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const setupUrl = `${frontendUrl}/#setupToken=${encodeURIComponent(token)}&mode=${mode}`;

  const html = `<p>Hello ${name || role},</p><p>${description}</p><p><strong>Login email:</strong> ${email}</p><p><a href="${setupUrl}">${action}</a></p><p>This one-time link expires in 24 hours. After choosing your password, sign in to the Tap & Go mobile app with the login email above. For your security, we never send passwords by email.</p><p>If you were not expecting this email, contact your administrator.</p>`;

  await sendEmail({ to: email, subject, html });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '\\"')
    .replace(/'/g, "'");
}

module.exports = { createInvitationToken, ensureInvitationConfigured, sendStaffInvitation, sendStaffPasswordReset, sendEmail };