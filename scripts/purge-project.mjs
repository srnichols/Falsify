// Purge ALL thoughts in the `falsify` project, looping until none remain.
// Used to clear duplicate/probe entries before a single clean re-seed.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const base = process.env.OPENBRAIN_REST_BASE ?? 'https://brain.planforge.software';
const key = process.env.OPENBRAIN_KEY ?? '';

const authedFetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('x-brain-key', key);
  return fetch(input, { ...init, headers });
};
const transport = new SSEClientTransport(new URL('/sse', base), {
  eventSourceInit: { fetch: authedFetch },
  requestInit: { headers: { 'x-brain-key': key } },
  fetch: authedFetch,
});
const client = new Client({ name: 'falsify-purge', version: '0.1.0' }, { capabilities: {} });

const unwrap = (res) => {
  const text = res?.content?.find((c) => c.type === 'text')?.text;
  try { return text ? JSON.parse(text) : res; } catch { return text; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTransient = (e) => /HTTP 429|HTTP 5\d\d|ECONNRESET|fetch failed|cloudflare|Too Many|error code: 1015/i.test(e?.message ?? String(e));

async function callRetry(name, args) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.callTool({ name, arguments: args });
    } catch (e) {
      if (attempt >= 6 || !isTransient(e)) throw e;
      const backoff = 1500 * 2 ** attempt;
      console.log(`[purge] ${name} transient fail; backoff ${backoff}ms`);
      await sleep(backoff);
    }
  }
}

await client.connect(transport);

let deleted = 0;
for (let round = 0; round < 50; round++) {
  const listed = unwrap(await callRetry('list_thoughts', { project: 'falsify', include_archived: true }));
  const items = Array.isArray(listed) ? listed : (listed?.results ?? listed?.thoughts ?? []);
  if (items.length === 0) { console.log('[purge] project empty.'); break; }
  console.log(`[purge] round ${round}: deleting ${items.length}…`);
  for (const t of items) {
    if (!t?.id) continue;
    await callRetry('delete_thought', { id: t.id });
    deleted++;
    await sleep(350); // stay under the edge rate limit
  }
}

const stats = unwrap(await callRetry('thought_stats', { project: 'falsify' }));
console.log(`[purge] total deleted: ${deleted}. remaining:`, stats?.total_thoughts ?? JSON.stringify(stats).slice(0, 120));
await client.close();
