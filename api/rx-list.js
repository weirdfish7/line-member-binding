// /api/rx-list.js
import { createClient } from '@supabase/supabase-js';

// 後端專用（Service Role）
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 檢查必要環境變數
    if (!process.env.LINE_CHANNEL_ID) {
      return res.status(500).json({ error: 'Missing LINE_CHANNEL_ID in env' });
    }

    const { id_token } = req.body || {};
    if (!id_token) return res.status(400).json({ error: 'id_token required' });

    // 先檢查 id_token 是否是 JWT 形狀
    const isJwt = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(id_token);
    if (!isJwt) {
      return res.status(401).json({
        error: 'invalid_id_token_format',
        hint: 'Expected a JWT like xxx.yyy.zzz from liff.getIDToken()'
      });
    }

    // 1) 驗證 LIFF id_token → 取得 LINE userId (sub)
    const vr = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token,
        client_id: process.env.LINE_CHANNEL_ID // 必須是 Messaging API Channel 的「Channel ID」（數字）
      })
    });
    const v = await vr.json();

    if (!vr.ok) {
      // 讓錯誤更可讀（你先前看到的那句通常會出現在 error_description）
      const msg = v.error_description || v.error || String(v);
      return res.status(401).json({
        error: 'verify_failed',
        detail: msg,
        hint: 'Check LINE_CHANNEL_ID matches the LIFF’s Messaging API channel, scopes include openid/profile, and LIFF allowed domain.'
      });
    }

    const uid = v.sub;

    // 2) 只查屬於該 uid 的處方資料
    const { data, error } = await sb
      .from('px_call_list')
      .select('name, rcp_date, pre_date, linkcan, linkno')
      .eq('uid', uid)
      .order('name', { ascending: true })
      .order('pre_date', { ascending: false })
      .order('rcp_date', { ascending: false });

    if (error) throw error;

    // 3) 依姓名分組
    const groupsMap = {};
    for (const row of (data || [])) {
      const key = (row.name || '未填姓名').trim();
      (groupsMap[key] ||= []).push(row);
    }
    const groups = Object.entries(groupsMap).map(([name, records]) => ({ name, records }));

    return res.status(200).json({ ok: true, uid, groups });
  } catch (e) {
    // 伺服器端記錄詳細錯誤以利除錯
    console.error('[rx-list] error:', e);
    return res.status(500).json({ error: e.message || String(e) });
  }
}
