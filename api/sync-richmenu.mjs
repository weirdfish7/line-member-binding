// /api/sync-richmenu.mjs
import { createClient } from '@supabase/supabase-js';

// --- ENV & clients ----------------------------------------------------------
const SUPABASE_URL  = (process.env.SUPABASE_URL || '').trim();
const SRV_KEY       = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const LOGIN_CH_ID   = (process.env.LINE_CHANNEL_ID || '').trim();              // LINE Login 的 Channel ID（用來驗證 token audience）
const BOT_TOKEN     = (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();    // Messaging API 的 Channel access token
const MEMBER_MENUID = (process.env.MEMBER_MENU_ID || '').trim();               // 會員選單的 richMenuId

const sb = createClient(SUPABASE_URL, SRV_KEY);
const isJwt = s => /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s || '');
const isTrue = v => v === true || v === 'true' || v === 1 || v === '1';

// --- helpers ----------------------------------------------------------------
async function resolveUid({ id_token, access_token, clientId }) {
  // A) 先試 id_token（JWT）
  if (isJwt(id_token)) {
    try {
      const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token, client_id: clientId })
      });
      const j = await r.json();
      if (r.ok) return j.sub; // 直接得到 userId

      const msg = String(j.error_description || j.error || '').toLowerCase();
      const expired = msg.includes('expire');
      if (!expired || !access_token) {
        throw new Error(j.error_description || j.error || 'id_token verify failed');
      }
      // 過期且有 access_token → 繼續走 B
    } catch (e) {
      if (!access_token) throw e; // 沒備援就拋出
    }
  }

  // B) 再試 access_token（比較耐用）
  if (access_token) {
    const v = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(access_token)}`);
    const jv = await v.json();
    if (!v.ok) throw new Error(jv.error_description || jv.error || 'access_token verify failed');
    if (String(jv.client_id) !== String(clientId)) {
      throw new Error(`access_token audience mismatch: got ${jv.client_id}, expect ${clientId}`);
    }
    const pr = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    const jp = await pr.json();
    if (!pr.ok || !jp.userId) throw new Error(jp.message || 'profile fetch failed');
    return jp.userId;
  }

  throw new Error('no_valid_token');
}

async function link(uid) {
  const r = await fetch(`https://api.line.me/v2/bot/user/${uid}/richmenu/${MEMBER_MENUID}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${BOT_TOKEN}` }
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`link_failed ${r.status} ${t}`);
  return { status: r.status, body: t };
}

async function unlink(uid) {
  const r = await fetch(`https://api.line.me/v2/bot/user/${uid}/richmenu`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${BOT_TOKEN}` }
  });
  const t = await r.text();
  if (!r.ok && r.status !== 404) throw new Error(`unlink_failed ${r.status} ${t}`);
  return { status: r.status, body: t };
}

// --- handler ----------------------------------------------------------------
export default async function handler(req, res) {
  const DEBUG = req.query?.debug === '1' || req.headers['x-debug'] === '1';
  const dbg = {};

  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 基本 env 檢查
    if (!SUPABASE_URL || !SRV_KEY || !LOGIN_CH_ID || !BOT_TOKEN || !MEMBER_MENUID) {
      return res.status(500).json({
        error: 'Missing env',
        need: { SUPABASE_URL: !!SUPABASE_URL, SRV_KEY: !!SRV_KEY, LOGIN_CH_ID: !!LOGIN_CH_ID, BOT_TOKEN: !!BOT_TOKEN, MEMBER_MENUID: !!MEMBER_MENUID }
      });
    }

    // 1) 取 uid
    const { id_token, access_token } = req.body || {};
    const uid = await resolveUid({ id_token, access_token, clientId: LOGIN_CH_ID });
    dbg.uid = uid;

    // 2) 查 DB 狀態
    const { data: user, error } = await sb
      .from('users')
      .select('uid, phone, is_bound')
      .eq('uid', uid)
      .maybeSingle();
    if (error) throw error;
    dbg.userRow = user || null;

    const phoneOk = !!String(user?.phone ?? '').trim();
    const bound = isTrue(user?.is_bound) || (!!user?.uid && phoneOk);
    dbg.phoneOk = phoneOk;
    dbg.bound = bound;

    // 3) link / unlink
    let action, api;
    if (bound) { action = 'link'; api = await link(uid); }
    else       { action = 'unlink'; api = await unlink(uid); }

    return res.status(200).json({ ok: true, action, uid, debug: DEBUG ? { ...dbg, api } : undefined });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e), debug: DEBUG ? dbg : undefined });
  }
}
