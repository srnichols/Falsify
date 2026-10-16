/*
 * Regenerates the screenshots in docs/images/ from a throwaway server.
 *
 * It starts the web UI on its own port with FALSIFY_DATA_DIR pointing at a temp folder, so your
 * real sessions, notebook and outcomes are never read or written. It then runs a small demo
 * inquiry through the HTTP API and photographs each screen.
 *
 * Needs a built project (`npm run build`), network access (one Crossref DOI check) and a
 * Chromium-based browser (Edge or Chrome) plus playwright-core:
 *
 *   npm install --no-save playwright-core
 *   npm run docs:screenshots
 *
 * The demo uses only numbers reported in the cited papers; nothing here is invented.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'docs', 'images');
const port = 4399;
const base = `http://127.0.0.1:${port}`;

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('playwright-core is not installed. Run: npm install --no-save playwright-core');
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), 'falsify-shots-'));
const server = spawn(process.execPath, [join(root, 'dist', 'src', 'web', 'server.js')], {
  env: { ...process.env, FALSIFY_DATA_DIR: dataDir, FALSIFY_WEB_PORT: String(port) },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('The demo server did not start. Did you run npm run build?');
}

async function api(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error ?? res.status} ${json.guidance ?? ''}`);
  return json;
}

const OSC_DOI = '10.1126/science.aac4716';

async function seed() {
  const q = 'Do most published psychology findings replicate when tested again?';
  const a = await api('/api/intake', { question: q });
  await api('/api/hypothesize', {
    sessionId: a.sessionId,
    statement: 'Fewer than half of a representative sample of published psychology effects reach statistical significance when independently replicated.',
    predicts: 'In a pre-registered replication of a sample of published studies, under 50 percent of the replications are statistically significant.',
    falsificationConditions: [
      { description: 'A pre-registered replication of a representative sample of the same studies finds more than 50 percent statistically significant at alpha 0.05.' },
      { description: 'The replications turn out to be less powered than the originals, so the low rate reflects power, not the effects.' },
    ],
    claimType: 'probabilistic',
  });
  await api('/api/experiment', { sessionId: a.sessionId, couldFail: true, decisiveEvidence: ['A large pre-registered replication of a sample of published psychology studies'] });
  await api('/api/verify-source', { sessionId: a.sessionId, doi: OSC_DOI, observation: 'replications of published psychology studies were significant in a minority of cases' });
  await api('/api/analyze', {
    sessionId: a.sessionId,
    verdict: 'yes',
    evidence: [{
      observation: 'Of 100 replications of published psychology studies, 36 were statistically significant, against 97 of the 100 original studies',
      kind: 'statistical',
      source: 'Open Science Collaboration, Science 2015, Estimating the reproducibility of psychological science',
      doi: OSC_DOI,
      sampleSize: 100,
    }],
    evidenceSearch: {
      description: 'Searched Crossref and Google Scholar for large-scale psychology replication projects (Many Labs, Reproducibility Project) in 2024',
      contraryFound: 1,
      contraryNote: 'Many Labs 1 replicated 10 of 13 classic effects, so the rate depends on which effects are chosen and how replication is defined. The claim is about a representative sample, not every effect.',
    },
  });
  await api('/api/review', {
    sessionId: a.sessionId,
    q1Methods: 'Read the protocol: replications were pre-registered and original authors were consulted on materials.',
    q2Hypothesis: 'The hypothesis was specific and could have failed; it is limited to a sample of published effects.',
    q3Theory: 'The theory that published effects are broadly reliable is weakened, not refuted: replication rate varies by subfield and by the definition used.',
    outcome: 'confirm',
    acceptTentative: true,
  });

  // A second, unfinished inquiry so the dashboard shows work in progress.
  const b = await api('/api/intake', { question: 'Does a 200 mg caffeine dose shorten simple reaction time in healthy adults?' });
  await api('/api/hypothesize', {
    sessionId: b.sessionId,
    statement: 'A 200 mg oral caffeine dose shortens simple reaction time in healthy adults compared with placebo.',
    predicts: 'Mean simple reaction time is lower after caffeine than after placebo in a blinded crossover trial.',
    falsificationConditions: [{ description: 'No reduction in mean reaction time versus placebo in a blinded randomized trial.' }],
  });
  return { done: a.sessionId, open: b.sessionId };
}

const browserOpts = [{ channel: 'msedge' }, { channel: 'chrome' }];
async function launch() {
  for (const opts of browserOpts) {
    try {
      return await chromium.launch(opts);
    } catch {
      /* try the next browser */
    }
  }
  throw new Error('No Edge or Chrome found. Install one, or edit browserOpts in this script.');
}

try {
  await waitForServer();
  mkdirSync(outDir, { recursive: true });
  const ids = await seed();
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  const shot = async (name, fullPage = false) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(outDir, `${name}.png`), fullPage });
    console.log('wrote', `docs/images/${name}.png`);
  };

  await page.goto(`${base}/#/dashboard`);
  await page.waitForSelector('.stat');
  await shot('dashboard');

  await page.goto(`${base}/#/sessions/${ids.done}`);
  await page.waitForSelector('section[aria-label="Session detail"] h2');
  await shot('sessions');

  await page.goto(`${base}/#/sessions`);
  await page.waitForSelector('tr.clickable');
  await page.locator('tr.clickable', { hasText: 'caffeine' }).first().click();
  await page.getByRole('button', { name: 'Open in Inquiry' }).click();
  await page.waitForSelector('.stepper');
  await shot('inquiry');

  await page.goto(`${base}/#/knowledge`);
  await page.waitForSelector('button.item');
  await page.locator('button.chip', { hasText: /^contested/ }).click();
  await page.waitForTimeout(500);
  await page.locator('button.item', { hasText: 'functional information in DNA' }).first().click();
  await shot('knowledge');

  await page.goto(`${base}/#/tools`);
  await page.waitForSelector('textarea');
  await page.locator('textarea').first().fill('Does evolution create new genetic information?');
  await page.getByRole('button', { name: 'Run' }).first().click();
  await page.waitForSelector('text=related entr');
  await shot('tools');

  await browser.close();
} finally {
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
