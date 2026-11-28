/**
 * Minimal mock of the Meta WhatsApp Cloud API for local E2E testing.
 *   POST /v21.0/<phoneId>/messages
 *     - success (wamid returned) for normal recipients
 *     - error 131047 ("no open service window") for recipients ending in "47"
 *       -> exercises the app's opt-in-needed path
 * Every received payload is appended to /tmp/whatsapp_mock.log so tests can
 * assert on the exact document link + caption the app would send to Meta.
 */
import http from 'http';
import fs from 'node:fs';

const LOG = '/tmp/whatsapp_mock.log';
const STATE = '/tmp/wa_mock_state.json';

interface MockState { messaged: string[] }
function loadState(): MockState {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) as MockState; } catch { return { messaged: [] }; }
}
function saveState(s: MockState): void {
  fs.writeFileSync(STATE, JSON.stringify(s));
}
const last10 = (v: string) => v.replace(/\D/g, '').slice(-10);

const server = http.createServer((req, res) => {
  // Test helper: simulate the customer having sent a WhatsApp message to the
  // business number (opens the free 24h service window in Meta's model).
  if (req.method === 'POST' && req.url === '/inbound') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const { from } = JSON.parse(body) as { from: string };
        const st = loadState();
        const key = last10(from || '');
        if (key && !st.messaged.includes(key)) st.messaged.push(key);
        saveState(st);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, messaged: st.messaged }));
      } catch { res.writeHead(400).end(); }
    });
    return;
  }
  if (req.method === 'POST' && /^\/v21\.0\/[^/]+\/messages$/.test(req.url || '')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed: { to?: string; document?: { link?: string; filename?: string; caption?: string } } = {};
      try { parsed = JSON.parse(body); } catch { /* ignore */ }
      fs.appendFileSync(LOG, JSON.stringify(parsed) + '\n');
      const to = parsed.to || '';
      const st = loadState();
      // Rule: numbers ending in "47" have NO open service window until they
      // send an inbound message (recorded via /inbound). Everything else is
      // always deliverable.
      if (last10(to).endsWith('47') && !st.messaged.includes(last10(to))) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: 'Re-engagement message', type: 'OAuthException', code: 131047, error_data: { details: 'no open 24h service window' } },
        }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ wa_id: to }], messages: [{ id: `wamid.mock.${Date.now()}` }] }));
    });
    return;
  }
  res.writeHead(404).end();
});

server.listen(3220, () => console.log('whatsapp mock listening on :3220'));
