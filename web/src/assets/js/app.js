import { api, setToken, clearToken } from './api.js';
import { COUNTRY_CODES } from './country-codes.js';
import { closeMobileSidebar } from './sidebar.js';
import logoUrl from './logo.js';
import { mapClientCsv, SAMPLE_CLIENT_CSV } from './csv.js';

const STAGES = [
  'New',
  'Qualifying',
  'Designing',
  'Quoted',
  'Option held',
  'Deposit due',
  'Confirmed',
  'Balance due',
  'Travelling',
  'Completed',
  'Lost'
];
const LIVE_STAGES = STAGES.filter((stage) => stage !== 'Completed' && stage !== 'Lost');
const PARTY_TYPES = ['solo', 'couple', 'family', 'friends', 'group'];
const CHANNELS = ['email', 'phone', 'web', 'WhatsApp', 'other'];
const LODGE_BANDS = ['bush camp', 'mid', 'luxury', 'mix'];
const WORK_LABELS = ['Sales', 'Reservations', 'Operations', 'Guide'];
const ACTIVITY_TYPES = ['call', 'WhatsApp', 'email', 'note', 'follow-up'];
const USERNAME_KEY = 'lamai.username';
const SEEN_KEY = 'lamai.notifSeen';

const state = {
  bootstrap: null,
  session: null,
  signInPassword: '',
  notices: null,
  csvRows: []
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value) {
  if (!value) return '—';
  return String(value).slice(0, 10);
}

function initials(name) {
  return String(name || 'L')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('') || 'L';
}

function isAdmin() {
  return state.session && state.session.role === 'Super Admin';
}

function showAlert(message, type) {
  const host = document.getElementById('page-alert');
  if (!host) return;
  host.innerHTML = message
    ? `<div class="alert alert-${type || 'danger'} page-alert">${escapeHtml(message)}</div>`
    : '';
}

function notify(message, type) {
  showAlert(message, type);
  const host = document.getElementById('toast-host');
  if (!host || !message) return;
  host.innerHTML = `<div class="alert alert-${type || 'danger'} shadow-sm mb-0">${escapeHtml(message)}</div>`;
  window.setTimeout(() => {
    if (host) host.innerHTML = '';
  }, 4000);
}

async function copyText(value) {
  const text = String(value || '');
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (copyError) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }
}

function confirmTypedDelete(message, expected) {
  const typed = window.prompt(message);
  if (typed == null) return null;
  return String(typed).trim().toLowerCase() === String(expected).trim().toLowerCase();
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>${escapeHtml(label || 'Working…')}`;
    return;
  }
  button.disabled = false;
  if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
}

function showPageLoading() {
  const page = document.getElementById('page');
  if (page) {
    page.innerHTML = '<div class="text-secondary py-5 d-flex align-items-center gap-2"><span class="spinner-border spinner-border-sm" role="status"></span> Loading…</div>';
  }
}

function bindCopyButtons(root) {
  (root || document).querySelectorAll('.copy-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const value = button.getAttribute('data-copy') || '';
      const ok = await copyText(value);
      notify(ok ? 'Copied.' : 'Could not copy. Select the text and copy it.', ok ? 'success' : 'warning');
    });
  });
}

function bindPasswordToggles(root) {
  (root || document).querySelectorAll('.password-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.parentElement.querySelector('input');
      const icon = button.querySelector('i');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      if (icon) icon.className = show ? 'ti ti-eye-off' : 'ti ti-eye';
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });
}

function passwordField(name, options) {
  const opts = options || {};
  const extra = [
    opts.required ? 'required' : '',
    opts.minlength ? `minlength="${opts.minlength}"` : '',
    opts.autocomplete ? `autocomplete="${escapeHtml(opts.autocomplete)}"` : '',
    opts.readonly ? 'readonly' : '',
    opts.autofocus ? 'autofocus' : ''
  ].filter(Boolean).join(' ');
  return `
    <div class="${opts.className || 'mb-3'}">
      <label class="form-label">${escapeHtml(opts.label || 'Password')}</label>
      <div class="input-group password-field">
        <input class="form-control" type="password" name="${escapeHtml(name)}" value="${escapeHtml(opts.value || '')}" ${extra}>
        <button class="btn btn-outline-secondary password-toggle" type="button" aria-label="Show password"><i class="ti ti-eye"></i></button>
      </div>
      ${opts.hint ? `<div class="form-text">${escapeHtml(opts.hint)}</div>` : ''}
    </div>`;
}

function credentialsBox(username, password) {
  return `<div class="alert alert-success mt-3">
    <p class="mb-2 fw-medium">Give this to the staff member. They must change the password at first sign-in.</p>
    <div class="input-group mb-2">
      <span class="input-group-text">Username</span>
      <input class="form-control" readonly value="${escapeHtml(username)}">
      <button class="btn btn-outline-secondary copy-btn" type="button" data-copy="${escapeHtml(username)}">Copy</button>
    </div>
    <div class="input-group">
      <span class="input-group-text">Password</span>
      <input class="form-control" type="password" readonly value="${escapeHtml(password)}">
      <button class="btn btn-outline-secondary password-toggle" type="button" aria-label="Show password"><i class="ti ti-eye"></i></button>
      <button class="btn btn-outline-secondary copy-btn" type="button" data-copy="${escapeHtml(password)}">Copy</button>
    </div>
  </div>`;
}

function focusFirstField(root) {
  const node = (root || document).querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
  if (node) node.focus();
}

function emptyState(title, body, href, action) {
  return `<div class="text-center py-4">
    <p class="fw-medium mb-1">${escapeHtml(title)}</p>
    <p class="text-secondary small mb-3">${escapeHtml(body)}</p>
    ${href ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(href)}">${escapeHtml(action)}</a>` : ''}
  </div>`;
}

function optionList(items, selected, labelFn) {
  return items
    .map((item) => {
      const value = typeof item === 'string' ? item : item.value;
      const label = labelFn ? labelFn(item) : (item.label || value);
      const isSelected = String(selected || '') === String(value);
      return `<option value="${escapeHtml(value)}"${isSelected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function staffOptions(selected) {
  const staff = (state.bootstrap && state.bootstrap.staff) || [];
  return `<option value="">Unassigned</option>` + optionList(
    staff.map((person) => ({ value: person.userId, label: person.displayName })),
    selected
  );
}

function destinationOptions(selected) {
  const selectedValues = Array.isArray(selected) ? selected : [];
  const items = ((state.bootstrap && state.bootstrap.references && state.bootstrap.references.destinations) || [])
    .filter((item) => item.isActive !== false);
  return items
    .map((item) => {
      const checked = selectedValues.indexOf(item.label) !== -1 ? ' checked' : '';
      return `<label class="dest-pill"><input type="checkbox" name="destinations" value="${escapeHtml(item.label)}"${checked}><span>${escapeHtml(item.label)}</span></label>`;
    })
    .join('');
}

function styleOptions(selected) {
  const items = ((state.bootstrap && state.bootstrap.references && state.bootstrap.references.styles) || [])
    .filter((item) => item.isActive !== false)
    .map((item) => item.label);
  const fallback = ['family', 'honeymoon', 'photography', 'walking', 'cultural/Hadza', 'luxury', 'mixed'];
  return optionList(items.length ? items : fallback, selected);
}

function countryCodeOptions(selected) {
  const value = selected || '255';
  return COUNTRY_CODES.map((country) => {
    const isSelected = country.dial === value || country.iso === value;
    return `<option value="${escapeHtml(country.dial)}"${isSelected ? ' selected' : ''}>${escapeHtml(country.iso)} +${escapeHtml(country.dial)} ${escapeHtml(country.name)}</option>`;
  }).join('');
}

function phoneField(prefix, record) {
  const country = (record && (record.phoneCountry || record.phoneDial)) || '255';
  const number = (record && record.phoneNumber) || '';
  return `
    <div class="row g-2 phone-split">
      <div class="col-md-5">
        <label class="form-label">Country code</label>
        <select class="form-select" name="${prefix}phoneCountry">${countryCodeOptions(country)}</select>
      </div>
      <div class="col-md-7">
        <label class="form-label">Phone / WhatsApp</label>
        <input class="form-control" name="${prefix}phoneNumber" value="${escapeHtml(number)}" inputmode="tel" placeholder="768506258">
      </div>
    </div>`;
}

function parseHash() {
  const raw = (window.location.hash || '#/today').replace(/^#/, '');
  const parts = raw.split('/').filter(Boolean);
  return {
    path: '/' + parts.join('/'),
    parts: parts
  };
}

function go(hash) {
  const next = hash.indexOf('#') === 0 ? hash : '#' + hash;
  if (window.location.hash === next) {
    route();
    return;
  }
  window.location.hash = next;
}

function bindHashLinks() {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (!href || href === '#') return;
    event.preventDefault();
    go(href);
  });
}

async function playSplash() {
  document.querySelectorAll('img[data-lamai-logo]').forEach((img) => {
    img.src = logoUrl;
  });
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.setAttribute('href', logoUrl);
  const splash = document.getElementById('splash');
  if (!splash) return;
  if (window.sessionStorage.getItem('lamaiSplashSeen') === '1') {
    splash.classList.add('is-hidden');
    splash.hidden = true;
    return;
  }
  splash.hidden = false;
  splash.classList.remove('is-hidden', 'is-done');
  await new Promise((resolve) => window.setTimeout(resolve, 400));
  splash.classList.add('is-done');
  await new Promise((resolve) => window.setTimeout(resolve, 180));
  splash.classList.add('is-hidden');
  splash.hidden = true;
  window.sessionStorage.setItem('lamaiSplashSeen', '1');
}

function setChrome(visible) {
  document.body.classList.toggle('is-auth', !visible);
  const authRoot = document.getElementById('auth-root');
  if (visible && authRoot) authRoot.innerHTML = '';
  ['topbar', 'sidebar', 'content'].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.classList.toggle('d-none', !visible);
  });
  document.querySelectorAll('.admin-only').forEach((node) => {
    node.classList.toggle('d-none', !isAdmin());
  });
  if (state.session) {
    const initialsEl = document.getElementById('user-initials');
    const nameEl = document.getElementById('user-name');
    const metaEl = document.getElementById('user-meta');
    if (initialsEl) initialsEl.textContent = initials(state.session.displayName);
    if (nameEl) nameEl.textContent = state.session.displayName || state.session.username;
    if (metaEl) metaEl.textContent = [state.session.role, state.session.workLabel].filter(Boolean).join(' · ');
  }
  const due = state.bootstrap && state.bootstrap.dueCount ? Number(state.bootstrap.dueCount) : 0;
  if (visible && state.session) {
    refreshNotifications();
  } else {
    const badge = document.getElementById('due-badge');
    if (badge) {
      badge.textContent = String(due);
      badge.classList.toggle('d-none', due < 1);
    }
  }
  closeMobileSidebar();
}

