// /api/sync-richmenu.mjs
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const isJwt = s => /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(s||'');

async function resolveUid({ id_token, access_token, clientId }) {
  if (isJwt(id_token)) {
    const r = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({ id_token, client_id: clientId })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.error || 'id_token verify failed');
    return j.sub;
  }
  if (access_token) {
    const v = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(access_token)}`);
    const jv = await v.json();
    if (!v.ok) throw new Error(jv.error_description || jv.error || 'access_token verify failed');
    if (String(jv.client_id) !== String(process.env.LINE_CHANNEL_ID)) {
      throw new Error(`access_token audience mismatch: got ${jv.client_id}, expect ${process.env.LINE_CHANNEL_ID}`);
    }
    const pr = await fetch('https://api.line.me/v2/profile', { headers:{ Authorization:`Bearer ${access_token}` } });
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
