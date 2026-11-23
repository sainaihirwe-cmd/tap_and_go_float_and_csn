const crypto = require('crypto');

function createInvitationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  };
}

function ensureInvitationConfigured() {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.FRONTEND_URL) {
    throw Object.assign(
      new Error('Email invitations are not configured. Set RESEND_API_KEY, EMAIL_FROM, and FRONTEND_URL on the backend.'),
      { status: 503, expose: true }
    );
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
  const from = process.env.EMAIL_FROM;
  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const setupUrl = `${frontendUrl}/#setupToken=${encodeURIComponent(token)}&mode=${mode}`;
  const safeName = escapeHtml(name || role);
  const safeEmail = escapeHtml(email);
  const safeSetupUrl = escapeHtml(setupUrl);
  const safeDescription = escapeHtml(description);
  const safeAction = escapeHtml(action);

  const html = `<p>Hello ${safeName},</p><p>${safeDescription}</p><p><strong>Login email:</strong> ${safeEmail}</p><p><a href="${safeSetupUrl}">${safeAction}</a></p><p>This one-time link expires in 24 hours. After choosing your password, sign in to the Tap & Go mobile app with the login email above. For your security, we never send passwords by email.</p><p>If you were not expecting this email, contact your administrator.</p>`;

  const text = `Hello ${name || role},\n\n${description}\n\n${setupUrl}\n\nThis one-time link expires in 24 hours. After choosing your password, sign in to the Tap & Go mobile app with ${email}. For your security, we never send passwords by email.\n\nIf you were not expecting this email, contact your administrator.`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject,
      html,
      text
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${response.status} ${error}`);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '\\"')
    .replace(/'/g, "'");
}

module.exports = { createInvitationToken, ensureInvitationConfigured, sendStaffInvitation, sendStaffPasswordReset };