function markNav(path) {
  const rules = [
    ['#/today', path === '/today'],
    ['#/pipeline', path === '/pipeline'],
    ['#/enquiries', path.indexOf('/enquiries') === 0],
    ['#/clients', path.indexOf('/clients') === 0],
    ['#/work', path === '/work'],
    ['#/payments', path === '/payments'],
    ['#/reports', path === '/reports'],
    ['#/settings', path === '/settings']
  ];
  document.querySelectorAll('.sidebar .nav-link').forEach((link) => {
    const href = link.getAttribute('href') || '';
    const match = rules.find((rule) => rule[0] === href);
    link.classList.toggle('active', !!(match && match[1]));
  });
  closeMobileSidebar();
}

function authCard(title, body) {
  return `
    <div class="auth-shell">
      <div class="card" style="max-width:420px;width:100%;">
        <div class="card-body p-5">
          <div class="text-center mb-4">
            <span class="logo-plate d-inline-flex"><img data-lamai-logo src="${escapeHtml(logoUrl)}" alt=""></span>
            <h1 class="h5 mt-3 mb-1">${escapeHtml(title)}</h1>
            <p class="text-secondary small mb-0">Lamai Africa Safaris</p>
          </div>
          ${body}
        </div>
      </div>
    </div>`;
}

