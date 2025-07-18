export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  const { uid } = req.body;

  if (!uid) {
    return res.status(400).json({ success: false, message: '缺少 UID' });
  }

  try {
    const result = await fetch(`https://api.line.me/v2/bot/user/${uid}/richmenu/${process.env.LINE_RICHMENU_ID}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_TOKEN}`
      }
    });

    if (!result.ok) {
      const errorText = await result.text();
      return res.status(result.status).json({ success: false, message: errorText });
    }
<!-- force redeploy -->
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
