// /api/sync-richmenu.mjs
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const isJwt = s => /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s||'');

async function resolveUid({ id_token, access_token, clientId }) {
  // 先試 id_token（JWT）
  if (isJwt(id_token)) {
    try {
      const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method:'POST',
        headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ id_token, client_id: clientId })
      });
      const j = await r.json();
      if (r.ok) return j.sub; // 驗證成功 → 直接回 userId

      const msg = String(j.error_description || j.error || '').toLowerCase();
      // 若過期且手上有 access_token，就往下走用 access_token 取 userId
      if (!(msg.includes('expire') || msg.includes('expired')) || !access_token) {
        throw new Error(j.error_description || j.error || 'id_token verify failed');
      }
      // else: fall through to access_token path
    } catch (e) {
      if (!access_token) throw e; // 沒備援就丟出
      // 有 access_token → 繼續走下面路徑
    }
  }

  // 再試 access_token 路徑
  if (access_token) {
    const v = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(access_token)}`);
    const jv = await v.json();
    if (!v.ok) throw new Error(jv.error_description || jv.error || 'access_token verify failed');
    if (String(jv.client_id) !== String(clientId)) {
      throw new Error(`access_token audience mismatch: got ${jv.client_id}, expect ${clientId}`);
    }
    const pr = await fetch('https://api.line.me/v2/profile', {
      headers:{ Authorization:`Bearer ${access_token}` }
    });
    const jp = await pr.json();
    if (!pr.ok || !jp.userId) throw new Error(jp.message || 'profile fetch failed');
    return jp.userId;
  }

  throw new Error('no_valid_token');
}

async function link(uid){
  const r = await fetch(`https://api.line.me/v2/bot/user/${uid}/richmenu/${process.env.MEMBER_MENU_ID}`, {
    method:'POST',
    headers:{ Authorization:`Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`link_failed ${r.status} ${t}`);
  return { status:r.status, body:t };
}

async function unlink(uid){
  const r = await fetch(`https://api.line.me/v2/bot/user/${uid}/richmenu`, {
    method:'DELETE',
    headers:{ Authorization:`Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }
  });
  const t = await r.text();
  if (!r.ok && r.status !== 404) throw new Error(`unlink_failed ${r.status} ${t}`);
  return { status:r.status, body:t };
}

export default async function handler(req,res){
  const DEBUG = req.query.debug === '1' || req.headers['x-debug'] === '1';
  const dbg = {};
  try{
    if (req.method!=='POST') return res.status(405).json({ error:'Method not allowed' });

    // 1) 解析當前使用者
    const { id_token, access_token } = req.body || {};
    const uid = await resolveUid({ id_token, access_token, clientId: process.env.LINE_CHANNEL_ID });
    dbg.uid = uid;

    // 2) 取 DB 狀態
    const { data:user, error } = await sb.from('users')
      .select('uid, phone, is_bound')
      .eq('uid', uid)
      .maybeSingle();
    if (error) throw error;
    dbg.userRow = user || null;

    // 綁定條件：is_bound === true 或（有 uid 且 phone 非空白）
    const phoneOk = !!String(user?.phone ?? '').trim();
    const bound = (user?.is_bound === true) || (!!user?.uid && phoneOk);
    dbg.bound = bound; dbg.phoneOk = phoneOk;

    // 3) link / unlink
    let action, api;
    if (bound) { action = 'link'; api = await link(uid); }
    else       { action = 'unlink'; api = await unlink(uid); }

    return res.status(200).json({ ok:true, action, uid, debug: DEBUG ? { ...dbg, api } : undefined });
  }catch(e){
    return res.status(500).json({ error:e.message || String(e), debug: DEBUG ? dbg : undefined });
  }
}