function renderSetup() {
  document.getElementById('auth-root').innerHTML = authCard('Create Super Admin', `
    <form id="setup-form">
      <div class="mb-3">
        <label class="form-label">Your name</label>
        <input class="form-control" name="displayName" required>
      </div>
      <div class="mb-3">
        <label class="form-label">Username</label>
        <input class="form-control" name="username" required autocomplete="username">
      </div>
      ${passwordField('password', { label: 'Password', required: true, minlength: 8, autocomplete: 'new-password', hint: 'At least 8 characters.', className: 'mb-4' })}
      <button class="btn btn-primary w-100" type="submit">Create workspace</button>
    </form>`);
  bindPasswordToggles(document.getElementById('setup-form'));
  focusFirstField(document.getElementById('setup-form'));
  document.getElementById('setup-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]');
    const form = new FormData(event.target);
    setBusy(button, true, 'Creating workspace…');
    try {
      const data = await api('setupSuperAdmin', {
        displayName: form.get('displayName'),
        username: form.get('username'),
        password: form.get('password')
      });
      setToken(data.token);
      state.session = data.session;
      await refreshBootstrap();
      notify('Workspace ready.', 'success');
      go('#/today');
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
}

function renderSignIn() {
  const remembered = window.localStorage.getItem(USERNAME_KEY) || '';
  document.getElementById('auth-root').innerHTML = authCard('Sign in', `
    <form id="signin-form">
      <div class="mb-3">
        <label class="form-label">Username</label>
        <input class="form-control" name="username" required autocomplete="username" autofocus value="${escapeHtml(remembered)}">
      </div>
      ${passwordField('password', { label: 'Password', required: true, autocomplete: 'current-password', className: 'mb-4' })}
      <button class="btn btn-primary w-100" type="submit">Sign in</button>
    </form>`);
  bindPasswordToggles(document.getElementById('signin-form'));
  document.getElementById('signin-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]');
    const form = new FormData(event.target);
    const username = String(form.get('username') || '');
    const password = String(form.get('password') || '');
    setBusy(button, true, 'Signing in…');
    try {
      const data = await api('login', { username: username, password: password });
      setToken(data.token);
      state.session = data.session;
      window.localStorage.setItem(USERNAME_KEY, username);
      if (data.session && data.session.mustChangePassword) state.signInPassword = password;
      await refreshBootstrap();
      notify('Signed in.', 'success');
      go(data.session.mustChangePassword ? '#/change-password' : '#/today');
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
}

function renderChangePassword() {
  const insideApp = !!state.session && !state.session.mustChangePassword;
  const current = !insideApp && state.signInPassword ? state.signInPassword : '';
  const html = `
    <form id="password-form">
      ${passwordField('currentPassword', { label: 'Current password', required: true, autocomplete: 'current-password', value: current })}
      ${passwordField('newPassword', { label: 'New password', required: true, minlength: 8, autocomplete: 'new-password', hint: 'At least 8 characters.' })}
      ${passwordField('confirmPassword', { label: 'Confirm new password', required: true, minlength: 8, autocomplete: 'new-password', className: 'mb-4' })}
      <p id="password-mismatch" class="text-danger small d-none">New passwords do not match.</p>
      <button class="btn btn-primary w-100" type="submit">Update password</button>
    </form>`;
  if (insideApp) {
    document.getElementById('page').innerHTML = `<div class="row"><div class="col-lg-6"><div class="card"><div class="card-body p-4"><h1 class="h5 mb-4">Change password</h1>${html}</div></div></div></div>`;
  } else {
    document.getElementById('auth-root').innerHTML = authCard('Change password', html);
  }
  const form = document.getElementById('password-form');
  bindPasswordToggles(form);
  focusFirstField(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]');
    const data = new FormData(event.target);
    const mismatch = document.getElementById('password-mismatch');
    if (String(data.get('newPassword')) !== String(data.get('confirmPassword'))) {
      if (mismatch) mismatch.classList.remove('d-none');
      return;
    }
    if (mismatch) mismatch.classList.add('d-none');
    setBusy(button, true, 'Updating…');
    try {
      const result = await api('changePassword', {
        currentPassword: data.get('currentPassword'),
        newPassword: data.get('newPassword')
      });
      if (result && result.token) setToken(result.token);
      state.session = result.session || state.session;
      if (state.session) state.session.mustChangePassword = false;
      state.signInPassword = '';
      await refreshBootstrap();
      notify('Password updated.', 'success');
      go('#/today');
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
}

function statCard(icon, label, value, tone) {
  return `
    <div class="col-lg-3 col-12">
      <div class="card p-4 bg-${tone} bg-opacity-10 border border-${tone} border-opacity-25">
        <div class="d-flex gap-3">
          <div class="icon-shape icon-md bg-${tone} text-white"><i class="ti ${icon} fs-4"></i></div>
          <div>
            <h2 class="mb-3 fs-6">${escapeHtml(label)}</h2>
            <h3 class="fw-bold mb-0">${escapeHtml(value)}</h3>
          </div>
        </div>
      </div>
    </div>`;
}

function enquiryRow(item) {
  return `<tr data-href="#/enquiries/${escapeHtml(item.enquiryId)}">
    <td>${escapeHtml(item.clientName || item.enquiryId)}</td>
    <td><span class="badge text-bg-light stage-chip">${escapeHtml(item.stage)}</span></td>
    <td>${escapeHtml(item.ownerName || 'Unassigned')}</td>
    <td>${escapeHtml(formatDate(item.startDate))}</td>
    <td>${escapeHtml(formatDate(item.nextFollowUpAt))}</td>
  </tr>`;
}

async function renderToday() {
  const data = await api('getDashboardData');
  document.getElementById('page').innerHTML = `
    <div class="mb-6">
      <h1 class="fs-3 mb-1">Today</h1>
      <p class="text-secondary">Live files, follow-ups, and money still outstanding.</p>
    </div>
    <div class="row g-3 mb-4">
      ${statCard('ti-files', 'Live files', data.liveCount || 0, 'primary')}
      ${statCard('ti-calendar-due', 'Due today', (data.dueToday || []).length, 'warning')}
      ${statCard('ti-alert-circle', 'Overdue', (data.overdue || []).length, 'danger')}
      ${statCard('ti-cash', 'Payments due', (data.paymentsDue || []).length, 'success')}
    </div>
    <div class="row g-3">
      <div class="col-lg-6">
        <div class="card"><div class="card-body">
          <div class="d-flex justify-content-between mb-3"><h2 class="h6 mb-0">Follow-ups due today</h2><a href="#/work">Open work</a></div>
          ${listOrEmpty(data.dueToday, (item) => `<div class="border-bottom py-2"><a href="#/enquiries/${escapeHtml(item.enquiryId)}">${escapeHtml(item.clientName || item.summary)}</a><div class="small text-secondary">${escapeHtml(item.summary || item.nextAction || '')}</div></div>`) || ''}
        </div></div>
      </div>
      <div class="col-lg-6">
        <div class="card"><div class="card-body">
          <div class="d-flex justify-content-between mb-3"><h2 class="h6 mb-0">Overdue</h2></div>
          ${listOrEmpty(data.overdue, (item) => `<div class="border-bottom py-2"><a href="#/enquiries/${escapeHtml(item.enquiryId)}">${escapeHtml(item.clientName || item.summary)}</a><div class="small text-secondary">${escapeHtml(formatDate(item.nextFollowUpAt || item.dueAt))}</div></div>`)}
        </div></div>
      </div>
    </div>
    <div class="card mt-3"><div class="card-body">
      <div class="d-flex justify-content-between mb-3"><h2 class="h6 mb-0">Open files</h2><a href="#/enquiries/new" class="btn btn-primary btn-sm">New enquiry</a></div>
      ${(data.live || []).length
        ? `<div class="table-responsive"><table class="table table-clickable align-middle">
        <thead><tr><th>Guest</th><th>Stage</th><th>Owner</th><th>Travel</th><th>Next follow-up</th></tr></thead>
        <tbody>${data.live.map(enquiryRow).join('')}</tbody>
      </table></div>`
        : emptyState('No live files yet', 'Add the guest, then file the enquiry.', '#/enquiries/new', 'New enquiry')}
    </div></div>`;
  bindTableLinks();
}

function listOrEmpty(items, renderItem) {
  if (!items || !items.length) return '<p class="text-secondary mb-0">Nothing here.</p>';
  return items.map(renderItem).join('');
}

function bindTableLinks() {
  document.querySelectorAll('[data-href]').forEach((row) => {
    row.addEventListener('click', () => go(row.getAttribute('data-href')));
  });
}

async function renderPipeline() {
  const data = await api('listEnquiries', { liveOnly: true });
  const groups = {};
  LIVE_STAGES.forEach((stage) => { groups[stage] = []; });
  (data.items || []).forEach((item) => {
    if (!groups[item.stage]) groups[item.stage] = [];
    groups[item.stage].push(item);
  });
  document.getElementById('page').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
      <div><h1 class="fs-3 mb-1">Pipeline</h1><p class="text-secondary mb-0">Live files grouped by stage.</p></div>
      <a class="btn btn-primary" href="#/enquiries/new">New enquiry</a>
    </div>
    ${LIVE_STAGES.map((stage) => {
      const rows = groups[stage] || [];
      return `
        <section class="pipeline-group">
          <h2>${escapeHtml(stage)} <span>(${rows.length})</span></h2>
          ${rows.length
            ? rows.map((item) => `<a class="pipeline-file" href="#/enquiries/${escapeHtml(item.enquiryId)}">${escapeHtml(item.clientName || item.enquiryId)}<div class="small text-secondary">${escapeHtml(item.ownerName || 'Unassigned')} · ${escapeHtml(formatDate(item.nextFollowUpAt))}</div></a>`).join('')
            : '<p class="text-secondary small mb-0">None</p>'}
        </section>`;
    }).join('')}`;
}

async function renderEnquiryList() {
  const data = await api('listEnquiries', {});
  document.getElementById('page').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-4">
      <div><h1 class="fs-3 mb-1">Enquiries</h1><p class="text-secondary mb-0">Trip files from first message to travel.</p></div>
      <a class="btn btn-primary" href="#/enquiries/new">New enquiry</a>
    </div>
    ${(data.items || []).length
      ? `<div class="card"><div class="card-body">
      <div class="table-responsive"><table class="table table-clickable align-middle">
        <thead><tr><th>Guest</th><th>Stage</th><th>Owner</th><th>Travel</th><th>Next follow-up</th></tr></thead>
        <tbody>${data.items.map(enquiryRow).join('')}</tbody>
      </table></div>
    </div></div>`
      : `<div class="card"><div class="card-body">${emptyState('No enquiries yet', 'Add the guest, then file the enquiry from WhatsApp, email, or the website form.', '#/enquiries/new', 'New enquiry')}</div></div>`}`;
  bindTableLinks();
}

function enquiryForm(record, clients) {
  const item = record || {};
  return `
    <form id="enquiry-form" class="card"><div class="card-body p-4">
      <div class="form-section">
        <h3>Guest and owner</h3>
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Client</label>
            <select class="form-select" name="clientId" id="enquiry-client" required>
              <option value="">Select client</option>
              ${optionList((clients || []).map((client) => ({ value: client.clientId, label: client.fullName })), item.clientId)}
            </select>
            <button class="btn btn-link btn-sm px-0" id="toggle-new-guest" type="button">New guest on this page</button>
            <div id="new-guest-wrap" class="border rounded-2 p-3 mt-2 d-none bg-white">
              <div class="mb-2"><label class="form-label">Full name</label><input class="form-control" id="quick-guest-name"></div>
              ${phoneField('quick', { phoneCountry: '255' })}
              <button class="btn btn-light btn-sm mt-2" id="save-quick-guest" type="button">Save guest</button>
            </div>
          </div>
          <div class="col-md-3">
            <label class="form-label">Owner</label>
            <select class="form-select" name="ownerId">${staffOptions(item.ownerId)}</select>
          </div>
          <div class="col-md-3">
            <label class="form-label">Stage</label>
            <select class="form-select" name="stage">${optionList(STAGES, item.stage || 'New')}</select>
          </div>
          <div class="col-md-4">
            <label class="form-label">Source</label>
            <select class="form-select" name="sourceChannel">${optionList(CHANNELS, item.sourceChannel || 'WhatsApp')}</select>
          </div>
        </div>
      </div>
      <div class="form-section">
        <h3>Trip</h3>
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label">Travel style</label>
            <select class="form-select" name="travelStyle">${styleOptions(item.travelStyle)}</select>
          </div>
          <div class="col-md-4">
            <label class="form-label">Lodge band</label>
            <select class="form-select" name="lodgeBand">${optionList(LODGE_BANDS, item.lodgeBand)}</select>
          </div>
          <div class="col-12">
            <label class="form-label d-block">Destinations</label>
            <div class="d-flex flex-wrap">${destinationOptions(item.destinations || [])}</div>
          </div>
          <div class="col-12"><label class="form-label">Itinerary outline</label><textarea class="form-control" name="itineraryOutline" rows="3">${escapeHtml(item.itineraryOutline || '')}</textarea></div>
          <div class="col-md-6"><label class="form-label">Activity notes</label><textarea class="form-control" name="activityNotes" rows="2">${escapeHtml(item.activityNotes || '')}</textarea></div>
          <div class="col-md-6"><label class="form-label">Special requests</label><textarea class="form-control" name="specialRequests" rows="2">${escapeHtml(item.specialRequests || '')}</textarea></div>
        </div>
      </div>
      <div class="form-section">
        <h3>Dates</h3>
        <div class="row g-3">
          <div class="col-md-3">
            <label class="form-label">Travel start</label>
            <input class="form-control" type="date" name="startDate" value="${escapeHtml(formatDate(item.startDate).replace('—', ''))}">
          </div>
          <div class="col-md-3">
            <label class="form-label">Travel end</label>
            <input class="form-control" type="date" name="endDate" value="${escapeHtml(formatDate(item.endDate).replace('—', ''))}">
          </div>
          <div class="col-md-3">
            <label class="form-label">Flexible month</label>
            <input class="form-control" name="flexibleMonth" placeholder="June 2027" value="${escapeHtml(item.flexibleMonth || '')}">
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <div class="form-check mb-2">
              <input class="form-check-input" type="checkbox" name="flexible" ${item.flexible ? 'checked' : ''}>
              <label class="form-check-label">Dates flexible</label>
            </div>
          </div>
          <div class="col-md-2"><label class="form-label">Adults</label><input class="form-control" type="number" min="1" name="adults" value="${escapeHtml(item.adults || 1)}"></div>
          <div class="col-md-2"><label class="form-label">Children</label><input class="form-control" type="number" min="0" name="children" value="${escapeHtml(item.children || 0)}"></div>
          <div class="col-md-4"><label class="form-label">Child ages</label><input class="form-control" name="childAges" value="${escapeHtml(item.childAges || '')}"></div>
        </div>
      </div>
      <div class="form-section">
        <h3>Budget</h3>
        <div class="row g-3">
          <div class="col-md-3">
            <label class="form-label">Budget type</label>
            <select class="form-select" name="budgetType">${optionList(['unknown', 'band', 'quoted'], item.budgetType || 'unknown')}</select>
          </div>
          <div class="col-md-3"><label class="form-label">Amount</label><input class="form-control" type="number" step="0.01" name="budgetAmount" value="${escapeHtml(item.budgetAmount || '')}"></div>
          <div class="col-md-3">
            <label class="form-label">Currency</label>
            <select class="form-select" name="currency">${optionList(['USD', 'TZS'], item.currency || 'USD')}</select>
          </div>
        </div>
      </div>
      <div class="form-section">
        <h3>Next follow-up</h3>
        <div class="row g-3">
          <div class="col-md-4"><label class="form-label">Follow-up date</label><input class="form-control" type="date" name="nextFollowUpAt" value="${escapeHtml(formatDate(item.nextFollowUpAt).replace('—', ''))}"></div>
          <div class="col-md-8"><label class="form-label">Next action</label><input class="form-control" name="nextAction" value="${escapeHtml(item.nextAction || '')}"></div>
          <div class="col-12" id="lost-wrap" style="${item.stage === 'Lost' ? '' : 'display:none'}">
            <label class="form-label">Lost / cancelled reason</label>
            <input class="form-control" name="lostReason" value="${escapeHtml(item.lostReason || '')}">
          </div>
        </div>
      </div>
      <div class="form-sticky-actions d-flex gap-2">
        <button class="btn btn-primary" type="submit">Save</button>
        <a class="btn btn-light" href="#/enquiries">Cancel</a>
      </div>
    </div></form>`;
}

function readEnquiryForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  data.flexible = form.querySelector('[name=flexible]').checked;
  data.destinations = Array.from(form.querySelectorAll('[name=destinations]:checked')).map((node) => node.value);
  data.adults = Number(data.adults || 0);
  data.children = Number(data.children || 0);
  data.budgetAmount = data.budgetAmount === '' ? '' : Number(data.budgetAmount);
  return data;
}

async function renderEnquiryNew() {
  const clients = await api('listClients', {});
  const preset = window.sessionStorage.getItem('lamai.newEnquiryClient') || '';
  if (preset) window.sessionStorage.removeItem('lamai.newEnquiryClient');
  document.getElementById('page').innerHTML = `<div class="mb-4"><h1 class="fs-3 mb-1">New enquiry</h1><p class="text-secondary">File an inbound WhatsApp, email, or web message.</p></div>${enquiryForm({ clientId: preset }, clients.items || [])}`;
  wireEnquiryForm();
}

async function renderEnquiryDetail(enquiryId) {
  const detail = await api('getEnquiryDetail', { enquiryId: enquiryId });
  const clients = await api('listClients', {});
  const payments = detail.payments || [];
  const enquiry = detail.enquiry || {};
  document.getElementById('page').innerHTML = `
    <div class="d-flex justify-content-between align-items-start mb-4">
      <div>
        <h1 class="fs-3 mb-1">${escapeHtml(enquiry.clientName || enquiry.enquiryId)}</h1>
        <p class="text-secondary mb-0">${escapeHtml(enquiry.enquiryId)} · ${escapeHtml(enquiry.stage)}</p>
      </div>
      <div class="d-flex gap-2">
        ${isAdmin() ? `<button class="btn btn-outline-primary btn-sm" id="make-milestones" type="button">Create deposit / balance</button>` : ''}
      </div>
    </div>
    ${enquiryForm(enquiry, clients.items || [])}
    <div class="row g-3 mt-1">
      <div class="col-lg-6">
        <div class="card"><div class="card-body">
          <h2 class="h6">Follow-up / timeline</h2>
          <form id="activity-form" class="activity-composer mb-3">
            <div class="row g-2">
              <div class="col-md-3"><select class="form-select" name="type">${optionList(ACTIVITY_TYPES, 'follow-up')}</select></div>
              <div class="col-md-5"><input class="form-control" name="summary" placeholder="Call, WhatsApp, or what is next" required></div>
              <div class="col-md-2"><input class="form-control" type="date" name="dueAt" aria-label="Due date"></div>
              <div class="col-md-2"><button class="btn btn-light w-100" type="submit">Log</button></div>
            </div>
          </form>
          ${listOrEmpty(detail.activities, (item) => `<div class="border-bottom py-2"><div>${escapeHtml(item.summary)}</div><div class="small text-secondary">${escapeHtml(item.type)} · ${escapeHtml(formatDate(item.dueAt || item.createdAt))}${item.completedAt ? ' · done' : ''}</div></div>`)}
        </div></div>
      </div>
      <div class="col-lg-6">
        <div class="card"><div class="card-body">
          <h2 class="h6">Payment milestones</h2>
          ${listOrEmpty(payments, (item) => `
            <div class="border rounded-2 p-3 mb-2">
              <div class="d-flex justify-content-between">
                <strong>${escapeHtml(item.kind)}</strong>
                <span class="badge text-bg-light">${escapeHtml(item.status)}</span>
              </div>
              <div>${escapeHtml(item.currency)} ${escapeHtml(item.amount)} · due ${escapeHtml(formatDate(item.dueDate))}</div>
              ${item.note ? `<div class="small text-secondary">${escapeHtml(item.note)}</div>` : ''}
              ${isAdmin() && item.status === 'due' ? `<button class="btn btn-sm btn-primary mt-2 mark-paid" data-id="${escapeHtml(item.paymentId)}" type="button">Mark received</button>` : ''}
            </div>`)}
          <p class="small text-secondary mb-0">Public T&amp;Cs: 50% deposit to book, balance 90 days before departure. Cancel &gt;90 days = 50%, ≤90 days = 100%.</p>
        </div></div>
      </div>
    </div>`;
  wireEnquiryForm(enquiryId);
  const activityForm = document.getElementById('activity-form');
  activityForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = activityForm.querySelector('button[type=submit]');
    const form = Object.fromEntries(new FormData(activityForm).entries());
    setBusy(button, true, 'Saving…');
    try {
      await api('createActivity', { enquiryId: enquiryId, type: form.type, summary: form.summary, dueAt: form.dueAt });
      notify('Follow-up logged.', 'success');
      await renderEnquiryDetail(enquiryId);
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
  document.querySelectorAll('.mark-paid').forEach((button) => {
    button.addEventListener('click', async () => {
      const note = window.prompt('Wire reference or note (optional)') || '';
      setBusy(button, true, 'Saving…');
      try {
        await api('markPaymentPaid', { paymentId: button.getAttribute('data-id'), note: note });
        notify('Marked received.', 'success');
        await renderEnquiryDetail(enquiryId);
      } catch (error) {
        setBusy(button, false);
        notify(error.message, 'danger');
      }
    });
  });
  const make = document.getElementById('make-milestones');
  if (make) {
    make.addEventListener('click', async () => {
      setBusy(make, true, 'Creating…');
      try {
        await api('generatePaymentMilestones', { enquiryId: enquiryId });
        notify('Deposit and balance created.', 'success');
        await renderEnquiryDetail(enquiryId);
      } catch (error) {
        setBusy(make, false);
        notify(error.message, 'danger');
      }
    });
  }
}

function wireEnquiryForm(enquiryId) {
  const form = document.getElementById('enquiry-form');
  if (!form) return;
  const stage = form.querySelector('[name=stage]');
  const lostWrap = document.getElementById('lost-wrap');
  if (stage && lostWrap) {
    stage.addEventListener('change', () => {
      lostWrap.style.display = stage.value === 'Lost' ? '' : 'none';
    });
  }
  const toggleGuest = document.getElementById('toggle-new-guest');
  const guestWrap = document.getElementById('new-guest-wrap');
  if (toggleGuest && guestWrap) {
    toggleGuest.addEventListener('click', () => guestWrap.classList.toggle('d-none'));
  }
  const saveGuest = document.getElementById('save-quick-guest');
  if (saveGuest) {
    saveGuest.addEventListener('click', async () => {
      const name = (document.getElementById('quick-guest-name') || {}).value;
      const country = (guestWrap && guestWrap.querySelector('[name=quickphoneCountry]')) || {};
      const number = (guestWrap && guestWrap.querySelector('[name=quickphoneNumber]')) || {};
      setBusy(saveGuest, true, 'Saving…');
      try {
        const created = await api('createClient', {
          fullName: name,
          phoneCountry: country.value || '255',
          phoneNumber: number.value || '',
          source: 'web form'
        });
        const select = document.getElementById('enquiry-client');
        if (select) {
          const option = document.createElement('option');
          option.value = created.clientId;
          option.textContent = created.fullName;
          option.selected = true;
          select.appendChild(option);
        }
        if (guestWrap) guestWrap.classList.add('d-none');
        setBusy(saveGuest, false);
        notify('Guest saved. Continue the enquiry.', 'success');
      } catch (error) {
        setBusy(saveGuest, false);
        notify(error.message, 'danger');
      }
    });
  }
  focusFirstField(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit]');
    const payload = readEnquiryForm(form);
    setBusy(button, true, 'Saving…');
    try {
      if (enquiryId) {
        payload.enquiryId = enquiryId;
        await api('updateEnquiry', payload);
        setBusy(button, false);
        notify('Enquiry saved.', 'success');
      } else {
        const created = await api('createEnquiry', payload);
        notify('Enquiry created.', 'success');
        go('#/enquiries/' + created.enquiryId);
      }
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
}

async function renderClients() {
  const data = await api('listClients', {});
  document.getElementById('page').innerHTML = `
    <div class="d-flex justify-content-between align-items-start mb-4 gap-3 flex-wrap">
      <div><h1 class="fs-3 mb-1">Clients</h1><p class="text-secondary mb-0">Add a guest by hand, or fill the form from a website CSV.</p></div>
      <div class="d-flex gap-2 flex-wrap">
        <label class="btn btn-light mb-0">Upload CSV<input id="client-csv" class="d-none" type="file" accept=".csv,text/csv"></label>
        <button class="btn btn-light" id="sample-csv" type="button">Sample CSV</button>
      </div>
    </div>
    <div id="csv-preview" class="card mb-3 d-none"><div class="card-body">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h2 class="h6 mb-0">CSV guests</h2>
        <div class="d-flex gap-2">
          <button class="btn btn-sm btn-light" id="csv-prev" type="button">Previous</button>
          <button class="btn btn-sm btn-light" id="csv-next" type="button">Next</button>
          <button class="btn btn-sm btn-light" id="csv-skip" type="button">Skip</button>
        </div>
      </div>
      <p class="small text-secondary mb-2" id="csv-status"></p>
      <div class="table-responsive"><table class="table table-sm mb-0"><thead><tr><th>Name</th><th>Email</th><th>Phone</th></tr></thead><tbody id="csv-rows"></tbody></table></div>
    </div></div>
    <div class="row g-3">
      <div class="col-lg-5">
        <form id="client-form" class="card"><div class="card-body p-4">
          <h2 class="h6 mb-3">New client</h2>
          <div class="mb-3"><label class="form-label">Full name</label><input class="form-control" name="fullName" required></div>
          <div class="mb-3"><label class="form-label">Email</label><input class="form-control" type="email" name="email"></div>
          <div class="mb-3">${phoneField('', { phoneCountry: '255' })}</div>
          <details class="mb-3">
            <summary class="small mb-2">More details</summary>
            <div class="mb-3 mt-2"><label class="form-label">Nationality / residence</label><input class="form-control" name="nationality"></div>
            <div class="mb-3"><label class="form-label">Party type</label><select class="form-select" name="partyType">${optionList(PARTY_TYPES, 'couple')}</select></div>
            <div class="mb-3"><label class="form-label">Language notes</label><input class="form-control" name="languageNotes"></div>
            <div class="mb-3"><label class="form-label">How they heard of Lamai</label><select class="form-select" name="source">${optionList(['web form', 'email', 'phone/WhatsApp', 'repeat guest', 'referral', 'other'], 'web form')}</select></div>
          </details>
          <div class="mb-3"><label class="form-label">Notes</label><textarea class="form-control" name="notes" rows="2"></textarea></div>
          <div class="form-sticky-actions d-flex gap-2 flex-wrap">
            <button class="btn btn-primary" type="submit">Save client</button>
            <button class="btn btn-light" name="thenEnquiry" value="1" type="submit">Save and file enquiry</button>
          </div>
        </div></form>
      </div>
      <div class="col-lg-7">
        <div class="card"><div class="card-body">
          ${(data.items || []).length
            ? `<div class="table-responsive"><table class="table align-middle">
            <thead><tr><th>Name</th><th>Phone</th><th>Party</th>${isAdmin() ? '<th></th>' : ''}</tr></thead>
            <tbody>${data.items.map((item) => `<tr>
              <td>${escapeHtml(item.fullName)}</td>
              <td>+${escapeHtml(item.phoneCountry || '')} ${escapeHtml(item.phoneNumber || '')}</td>
              <td>${escapeHtml(item.partyType || '')}</td>
              ${isAdmin() ? `<td><button class="btn btn-sm btn-light delete-client" data-id="${escapeHtml(item.clientId)}" data-name="${escapeHtml(item.fullName)}" type="button">Delete</button></td>` : ''}
            </tr>`).join('')}</tbody>
          </table></div>`
            : emptyState('No clients yet', 'Add the guest, then file the enquiry.', '', '')}
        </div></div>
      </div>
    </div>`;
  const form = document.getElementById('client-form');
  focusFirstField(form);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter || event.target.querySelector('button[type=submit]');
    const payload = Object.fromEntries(new FormData(event.target).entries());
    const fileEnquiry = button && button.getAttribute('name') === 'thenEnquiry';
    setBusy(button, true, 'Saving…');
    try {
      const created = await api('createClient', payload);
      notify('Client saved.', 'success');
      if (fileEnquiry && created && created.clientId) {
        window.sessionStorage.setItem('lamai.newEnquiryClient', created.clientId);
        go('#/enquiries/new');
        return;
      }
      if (state.csvRows && state.csvRows.length) {
        state.csvRows.splice(state.csvIndex || 0, 1);
        if (state.csvRows.length) {
          fillClientForm(state.csvRows[Math.min(state.csvIndex || 0, state.csvRows.length - 1)]);
          renderCsvPreview();
          setBusy(button, false);
          return;
        }
      }
      await renderClients();
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
  document.getElementById('sample-csv').addEventListener('click', () => {
    const blob = new Blob([SAMPLE_CLIENT_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lamai-clients-sample.csv';
    link.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('client-csv').addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      state.csvRows = mapClientCsv(text);
      state.csvIndex = 0;
      if (!state.csvRows.length) {
        notify('No guest names found in that CSV. Check the header row.', 'warning');
        return;
      }
      fillClientForm(state.csvRows[0]);
      renderCsvPreview();
      notify('CSV loaded. Edit the form, then save.', 'success');
    } catch (error) {
      notify('Could not read that file.', 'danger');
    }
  });
  ['csv-prev', 'csv-next', 'csv-skip'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.addEventListener('click', () => stepCsv(id));
  });
  document.querySelectorAll('.delete-client').forEach((button) => {
    button.addEventListener('click', async () => {
      const name = button.getAttribute('data-name') || '';
      const confirmed = confirmTypedDelete('Type the guest name "' + name + '" to permanently delete this client and all their trip files.', name);
      if (confirmed == null) return;
      if (!confirmed) {
        notify('Name did not match. Nothing was deleted.', 'warning');
        return;
      }
      setBusy(button, true, 'Deleting…');
      try {
        await api('deleteClient', { clientId: button.getAttribute('data-id'), confirmName: name });
        notify('Client and related files deleted.', 'success');
        await renderClients();
      } catch (error) {
        setBusy(button, false);
        notify(error.message, 'danger');
      }
    });
  });
}

function fillClientForm(record) {
  const form = document.getElementById('client-form');
  if (!form || !record) return;
  ['fullName', 'email', 'phoneCountry', 'phoneNumber', 'nationality', 'partyType', 'languageNotes', 'source', 'notes'].forEach((name) => {
    const field = form.elements[name];
    if (field) field.value = record[name] == null ? '' : record[name];
  });
}

function renderCsvPreview() {
  const box = document.getElementById('csv-preview');
  const body = document.getElementById('csv-rows');
  const status = document.getElementById('csv-status');
  if (!box || !body) return;
  const rows = state.csvRows || [];
  box.classList.toggle('d-none', !rows.length);
  if (!rows.length) return;
  const index = Math.min(state.csvIndex || 0, rows.length - 1);
  state.csvIndex = index;
  status.textContent = `Row ${index + 1} of ${rows.length}. Edit the form on the left, then save.`;
  body.innerHTML = rows.map((row, i) => `<tr class="csv-row${i === index ? ' is-active' : ''}" data-index="${i}"><td>${escapeHtml(row.fullName)}</td><td>${escapeHtml(row.email)}</td><td>+${escapeHtml(row.phoneCountry)} ${escapeHtml(row.phoneNumber)}</td></tr>`).join('');
  body.querySelectorAll('.csv-row').forEach((row) => {
    row.addEventListener('click', () => {
      state.csvIndex = Number(row.getAttribute('data-index'));
      fillClientForm(state.csvRows[state.csvIndex]);
      renderCsvPreview();
    });
  });
}

function stepCsv(action) {
  const rows = state.csvRows || [];
  if (!rows.length) return;
  if (action === 'csv-prev') state.csvIndex = Math.max((state.csvIndex || 0) - 1, 0);
  if (action === 'csv-next') state.csvIndex = Math.min((state.csvIndex || 0) + 1, rows.length - 1);
  if (action === 'csv-skip') {
    rows.splice(state.csvIndex || 0, 1);
    if (!rows.length) {
      document.getElementById('csv-preview').classList.add('d-none');
      return;
    }
    state.csvIndex = Math.min(state.csvIndex || 0, rows.length - 1);
  }
  fillClientForm(rows[state.csvIndex]);
  renderCsvPreview();
}

async function renderWork() {
  const data = await api('getWorkData', {});
  document.getElementById('page').innerHTML = `
    <div class="mb-4"><h1 class="fs-3 mb-1">Work</h1><p class="text-secondary">Due and overdue follow-ups.</p></div>
    <div class="row g-3">
      <div class="col-lg-6"><div class="card"><div class="card-body"><h2 class="h6">Due today</h2>${listOrEmpty(data.dueToday, workItem)}</div></div></div>
      <div class="col-lg-6"><div class="card"><div class="card-body"><h2 class="h6">Overdue</h2>${listOrEmpty(data.overdue, workItem)}</div></div></div>
    </div>`;
}

function workItem(item) {
  return `<div class="border-bottom py-2"><a href="#/enquiries/${escapeHtml(item.enquiryId)}">${escapeHtml(item.clientName || item.summary)}</a><div class="small text-secondary">${escapeHtml(item.summary || item.nextAction || '')} · ${escapeHtml(formatDate(item.dueAt || item.nextFollowUpAt))}</div></div>`;
}

async function renderPayments() {
  const data = await api('listPayments', {});
  document.getElementById('page').innerHTML = `
    <div class="mb-4"><h1 class="fs-3 mb-1">Payments</h1><p class="text-secondary">Deposit and 90-day balance milestones.</p></div>
    <div class="card"><div class="card-body">
      <div class="table-responsive"><table class="table align-middle">
        <thead><tr><th>Guest</th><th>Kind</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody>${(data.items || []).map((item) => `<tr>
          <td><a href="#/enquiries/${escapeHtml(item.enquiryId)}">${escapeHtml(item.clientName || item.enquiryId)}</a></td>
          <td>${escapeHtml(item.kind)}</td>
          <td>${escapeHtml(item.currency)} ${escapeHtml(item.amount)}</td>
          <td>${escapeHtml(formatDate(item.dueDate))}</td>
          <td>${escapeHtml(item.status)}</td>
          <td>${item.status === 'due' ? `<button class="btn btn-sm btn-primary mark-paid" data-id="${escapeHtml(item.paymentId)}" type="button">Mark received</button>` : ''}</td>
        </tr>`).join('') || `<tr><td colspan="6" class="text-secondary">No milestones yet.</td></tr>`}</tbody>
      </table></div>
    </div></div>`;
  document.querySelectorAll('.mark-paid').forEach((button) => {
    button.addEventListener('click', async () => {
      const note = window.prompt('Wire reference or note (optional)') || '';
      setBusy(button, true, 'Saving…');
      try {
        await api('markPaymentPaid', { paymentId: button.getAttribute('data-id'), note: note });
        notify('Marked received.', 'success');
        await renderPayments();
      } catch (error) {
        setBusy(button, false);
        notify(error.message, 'danger');
      }
    });
  });
}

async function renderReports() {
  const data = await api('getReportData', {});
  document.getElementById('page').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
      <div><h1 class="fs-3 mb-1">Reports</h1><p class="text-secondary mb-0">Simple counts, not a ledger.</p></div>
      <button class="btn btn-primary" id="download-excel" type="button">Download Excel</button>
    </div>
    <div class="row g-3 mb-4">
      ${statCard('ti-files', 'Live files', data.liveCount || 0, 'primary')}
      ${statCard('ti-alert-circle', 'Overdue follow-ups', data.overdueCount || 0, 'danger')}
      ${statCard('ti-cash', 'Unpaid milestones', data.unpaidCount || 0, 'warning')}
    </div>
    <div class="card"><div class="card-body">
      <h2 class="h6">By stage</h2>
      <div class="table-responsive"><table class="table">
        <thead><tr><th>Stage</th><th>Count</th></tr></thead>
        <tbody>${(data.byStage || []).map((row) => `<tr><td>${escapeHtml(row.stage)}</td><td>${escapeHtml(row.count)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div></div>`;
  document.getElementById('download-excel').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setBusy(button, true, 'Preparing…');
    try {
      const file = await api('exportReportCsv', {});
      const blob = new Blob(['\uFEFF' + (file.csv || '')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.fileName || 'Lamai-Safaris-report.csv';
      link.click();
      URL.revokeObjectURL(url);
      setBusy(button, false);
      notify('Report downloaded. Open it in Excel.', 'success');
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
}

async function renderSettings() {
  const data = await api('getAdminData', {});
  document.getElementById('page').innerHTML = `
    <div class="mb-4"><h1 class="fs-3 mb-1">Settings</h1><p class="text-secondary">Staff accounts and trip reference lists.</p></div>
    <form id="staff-form" class="card mb-3"><div class="card-body p-4">
      <h2 class="h6 mb-3">Add staff</h2>
      <div class="mb-3"><label class="form-label">Name</label><input class="form-control" name="displayName" required></div>
      <div class="mb-3"><label class="form-label">Work label</label><select class="form-select" name="workLabel">${optionList(WORK_LABELS, 'Sales')}</select></div>
      <button class="btn btn-primary" type="submit">Create account</button>
      <div id="staff-once"></div>
    </div></form>
    <div class="card mb-3"><div class="card-body">
      <h2 class="h6">Staff</h2>
      <div class="table-responsive"><table class="table">
        <thead><tr><th>Name</th><th>Username</th><th>Label</th><th></th></tr></thead>
        <tbody>${(data.staff || []).map((person) => `<tr>
          <td>${escapeHtml(person.displayName)}</td>
          <td>${escapeHtml(person.username)}</td>
          <td>${escapeHtml(person.workLabel || '')}</td>
          <td class="text-nowrap">${person.role === 'Super Admin' ? '' : `
            <button class="btn btn-sm btn-light edit-staff" data-id="${escapeHtml(person.userId)}" data-name="${escapeHtml(person.displayName)}" data-label="${escapeHtml(person.workLabel || 'Sales')}" type="button">Edit</button>
            <button class="btn btn-sm btn-light reset-password" data-id="${escapeHtml(person.userId)}" type="button">Reset password</button>
            <button class="btn btn-sm btn-light delete-staff" data-id="${escapeHtml(person.userId)}" data-username="${escapeHtml(person.username)}" type="button">Delete</button>
          `}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <form id="staff-edit" class="border p-3 mt-3 d-none">
        <h3 class="h6">Edit staff</h3>
        <input type="hidden" name="userId">
        <div class="mb-2"><label class="form-label">Name</label><input class="form-control" name="displayName" required></div>
        <div class="mb-3"><label class="form-label">Work label</label><select class="form-select" name="workLabel">${optionList(WORK_LABELS, 'Sales')}</select></div>
        <button class="btn btn-primary" type="submit">Save changes</button>
      </form>
    </div></div>
    <form id="reference-form" class="card"><div class="card-body p-4">
      <h2 class="h6 mb-3">Add destination or style</h2>
      <div class="mb-2"><select class="form-select" name="kind">${optionList(['destination', 'style'], 'destination')}</select></div>
      <div class="mb-3"><input class="form-control" name="label" placeholder="Label" required></div>
      <button class="btn btn-primary" type="submit">Add</button>
      <div class="mt-3 small">${(data.references && data.references.destinations || []).map((item) => escapeHtml(item.label)).join(', ')}</div>
    </div></form>`;
  document.getElementById('staff-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]');
    const payload = Object.fromEntries(new FormData(event.target).entries());
    setBusy(button, true, 'Creating…');
    try {
      const created = await api('createUser', payload);
      const box = document.getElementById('staff-once');
      box.innerHTML = credentialsBox(created.username, created.oneTimePassword);
      bindCopyButtons(box);
      bindPasswordToggles(box);
      event.target.reset();
      setBusy(button, false);
      notify('Staff account created.', 'success');
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
  document.getElementById('reference-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]');
    const payload = Object.fromEntries(new FormData(event.target).entries());
    setBusy(button, true, 'Saving…');
    try {
      await api('saveReferenceItem', payload);
      notify('Reference saved.', 'success');
      await renderSettings();
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
  document.querySelectorAll('.reset-password').forEach((button) => {
    button.addEventListener('click', async () => {
      setBusy(button, true, 'Resetting…');
      try {
        const result = await api('resetStaffPassword', { userId: button.getAttribute('data-id') });
        setBusy(button, false);
        const box = document.getElementById('staff-once');
        box.innerHTML = credentialsBox(result.username, result.oneTimePassword);
        bindCopyButtons(box);
        bindPasswordToggles(box);
        notify('Password reset. Copy the new one-time password.', 'success');
      } catch (error) {
        setBusy(button, false);
        notify(error.message, 'danger');
      }
    });
  });
  const editForm = document.getElementById('staff-edit');
  if (editForm) {
    document.querySelectorAll('.edit-staff').forEach((button) => {
      button.addEventListener('click', () => {
        editForm.classList.remove('d-none');
        editForm.elements.userId.value = button.getAttribute('data-id');
        editForm.elements.displayName.value = button.getAttribute('data-name') || '';
        editForm.elements.workLabel.value = button.getAttribute('data-label') || 'Sales';
        editForm.scrollIntoView({ block: 'nearest' });
      });
    });
    editForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = editForm.querySelector('button[type=submit]');
      setBusy(button, true, 'Saving…');
      try {
        await api('updateUser', Object.fromEntries(new FormData(editForm).entries()));
        notify('Staff updated.', 'success');
        await renderSettings();
      } catch (error) {
        setBusy(button, false);
        notify(error.message, 'danger');
      }
    });
  }
  document.querySelectorAll('.delete-staff').forEach((button) => {
    button.addEventListener('click', async () => {
      const username = button.getAttribute('data-username') || '';
      const confirmed = confirmTypedDelete('Type the username "' + username + '" to permanently delete this staff account and login.', username);
      if (confirmed == null) return;
      if (!confirmed) {
        notify('Username did not match. Nothing was deleted.', 'warning');
        return;
      }
      setBusy(button, true, 'Deleting…');
      try {
        await api('deleteUser', { userId: button.getAttribute('data-id'), confirmUsername: username });
        notify('Staff account deleted.', 'success');
        await renderSettings();
      } catch (error) {
        setBusy(button, false);
        notify(error.message, 'danger');
      }
    });
  });
}

function noticeId(kind, item) {
  return kind + ':' + (item.enquiryId || item.paymentId || '');
}

function seenNoticeIds() {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(SEEN_KEY) || '[]'));
  } catch (error) {
    return new Set();
  }
}

function flattenNotices() {
  const notices = state.notices || { dueToday: [], overdue: [], unpaid: [] };
  return []
    .concat((notices.overdue || []).map((item) => Object.assign({}, item, { kind: 'overdue', label: 'Overdue' })))
    .concat((notices.dueToday || []).map((item) => Object.assign({}, item, { kind: 'due', label: 'Due today' })))
    .concat((notices.unpaid || []).map((item) => Object.assign({}, item, { kind: 'pay', label: 'Payment due' })));
}

function renderNoticePanel(markSeen) {
  const list = document.getElementById('notice-list');
  const badge = document.getElementById('due-badge');
  const items = flattenNotices();
  const seen = seenNoticeIds();
  if (markSeen) {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(items.map((item) => noticeId(item.kind, item))));
  }
  const unread = markSeen ? 0 : items.filter((item) => !seen.has(noticeId(item.kind, item))).length;
  if (badge) {
    badge.textContent = String(unread);
    badge.classList.toggle('d-none', unread < 1);
  }
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<p class="text-secondary small px-3 py-3 mb-0">Nothing due.</p>';
    return;
  }
  list.innerHTML = items.map((item) => {
    const id = noticeId(item.kind, item);
    const unreadNow = !markSeen && !seen.has(id);
    const href = item.enquiryId ? '#/enquiries/' + item.enquiryId : '#/payments';
    return `<a class="notice-row${unreadNow ? ' is-unread' : ''}" href="${escapeHtml(href)}">${unreadNow ? '<span class="notice-dot"></span>' : ''}<span class="small text-secondary">${escapeHtml(item.label)}</span><div>${escapeHtml(item.clientName || item.summary || item.kind)}</div><div class="small text-secondary">${escapeHtml(item.summary || item.nextAction || ((item.currency || '') + ' ' + (item.amount || '')))}</div></a>`;
  }).join('');
}

async function refreshNotifications() {
  if (!state.session) return;
  try {
    state.notices = await api('getNotificationData', {});
    renderNoticePanel(false);
  } catch (error) {
    /* keep last */
  }
}

function bindChromeTools() {
  const search = document.getElementById('workspace-search');
  const results = document.getElementById('search-results');
  let timer = 0;
  if (search && results) {
    const hide = () => results.classList.add('d-none');
    search.addEventListener('input', () => {
      window.clearTimeout(timer);
      const query = search.value.trim();
      if (query.length < 2) {
        hide();
        return;
      }
      timer = window.setTimeout(async () => {
        try {
          const data = await api('searchWorkspace', { q: query });
          const items = data.items || [];
          if (!items.length) {
            results.innerHTML = '<div class="px-3 py-3 small text-secondary">No matches.</div>';
            results.classList.remove('d-none');
            return;
          }
          results.innerHTML = items.map((item) => `<a class="search-hit" href="${escapeHtml(item.href)}"><div class="small text-secondary">${escapeHtml(item.kind)}</div><div>${escapeHtml(item.title)}</div><div class="small text-secondary">${escapeHtml(item.hint || '')}</div></a>`).join('');
          results.classList.remove('d-none');
        } catch (error) {
          results.innerHTML = `<div class="px-3 py-3 small text-danger">${escapeHtml(error.message)}</div>`;
          results.classList.remove('d-none');
        }
      }, 250);
    });
    results.addEventListener('click', () => {
      hide();
      search.value = '';
    });
    document.addEventListener('click', (event) => {
      if (!search.contains(event.target) && !results.contains(event.target)) hide();
    });
  }
  const bell = document.getElementById('work-bell');
  if (bell) {
    bell.addEventListener('show.bs.dropdown', () => {
      refreshNotifications().then(() => renderNoticePanel(true));
    });
  }
}

async function refreshBootstrap() {
  state.bootstrap = await api('getBootstrap', {});
  state.session = state.bootstrap.session || state.session;
  if (state.bootstrap.dueCount != null) setChrome(!!state.session);
}

function requireAdmin() {
  if (!isAdmin()) {
    document.getElementById('page').innerHTML = '<div class="alert alert-warning">Only Super Admin can open this page.</div>';
    return false;
  }
  return true;
}

async function route() {
  const seq = (route.seq = (route.seq || 0) + 1);
  showAlert('');
  const info = parseHash();
  if (info.path === '/sign-out') {
    try { await api('logout', {}); } catch (error) { /* ignore */ }
    clearToken();
    state.session = null;
    go('#/sign-in');
    return;
  }

  if (window.localStorage.getItem('lamai.token')) {
    setChrome(true);
    showPageLoading();
  }

  try {
    state.bootstrap = await api('getBootstrap', {});
  } catch (error) {
    if (seq !== route.seq) return;
    document.getElementById('auth-root').innerHTML = authCard('Cannot reach workspace', `<p class="text-secondary">${escapeHtml(error.message)}</p>`);
    setChrome(false);
    return;
  }
  if (seq !== route.seq) return;

  if (state.bootstrap.needsSetup) {
    setChrome(false);
    renderSetup();
    return;
  }

  state.session = state.bootstrap.session || null;
  if (!state.session) {
    setChrome(false);
    renderSignIn();
    return;
  }

  if (state.session.mustChangePassword && info.path !== '/change-password') {
    setChrome(false);
    renderChangePassword();
    return;
  }

  if (info.path === '/sign-in') {
    go('#/today');
    return;
  }

  if (info.path === '/change-password') {
    setChrome(!state.session.mustChangePassword);
    renderChangePassword();
    return;
  }

  setChrome(true);
  markNav(info.path);
  showPageLoading();

  try {
    if (info.path === '/today' || info.path === '/') await renderToday();
    else if (info.path === '/pipeline') await renderPipeline();
    else if (info.path === '/enquiries/new') await renderEnquiryNew();
    else if (info.parts[0] === 'enquiries' && info.parts[1]) await renderEnquiryDetail(info.parts[1]);
    else if (info.path === '/enquiries') await renderEnquiryList();
    else if (info.path === '/clients') await renderClients();
    else if (info.path === '/work') await renderWork();
    else if (info.path === '/payments') {
      if (requireAdmin()) await renderPayments();
    } else if (info.path === '/reports') {
      if (requireAdmin()) await renderReports();
    } else if (info.path === '/settings') {
      if (requireAdmin()) await renderSettings();
    } else {
      document.getElementById('page').innerHTML = '<div class="alert alert-light">Page not found.</div>';
    }
  } catch (error) {
    if (seq !== route.seq) return;
    if (error.code === 'UNAUTHENTICATED') {
      clearToken();
      go('#/sign-in');
      return;
    }
    const page = document.getElementById('page');
    if (page) {
      page.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
    } else {
      document.getElementById('auth-root').innerHTML = authCard('Page could not open', `<p class="text-secondary">${escapeHtml(error.message)}</p>`);
    }
  }
}

async function start() {
  bindHashLinks();
  bindChromeTools();
  try {
    await playSplash();
    window.addEventListener('hashchange', () => { route(); });
    if (!window.location.hash) {
      window.location.hash = '#/today';
      return;
    }
    await route();
  } catch (error) {
    const root = document.getElementById('auth-root');
    if (root) {
      root.innerHTML = authCard('Something went wrong', `<p class="text-secondary">${escapeHtml(error.message)}</p>`);
    }
    setChrome(false);
  }
}

start();
