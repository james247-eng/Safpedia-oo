const EMAILJS_ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';
const DEFAULT_ACTION_URL = process.env.APP_URL || 'https://safpedia-oo.vercel.app';

async function sendEmail({
  toEmail,
  toName,
  subject,
  headline,
  bodyContent,
  actionUrl,
  actionText
}) {
  if (!toEmail) {
    console.warn('Email dispatch skipped: recipient email is missing');
    return { success: false, skipped: true };
  }

  const serviceId = process.env.EMAILJS_SERVICE_ID;
  const templateId = process.env.EMAILJS_TEMPLATE_ID;
  const publicKey = process.env.EMAILJS_PUBLIC_KEY || process.env.EMAILJS_USER_ID;

  if (!serviceId || !templateId || !publicKey) {
    console.warn('Email dispatch skipped: EmailJS configuration is incomplete');
    return { success: false, skipped: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const payload = {
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      template_params: {
        to_email: toEmail,
        to_name: toName || 'Valued User',
        subject,
        headline,
        body_content: bodyContent,
        action_url: actionUrl || DEFAULT_ACTION_URL,
        action_text: actionText || 'View Dashboard'
      }
    };

    if (process.env.EMAILJS_PRIVATE_KEY) {
      payload.accessToken = process.env.EMAILJS_PRIVATE_KEY;
    }

    const response = await fetch(EMAILJS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`EmailJS returned ${response.status}: ${await response.text()}`);
    }

    return { success: true };
  } catch (error) {
    console.error('Email dispatch failed (non-blocking):', error.message);
    return { success: false, error };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendEmail };
