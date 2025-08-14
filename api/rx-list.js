import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!process.env.LINE_CHANNEL_ID) return res.status(500).json({ error: 'Missing LINE_CHANNEL_ID in env' });

    const { id_token } = req.body || {};
    if (!id_token) return res.status(400).json({ error: 'id_token required' });

    const isJwt = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(id_token);
    if (!isJwt) {
      return res.status(401).json({
        error: 'invalid_id_token_format',
        detail: 'Expected JWT like xxx.yyy.zzz from liff.getIDToken()',
      });
    }

    const vr = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token, client_id: process.env.LINE_CHANNEL_ID })
    });
    const v = await vr.json();
    if (!vr.ok) {
      return res.status(401).json({
        error: 'verify_failed',
        detail: v.error_description || v.error || JSON.stringify(v),
        hint: 'Check LINE_CHANNEL_ID = LIFF 所屬 Channel 的 Channel ID（數字），且 LIFF scopes 有 openid/profile。'
      });
    }

    const uid = v.sub;

    const { data, error } = await sb
      .from('px_call_list')
      .select('name, rcp_date, pre_date, linkcan, linkno')
      .eq('uid', uid)
      .order('name', { ascending: true })
      .order('pre_date', { ascending: false })
      .order('rcp_date', { ascending: false });

    if (error) throw error;

    const groupsMap = {};
    for (const row of (data || [])) {
      const key = (row.name || '未填姓名').trim();
      (groupsMap[key] ||= []).push(row);
    }
    const groups = Object.entries(groupsMap).map(([name, records]) => ({ name, records }));
    return res.status(200).json({ ok: true, uid, groups });
  } catch (e) {
    console.error('[rx-list] error:', e);
    return res.status(500).json({ error: e.message || String(e) });
  }
}
