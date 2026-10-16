/* Thin fetch wrapper. Always resolves with {ok, status, json}; a dead server is a normal result. */

async function request(method, path, body) {
  try {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json;
    try {
      json = await res.json();
    } catch {
      json = { error: `The server sent something that was not JSON (HTTP ${res.status}).`, rule: 'request:bad-response', guidance: 'Check the server log.' };
    }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return {
      ok: false,
      status: 0,
      json: {
        error: 'Could not reach the Falsify server.',
        rule: 'request:unreachable',
        guidance: 'Is `npm run web` still running? Start it again and reload.',
      },
    };
  }
}

export const get = (path) => request('GET', path);
export const post = (path, body) => request('POST', path, body);

export function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== null) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}
