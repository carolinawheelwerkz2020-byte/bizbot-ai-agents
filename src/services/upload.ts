import { authHeaderObject } from '../lib/authHeaders';

/** Multipart upload to server → Google Gemini File API (large images/videos). */
export async function uploadFileToGeminiViaServer(file: File): Promise<{
  uri: string;
  mimeType: string;
  resourceName: string;
  displayName?: string;
}> {
  const form = new FormData();
  form.append('file', file);
  const authHeaders = await authHeaderObject();
  const res = await fetch('/api/upload', { method: 'POST', headers: authHeaders, body: form });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const err = (await res.json()) as { error?: string; details?: string };
      msg = err.error || err.details || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}
