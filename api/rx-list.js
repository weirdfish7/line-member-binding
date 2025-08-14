// /api/rx-list.js
import { createClient } from '@supabase/supabase-js';

// 用 Service Role 只在後端取資料
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Vercel Node 18 內建 fetch，可直接用
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { id_token } = req.body || {};
    if (!id_token) return res.status(400).json({ error: 'id_token required' });

    // 1) 驗證 LIFF id_token → 拿 LINE userId (sub)
    const vr = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token,
        client_id: process.env.LINE_CHANNEL_ID // Messaging API channel 的 Channel ID
      })
    });
    const v = await vr.json();
    if (!vr.ok) return res.status(401).json({ error: 'invalid id_token', detail: v });
    const uid = v.sub;

    // 2) 只查屬於該 uid 的處方資料（只取你要的欄位）
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
    return res.status(500).json({ error: e.message || String(e) });
  }
}
