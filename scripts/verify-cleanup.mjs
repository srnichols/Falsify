// Verify the seed, then delete the temporary `falsify-probe` test entries.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const base = process.env.OPENBRAIN_REST_BASE ?? 'https://brain.planforge.software';
const key = process.env.OPENBRAIN_KEY ?? '';
const DELETE = process.argv.includes('--delete');

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
const client = new Client({ name: 'falsify-verify', version: '0.1.0' }, { capabilities: {} });

const unwrap = (res) => {
  const text = res?.content?.find((c) => c.type === 'text')?.text;
  try { return text ? JSON.parse(text) : res; } catch { return text; }
};

await client.connect(transport);

const stats = unwrap(await client.callTool({ name: 'thought_stats', arguments: { project: 'falsify' } }));
console.log('[verify] project falsify stats:', JSON.stringify(stats).slice(0, 300));

const listed = unwrap(await client.callTool({ name: 'list_thoughts', arguments: { project: 'falsify' } }));
const items = Array.isArray(listed) ? listed : (listed?.results ?? listed?.thoughts ?? []);
console.log('[verify] listed count:', items.length);

const probes = items.filter((t) => {
  const src = t?.metadata?.source ?? t?.source;
  const content = t?.content ?? '';
  return src === 'falsify-probe' || /Falsify MCP probe/.test(content);
});
console.log(`[verify] probe entries found: ${probes.length}`);
for (const p of probes) console.log('   -', p.id, '|', (p.content ?? '').slice(0, 50).replace(/\n/g, ' '));

if (DELETE) {
  for (const p of probes) {
    await client.callTool({ name: 'delete_thought', arguments: { id: p.id } });
    console.log('[verify] deleted', p.id);
  }
  console.log('[verify] cleanup done.');
} else {
  console.log('[verify] dry run — re-run with --delete to remove the probe entries.');
}

await client.close();
