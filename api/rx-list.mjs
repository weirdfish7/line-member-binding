// /api/rx-list.mjs
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const isJwt = s => /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s || '');
const mask = s => (typeof s === 'string' ? `${s.slice(0,8)}…(${s.length})` : null);

export default async function handler(req, res) {
  const DEBUG = req.headers['x-debug'] === '1' || req.query?.debug === '1';
  const dbg = {};

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const clientId = process.env.LINE_CHANNEL_ID;
    dbg.clientId = clientId ?? null;
    dbg.clientIdIsNumeric = /^\d{6,}$/.test(String(clientId || ''));
    if (!dbg.clientIdIsNumeric) {
      return res.status(500).json({
        error: 'LINE_CHANNEL_ID_invalid',
        detail: 'Must be the numeric Channel ID of the LIFF’s channel.',
        debug: DEBUG ? dbg : undefined
      });
    }

    const { id_token, access_token } = req.body || {};
    dbg.idTokenLooksJWT = isJwt(id_token);
    dbg.hasAccessToken = !!access_token;

    let uid = null;
    let pathUsed = null;

    // 路線 A：id_token
    if (isJwt(id_token)) {
      pathUsed = 'id_token';
      const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token, client_id: clientId })
      });
      const j = await r.json().catch(() => ({}));
      dbg.idTokenVerifyStatus = r.status;
      dbg.idTokenVerifyResp = DEBUG ? j : undefined;
      if (!r.ok) throw new Error(j.error_description || j.error || 'id_token verify failed');
      uid = j.sub;
    }

    // 路線 B：access_token
    if (!uid && access_token) {
      pathUsed = 'access_token';
      const r1 = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(access_token)}`);
      const j1 = await r1.json().catch(() => ({}));
      dbg.accVerifyStatus = r1.status;
      dbg.accVerifyResp = DEBUG ? j1 : undefined;
      if (!r1.ok) throw new Error(j1.error_description || j1.error || 'access_token verify failed');
      if (String(j1.client_id) !== String(clientId)) {
        throw new Error(`access_token audience mismatch: got ${j1.client_id}, expect ${clientId}`);
      }
      const r2 = await fetch('https://api.line.me/v2/profile', {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      const j2 = await r2.json().catch(() => ({}));
      dbg.profileStatus = r2.status;
      dbg.profileResp = DEBUG ? j2 : undefined;
      if (!r2.ok || !j2.userId) throw new Error(j2.message || 'profile fetch failed');
      uid = j2.userId;
    }

    if (!uid) {
      return res.status(401).json({
        error: 'no_valid_token',
        detail: 'Neither id_token nor access_token could be verified.',
        debug: DEBUG ? { ...dbg, idTokenMasked: mask(id_token), accessTokenMasked: mask(access_token) } : undefined
      });
    }

    // 查詢
    const { data, error } = await sb
      .from('px_call_list')
      .select('name, rcp_date, pre_date, linkcan, linkno')
      .eq('uid', uid)
      .order('name', { ascending: true })
      .order('pre_date', { ascending: false })
      .order('rcp_date', { ascending: false });

    if (error) throw error;

    const map = {};
    for (const row of (data || [])) (map[(row.name || '未填姓名').trim()] ||= []).push(row);
    const groups = Object.entries(map).map(([name, records]) => ({ name, records }));

    return res.status(200).json({
      ok: true,
      uid,
      pathUsed,
      groups,
      debug: DEBUG ? { ...dbg, idTokenMasked: mask(id_token), accessTokenMasked: mask(access_token) } : undefined
    });
  } catch (e) {
    console.error('[rx-list] fatal:', e);
    // 確保即使錯誤也回 JSON，避免前端再看到 “not valid JSON”
    return res.status(500).json({ error: e.message || String(e), debug: DEBUG ? dbg : undefined });
  }
}
