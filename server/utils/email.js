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
      { status: 503 }
    );
  }
}

async function sendStaffInvitation({ email, name, role, token }) {
  ensureInvitationConfigured();
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const setupUrl = `${frontendUrl}/#setupToken=${encodeURIComponent(token)}`;
  const safeName = escapeHtml(name || role);
  const safeRole = escapeHtml(role);
  const safeEmail = escapeHtml(email);
  const safeSetupUrl = escapeHtml(setupUrl);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `Set up your Tap & Go ${role} account`,
      text: `Hello ${name || role},\n\nYour Tap & Go ${role} account is ready.\nLogin email: ${email}\n\nCreate your password using this one-time link (expires in 24 hours):\n${setupUrl}\n\nAfter setting your password, sign in to the Tap & Go mobile app with the login email above and your new password. For your security, we never send passwords by email.\n\nIf you were not expecting this email, you can ignore it.`,
      html: `<p>Hello ${safeName},</p><p>Your Tap &amp; Go ${safeRole} account is ready.</p><p><strong>Login email:</strong> ${safeEmail}</p><p>Create your password using this one-time link. It expires in 24 hours.</p><p><a href="${safeSetupUrl}">Set up your account</a></p><p>After setting your password, sign in to the Tap &amp; Go mobile app with the login email above and your new password. For your security, we never send passwords by email.</p><p>If you were not expecting this email, you can ignore it.</p>`
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Invitation email delivery failed (HTTP ${response.status}): ${body.slice(0, 500)}`);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

module.exports = { createInvitationToken, ensureInvitationConfigured, sendStaffInvitation };
