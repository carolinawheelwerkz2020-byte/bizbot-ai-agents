/**
 * Smoke-test: each agent returns a non-empty reply from POST /api/chat.
 * Run with dev server: npm run dev (separate terminal), then: npx tsx scripts/verify-agents.ts
 * If the server enforces auth (no dev bypass: AUTH_DISABLED unset/false, or production without ALLOW_INSECURE_CLOUD_AUTH_BYPASS), set VERIFY_AGENTS_BEARER to a Firebase ID token.
 */
import { AGENTS } from '../src/services/gemini';

const BASE = process.env.VERIFY_AGENTS_URL ?? 'http://127.0.0.1:3000';

async function main() {
  const results: { id: string; ok: boolean; status: number; detail: string }[] = [];
  const bearer = process.env.VERIFY_AGENTS_BEARER?.trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
  for (const a of AGENTS) {
    const body = {
      message: 'Reply with exactly one word: OK',
      history: [],
      systemInstruction: a.systemInstruction,
      model: 'gemini-2.5-flash',
    };
    const r = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const status = r.status;
    let detail = '';
    if (r.ok) {
      const j = (await r.json()) as { text?: string };
      const ok = Boolean(j.text?.trim());
      detail = ok ? `textLen=${j.text!.length}` : 'empty text';
      results.push({ id: a.id, ok, status, detail });
    } else {
      try {
        const j = (await r.json()) as { error?: string; details?: string };
        detail = [j.error, j.details].filter(Boolean).join(' — ') || await r.text();
      } catch {
        detail = await r.text();
      }
      results.push({ id: a.id, ok: false, status, detail });
    }
  }

  const failed = results.filter((x) => !x.ok);
  console.log(JSON.stringify({ base: BASE, total: results.length, passed: results.length - failed.length, failed: failed.length }, null, 2));
  for (const row of results) {
    console.log(`${row.ok ? 'OK' : 'FAIL'}\t${row.id}\t${row.status}\t${row.detail}`);
  }
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
