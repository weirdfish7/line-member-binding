// /api/sync-richmenu.mjs
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const isJwt = s => /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s||'');

async function resolveUid({ id_token, access_token, clientId }) {
  // 路線 A：id_token（JWT）
  if (isJwt(id_token)) {
    const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method:'POST',
      headers:{ 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token, client_id: clientId })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.error || 'id_token verify failed');
    return j.sub; // "U..." userId
  }
  // 路線 B：access_token
  if (access_token) {
    const v = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(access_token)}`);
    const j = await v.json();
    if (!v.ok) throw new Error(j.error_description || j.error || 'access_token verify failed');
    if (String(j.client_id) !== String(clientId)) {
      throw new Error(`access_token audience mismatch: got ${j.client_id}, expect ${clientId}`);
    }
    const pr = await fetch('https://api.line.me/v2/profile', { headers: { Authorization: `Bearer ${access_token}` } });
    const p = await pr.json();
    if (!pr.ok || !p.userId) throw new Error(p.message || 'profile fetch failed');
    return p.userId; // "U..." userId
  }
  throw new Error('no_valid_token');
}

async function link(uid){
  const r = await fetch(`https://api.line.me/v2/bot/user/${uid}/richmenu/${process.env.MEMBER_MENU_ID}`, {
    method:'POST',
    headers:{ Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
  });
  if (!r.ok) throw new Error(`link_failed ${r.status} ${await r.text()}`);
}

async function unlink(uid){
  const r = await fetch(`https://api.line.me/v2/bot/user/${uid}/richmenu`, {
    method:'DELETE',
    headers:{ Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
  });
  if (!r.ok && r.status !== 404) throw new Error(`unlink_failed ${r.status} ${await r.text()}`);
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!process.env.MEMBER_MENU_ID || !process.env.LINE_CHANNEL_ACCESS_TOKEN || !process.env.LINE_CHANNEL_ID) {
      return res.status(500).json({ error: 'Missing env: MEMBER_MENU_ID / LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_ID' });
    }

    // 1) 解析使用者 uid
    const { id_token, access_token } = req.body || {};
    const uid = await resolveUid({ id_token, access_token, clientId: process.env.LINE_CHANNEL_ID });

    // 2) 決定是否已綁定（你可以依自己規則調整）
    const { data: user, error } = await sb.from('users')
      .select('uid, phone, is_bound')
      .eq('uid', uid)
      .maybeSingle();
    if (error) throw error;

    const bound = !!(user?.uid && String(user?.phone || '').trim()); // or (user?.is_bound === true)

    // 3) link/unlink
    if (bound) {
      await link(uid);
      return res.status(200).json({ ok:true, action:'link', uid });
    } else {
      await unlink(uid);
      return res.status(200).json({ ok:true, action:'unlink', uid });
    }
  } catch (e) {
    console.error('[sync-richmenu]', e);
    return res.status(500).json({ error: e.message || String(e) });
  }
}
