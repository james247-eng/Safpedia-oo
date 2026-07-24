const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { requireAdmin } = require('../../lib/auth');

/**
 * Zoom Server-to-Server OAuth token exchange.
 * Requires a Server-to-Server OAuth app created in the Zoom Marketplace
 * (not the older JWT app type, which Zoom has deprecated).
 */
async function getZoomAccessToken() {
  const accountId = process.env.ZOOM_ACCOUNT_ID;
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;

  if (!accountId || !clientId || !clientSecret) {
    throw new Error('Zoom credentials not configured (ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET)');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const tokenRes = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}` }
    }
  );

  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    throw new Error(tokenJson.reason || 'Could not obtain Zoom access token');
  }
  return tokenJson.access_token;
}

/**
 * POST /api/zoom/create-meeting
 * Admin only. Creates a scheduled Zoom meeting for a live course lesson.
 * Body: { topic, startTime, durationMinutes? }
 *   - startTime: any value new Date() can parse (the admin form sends datetime-local)
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const admin = getFirebaseAdmin();
    await requireAdmin(req, admin);

    const { topic, startTime, durationMinutes } = req.body || {};
    if (!topic || !startTime) {
      return res.status(400).json({ error: 'Missing topic or startTime' });
    }

    const accessToken = await getZoomAccessToken();

    const meetingRes = await fetch('https://api.zoom.us/v2/users/me/meetings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        topic,
        type: 2, // scheduled meeting
        start_time: new Date(startTime).toISOString(),
        duration: durationMinutes || 60,
        timezone: 'Africa/Lagos',
        settings: {
          join_before_host: false,
          waiting_room: true,
          approval_type: 0 // automatically approve
        }
      })
    });

    const meetingJson = await meetingRes.json();

    if (!meetingRes.ok) {
      console.error('Zoom meeting creation failed:', meetingJson);
      return res.status(502).json({
        error: meetingJson.message || 'Could not create Zoom meeting',
        details: meetingJson
      });
    }

    return res.status(200).json({
      success: true,
      meetingId: meetingJson.id,
      joinUrl: meetingJson.join_url,   // for students
      startUrl: meetingJson.start_url, // for the instructor/host
      startTime: meetingJson.start_time
    });

  } catch (err) {
    console.error('create-meeting error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};