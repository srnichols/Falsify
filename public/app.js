/* Entry point: a small hash router. Each route mounts one view into #view. */

import { mount, h } from './js/dom.js';
import { callout } from './js/render.js';
import { mountDashboard } from './js/views/dashboard.js';
import { mountInquiry } from './js/views/inquiry.js';
import { mountSessions } from './js/views/sessions.js';
import { mountKnowledge } from './js/views/knowledge.js';
import { mountTools } from './js/views/tools.js';
import { mountOutcomes } from './js/views/outcomes.js';
import { mountNotebook } from './js/views/notebook.js';

const ROUTES = {
  dashboard: { title: 'Dashboard', mount: mountDashboard },
  inquiry: { title: 'Inquiry', mount: mountInquiry },
  sessions: { title: 'Sessions', mount: (root, arg) => mountSessions(root, arg) },
  knowledge: { title: 'Knowledge', mount: mountKnowledge },
  tools: { title: 'Tools', mount: mountTools },
  outcomes: { title: 'Outcomes', mount: mountOutcomes },
  notebook: { title: 'Notebook', mount: mountNotebook },
};
const DEFAULT_ROUTE = 'dashboard';

function parseHash() {
  const [name, ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name in ROUTES ? name : DEFAULT_ROUTE, arg: rest.join('/') || undefined };
}

let navigation = 0;

async function render() {
  const { name, arg } = parseHash();
  const route = ROUTES[name];
  const mine = ++navigation;
  for (const link of document.querySelectorAll('.nav a')) {
    if (link.dataset.route === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${route.title} · Falsify`;
  const view = document.getElementById('view');
  try {
    await route.mount(view, arg);
  } catch (err) {
    if (mine !== navigation) return;
    mount(view, h('h1', null, route.title), callout('bad', 'This screen failed to load', err instanceof Error ? err.message : String(err)));
  }
  if (mine !== navigation) return;
  const heading = view.querySelector('h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
if (!location.hash) location.hash = `#/${DEFAULT_ROUTE}`;
else render();
