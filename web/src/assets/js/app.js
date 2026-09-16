import { api, setToken, clearToken } from './api.js';
import { COUNTRY_CODES } from './country-codes.js';
import { closeMobileSidebar } from './sidebar.js';
import logoUrl from './logo.js';
import { mapClientCsv, SAMPLE_CLIENT_CSV } from './csv.js';

const STAGES = [
  'New enquiry',
  'Quoting',
  'Follow-up',
  'Accepted',
  'Confirmed booking',
  'Reservations in progress',
  'Supplier booking completed',
  'Awaiting payment',
  'Paid',
  'Operations in progress',
  'Travel completed',
  'Closed',
  'Archived'
];
const LIVE_STAGES = STAGES.filter((stage) => stage !== 'Closed' && stage !== 'Archived');
const DEPARTMENTS = ['Sales', 'Reservations', 'Accounts', 'Operations'];
const FILE_STATUSES = ['Pending', 'Delayed', 'Confirmed', 'Paid', 'Completed'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const STAGE_DEPARTMENT = {
  'New enquiry': 'Sales',
  Quoting: 'Sales',
  'Follow-up': 'Sales',
  Accepted: 'Sales',
  'Confirmed booking': 'Reservations',
  'Reservations in progress': 'Reservations',
  'Supplier booking completed': 'Reservations',
  'Awaiting payment': 'Accounts',
  Paid: 'Accounts',
  'Operations in progress': 'Operations',
  'Travel completed': 'Operations',
  Closed: '',
  Archived: ''
};
const PARTY_TYPES = ['solo', 'couple', 'family', 'friends', 'group'];
const CHANNELS = ['email', 'phone', 'web', 'WhatsApp', 'other'];
const LODGE_BANDS = ['bush camp', 'mid', 'luxury', 'mix'];
const WORK_LABELS = ['Sales', 'Reservations', 'Accounts', 'Operations', 'Guide'];
const ACTIVITY_TYPES = ['call', 'WhatsApp', 'email', 'note', 'follow-up'];
const TERMINAL_STAGES = ['Closed', 'Archived'];
const USERNAME_KEY = 'lamai.username';
const SEEN_KEY = 'lamai.notifSeen';

const state = {
  bootstrap: null,
  bootstrapToken: '',
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
  return state.session && (state.session.role === 'Super Admin' || state.session.roleId === 'ADMIN');
}

function permissions() {
  return (state.bootstrap && state.bootstrap.permissions) || {
    roleId: isAdmin() ? 'ADMIN' : 'SALES',
    modules: {},
    actions: {},
    fields: {},
    stages: LIVE_STAGES
  };
}

function canModule(name) {
  const mods = permissions().modules || {};
  if (Object.keys(mods).length === 0) return isAdmin() || name !== 'settings';
  return !!mods[name];
}

function canAction(name) {
  const actions = permissions().actions || {};
  if (Object.keys(actions).length === 0) return isAdmin();
  return !!actions[name];
}

function roleStages() {
  const stages = permissions().stages;
  if (stages && stages.length) return stages.filter((stage) => stage !== 'Closed' && stage !== 'Archived');
  return LIVE_STAGES;
}

function fieldAccess(group) {
  return (permissions().fields && permissions().fields[group]) || 'read';
}

function denyPage(message) {
  document.getElementById('page').innerHTML = `<div class="alert alert-warning">${escapeHtml(message || 'You do not have access to this area.')}</div>`;
  return false;
}

function requireModule(name, message) {
  if (!canModule(name)) {
    denyPage(message || 'You do not have access to this area.');
    return false;
  }
  return true;
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

function showPageLoading(message) {
  const page = document.getElementById('page');
  if (page) {
    page.innerHTML = `<div class="lamai-loading d-flex flex-column align-items-center justify-content-center py-5" style="min-height:40vh">
      <span class="spinner-border text-primary" role="status" aria-hidden="true"></span>
      <div class="mt-3 text-secondary">${escapeHtml(message || 'Loading…')}</div>
    </div>`;
  }
}

function showSigningOut() {
  setChrome(true);
  const page = document.getElementById('page');
  const auth = document.getElementById('auth-root');
  if (page) {
    page.innerHTML = `<div class="lamai-loading d-flex flex-column align-items-center justify-content-center py-5" style="min-height:40vh">
      <span class="spinner-border text-primary" role="status" aria-hidden="true"></span>
      <div class="mt-3 text-secondary">Signing out…</div>
    </div>`;
  }
  if (auth) auth.innerHTML = '';
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
  document.querySelectorAll('[data-module]').forEach((node) => {
    const moduleName = node.getAttribute('data-module');
    node.classList.toggle('d-none', !canModule(moduleName));
  });
  if (state.session) {
    const initialsEl = document.getElementById('user-initials');
    const nameEl = document.getElementById('user-name');
    const metaEl = document.getElementById('user-meta');
    if (initialsEl) initialsEl.textContent = initials(state.session.displayName);
    if (nameEl) nameEl.textContent = state.session.displayName || state.session.username;
    const roleLabel = state.session.roleId || state.session.workLabel || state.session.role;
    if (metaEl) metaEl.textContent = [roleLabel, state.session.department || state.session.workLabel].filter(Boolean).join(' · ');
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
    ['#/handovers', path === '/handovers'],
    ['#/archive', path === '/archive'],
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
      await refreshBootstrap(true);
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
      await refreshBootstrap(true);
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
      await refreshBootstrap(true);
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
    <td>${escapeHtml(item.department || STAGE_DEPARTMENT[item.stage] || '—')}</td>
    <td>${escapeHtml(item.ownerName || 'Unassigned')}</td>
    <td>${escapeHtml(formatDate(item.startDate))}</td>
    <td>${escapeHtml(formatDate(item.nextFollowUpAt))}</td>
  </tr>`;
}

async function renderToday() {
  if (!requireModule('dashboard')) return;
  const data = await api('getDashboardData');
  const widgets = data.widgets || {};
  const roleId = data.roleId || permissions().roleId || '';
  const cards = [];
  cards.push(statCard('ti-files', widgets.companyFiles ? 'Live files' : 'My files', widgets.companyFiles ? (data.liveCount || 0) : (data.myFilesCount || 0), 'primary'));
  cards.push(statCard('ti-calendar-due', 'Due today', (data.dueToday || []).length, 'warning'));
  cards.push(statCard('ti-alert-circle', 'Overdue', (data.overdue || []).length, 'danger'));
  if (widgets.handovers) cards.push(statCard('ti-transfer', 'Pending handovers', data.pendingHandoverCount || 0, 'info'));
  if (widgets.salesPipeline) {
    cards.push(statCard('ti-mail', 'New enquiries', data.salesNew || 0, 'primary'));
    cards.push(statCard('ti-file-text', 'Quoting', data.salesQuoting || 0, 'primary'));
    cards.push(statCard('ti-phone', 'Follow-up', data.salesFollowUp || 0, 'warning'));
    cards.push(statCard('ti-check', 'Accepted', data.salesAccepted || 0, 'success'));
  }
  if (widgets.reservations) {
    cards.push(statCard('ti-building', 'Reservations in progress', data.resInProgress || 0, 'primary'));
    cards.push(statCard('ti-file-check', 'Supplier completed', data.resSupplierDone || 0, 'success'));
    cards.push(statCard('ti-alert-triangle', 'Missing booking ref', data.missingBookingRef || 0, 'danger'));
  }
  if (widgets.accounts) {
    cards.push(statCard('ti-cash', 'Awaiting payment', data.awaitingPayment || 0, 'warning'));
    cards.push(statCard('ti-coin', 'Paid', data.paidCount || 0, 'success'));
    cards.push(statCard('ti-cash', 'Payments due', (data.paymentsDue || []).length, 'danger'));
  }
  if (widgets.operations) {
    cards.push(statCard('ti-plane', 'Ops in progress', data.opsInProgress || 0, 'primary'));
    cards.push(statCard('ti-calendar-event', 'Upcoming travel', data.upcomingTravel || 0, 'info'));
    cards.push(statCard('ti-flag', 'Completed trips', data.completedTrips || 0, 'success'));
  }
  if (widgets.revenue) cards.push(statCard('ti-cash', 'Est. revenue', (data.estimatedRevenue || 0).toLocaleString(), 'warning'));
  if (widgets.companyFiles) {
    (data.byDepartment || []).forEach((row) => {
      cards.push(statCard('ti-building', row.department, row.count || 0, 'primary'));
    });
  }

  const openFiles = widgets.companyFiles ? (data.live || []) : (data.myFiles || data.live || []);
  document.getElementById('page').innerHTML = `
    <div class="mb-6">
      <h1 class="fs-3 mb-1">Today</h1>
      <p class="text-secondary">${escapeHtml(roleId || 'Staff')} dashboard — what you own, what is waiting, and what is overdue.</p>
    </div>
    <div class="row g-3 mb-4">
      ${cards.join('')}
    </div>
    <div class="row g-3">
      <div class="col-lg-4">
        <div class="card"><div class="card-body">
          <div class="d-flex justify-content-between mb-3"><h2 class="h6 mb-0">Follow-ups due today</h2><a href="#/work">Open work</a></div>
          ${listOrEmpty(data.dueToday, (item) => `<div class="border-bottom py-2"><a href="#/enquiries/${escapeHtml(item.enquiryId)}">${escapeHtml(item.clientName || item.summary)}</a><div class="small text-secondary">${escapeHtml(item.summary || item.nextAction || '')}</div></div>`) || ''}
        </div></div>
      </div>
      <div class="col-lg-4">
        <div class="card"><div class="card-body">
          <div class="d-flex justify-content-between mb-3"><h2 class="h6 mb-0">Overdue</h2></div>
          ${listOrEmpty(data.overdue, (item) => `<div class="border-bottom py-2"><a href="#/enquiries/${escapeHtml(item.enquiryId)}">${escapeHtml(item.clientName || item.summary)}</a><div class="small text-secondary">${escapeHtml(formatDate(item.nextFollowUpAt || item.dueAt))}</div></div>`)}
        </div></div>
      </div>
      <div class="col-lg-4">
        <div class="card"><div class="card-body">
          <div class="d-flex justify-content-between mb-3"><h2 class="h6 mb-0">Pending handovers</h2><a href="#/handovers">All handovers</a></div>
          ${listOrEmpty(data.pendingHandovers, (item) => `<div class="border-bottom py-2"><a href="#/enquiries/${escapeHtml(item.enquiryId)}">${escapeHtml(item.clientName || item.enquiryId)}</a><div class="small text-secondary">${escapeHtml(item.fromDepartment || '—')} → ${escapeHtml(item.toDepartment)} · ${escapeHtml(item.ackStatus || 'Pending')}</div>
            ${item.ackStatus !== 'Acknowledged' ? `<button class="btn btn-sm btn-light mt-1 ack-handover" data-id="${escapeHtml(item.handoverId)}" type="button">Acknowledge</button>` : ''}
          </div>`)}
        </div></div>
      </div>
    </div>
    <div class="card mt-3"><div class="card-body">
      <div class="d-flex justify-content-between mb-3"><h2 class="h6 mb-0">${widgets.companyFiles ? 'Open files' : 'My files'}</h2>${canAction('createEnquiry') ? '<a href="#/enquiries/new" class="btn btn-primary btn-sm">New enquiry</a>' : ''}</div>
      ${openFiles.length
        ? `<div class="table-responsive"><table class="table table-clickable align-middle">
        <thead><tr><th>Guest</th><th>Stage</th><th>Dept</th><th>Owner</th><th>Travel</th><th>Next follow-up</th></tr></thead>
        <tbody>${openFiles.map(enquiryRow).join('')}</tbody>
      </table></div>`
        : emptyState('No files yet', 'Add the guest, then file the enquiry.', canAction('createEnquiry') ? '#/enquiries/new' : '', canAction('createEnquiry') ? 'New enquiry' : '')}
    </div></div>`;
  bindTableLinks();
  document.querySelectorAll('.ack-handover').forEach((button) => {
    button.addEventListener('click', async () => {
      setBusy(button, true, 'Saving…');
      try {
        await api('acknowledgeHandover', { handoverId: button.getAttribute('data-id') });
        notify('Handover acknowledged.', 'success');
        await renderToday();
      } catch (error) {
        setBusy(button, false);
        notify(error.message, 'danger');
      }
    });
  });
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
  if (!requireModule('pipeline')) return;
  const data = await api('listEnquiries', { liveOnly: true });
  const stages = roleStages();
  const groups = {};
  stages.forEach((stage) => { groups[stage] = []; });
  (data.items || []).forEach((item) => {
    if (!groups[item.stage]) groups[item.stage] = [];
    groups[item.stage].push(item);
  });
  document.getElementById('page').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
      <div><h1 class="fs-3 mb-1">Pipeline</h1><p class="text-secondary mb-0">Files in your department stages.</p></div>
      ${canAction('createEnquiry') ? '<a class="btn btn-primary" href="#/enquiries/new">New enquiry</a>' : ''}
    </div>
    ${stages.map((stage) => {
      const rows = groups[stage] || [];
      const dept = STAGE_DEPARTMENT[stage] || '';
      return `
        <section class="pipeline-group">
          <h2>${escapeHtml(stage)} <span>(${rows.length})</span>${dept ? ` <span class="badge text-bg-light">${escapeHtml(dept)}</span>` : ''}</h2>
          ${rows.length
            ? rows.map((item) => `<a class="pipeline-file" href="#/enquiries/${escapeHtml(item.enquiryId)}">${escapeHtml(item.clientName || item.enquiryId)}<div class="small text-secondary">${escapeHtml(item.department || dept || '—')} · ${escapeHtml(item.ownerName || 'Unassigned')} · ${escapeHtml(formatDate(item.nextFollowUpAt))}</div></a>`).join('')
            : '<p class="text-secondary small mb-0">None</p>'}
        </section>`;
    }).join('')}`;
}

async function renderEnquiryList() {
  if (!requireModule('enquiries')) return;
  const data = await api('listEnquiries', {});
  document.getElementById('page').innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-4">
      <div><h1 class="fs-3 mb-1">Enquiries</h1><p class="text-secondary mb-0">Trip files in your scope.</p></div>
      ${canAction('createEnquiry') ? '<a class="btn btn-primary" href="#/enquiries/new">New enquiry</a>' : ''}
    </div>
    ${(data.items || []).length
      ? `<div class="card"><div class="card-body">
      <div class="table-responsive"><table class="table table-clickable align-middle">
        <thead><tr><th>Guest</th><th>Stage</th><th>Dept</th><th>Owner</th><th>Travel</th><th>Next follow-up</th></tr></thead>
        <tbody>${data.items.map(enquiryRow).join('')}</tbody>
      </table></div>
    </div></div>`
      : `<div class="card"><div class="card-body">${emptyState('No enquiries yet', 'Add the guest, then file the enquiry from WhatsApp, email, or the website form.', canAction('createEnquiry') ? '#/enquiries/new' : '', canAction('createEnquiry') ? 'New enquiry' : '')}</div></div>`}`;
  bindTableLinks();
}

function enquiryForm(record, clients) {
  const item = record || {};
  const stage = item.stage || 'New enquiry';
  const dept = item.department || STAGE_DEPARTMENT[stage] || '';
  const terminal = TERMINAL_STAGES.indexOf(stage) !== -1;
  const canEdit = item._canEdit || {
    sales: canAction('editSalesFields') || canAction('createEnquiry'),
    supplier: canAction('editSupplierFields'),
    finance: canAction('editFinanceFields'),
    operations: canAction('editOperationsFields'),
    ownership: isAdmin()
  };
  const access = item._access || permissions().fields || {};
  const salesRo = canEdit.sales ? '' : 'readonly disabled';
  const supplierRo = canEdit.supplier ? '' : 'readonly disabled';
  const opsRo = canEdit.operations ? '' : 'readonly disabled';
  const ownerRo = (canEdit.ownership || isAdmin()) ? '' : 'disabled';
  const budgetHidden = access.budgetAmount === 'none' || access.budgetAmount === 'summary';
  const stageOptions = isAdmin() ? STAGES : [...new Set([...(permissions().stages || []), stage, 'Closed'].filter(Boolean))];
  return `
    <form id="enquiry-form" class="card"><div class="card-body p-4">
      <div class="form-section">
        <h3>Guest and owner</h3>
        <div class="row g-3">
          <div class="col-md-6">
            <label class="form-label">Client</label>
            <select class="form-select" name="clientId" id="enquiry-client" required ${salesRo}>
              <option value="">Select client</option>
              ${optionList((clients || []).map((client) => ({ value: client.clientId, label: client.fullName })), item.clientId)}
            </select>
            ${canEdit.sales ? `<button class="btn btn-link btn-sm px-0" id="toggle-new-guest" type="button">New guest on this page</button>
            <div id="new-guest-wrap" class="border rounded-2 p-3 mt-2 d-none bg-white">
              <div class="mb-2"><label class="form-label">Full name</label><input class="form-control" id="quick-guest-name"></div>
              ${phoneField('quick', { phoneCountry: '255' })}
              <button class="btn btn-light btn-sm mt-2" id="save-quick-guest" type="button">Save guest</button>
            </div>` : ''}
          </div>
          <div class="col-md-3">
            <label class="form-label">Owner</label>
            <select class="form-select" name="ownerId" ${ownerRo}>${staffOptions(item.ownerId)}</select>
          </div>
          <div class="col-md-3">
            <label class="form-label">Stage</label>
            <select class="form-select" name="stage">${optionList(stageOptions, stage)}</select>
          </div>
          <div class="col-md-3">
            <label class="form-label">Department</label>
            <input class="form-control" name="departmentDisplay" value="${escapeHtml(dept)}" readonly>
          </div>
          <div class="col-md-3">
            <label class="form-label">Priority</label>
            <select class="form-select" name="priority" ${ownerRo}>${optionList(PRIORITIES, item.priority || 'Normal')}</select>
          </div>
          <div class="col-md-3">
            <label class="form-label">Status</label>
            <select class="form-select" name="status">${optionList(FILE_STATUSES, item.status || 'Pending')}</select>
          </div>
          <div class="col-md-3">
            <label class="form-label">Booking ref</label>
            <input class="form-control" name="bookingRef" value="${escapeHtml(item.bookingRef || '')}" ${supplierRo}>
          </div>
          <div class="col-md-4">
            <label class="form-label">Source</label>
            <select class="form-select" name="sourceChannel" ${salesRo}>${optionList(CHANNELS, item.sourceChannel || 'WhatsApp')}</select>
          </div>
        </div>
      </div>
      <div class="form-section">
        <h3>Trip</h3>
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label">Travel style</label>
            <select class="form-select" name="travelStyle" ${salesRo}>${styleOptions(item.travelStyle)}</select>
          </div>
          <div class="col-md-4">
            <label class="form-label">Lodge band</label>
            <select class="form-select" name="lodgeBand" ${salesRo}>${optionList(LODGE_BANDS, item.lodgeBand)}</select>
          </div>
          <div class="col-12">
            <label class="form-label d-block">Destinations</label>
            <div class="d-flex flex-wrap">${destinationOptions(item.destinations || [])}</div>
          </div>
          <div class="col-12"><label class="form-label">Itinerary outline</label><textarea class="form-control" name="itineraryOutline" rows="3" ${salesRo}>${escapeHtml(item.itineraryOutline || '')}</textarea></div>
          <div class="col-md-6"><label class="form-label">Activity notes</label><textarea class="form-control" name="activityNotes" rows="2" ${salesRo}>${escapeHtml(item.activityNotes || '')}</textarea></div>
          <div class="col-md-6"><label class="form-label">Special requests</label><textarea class="form-control" name="specialRequests" rows="2" ${salesRo}>${escapeHtml(item.specialRequests || '')}</textarea></div>
          <div class="col-12"><label class="form-label">Supplier notes</label><textarea class="form-control" name="supplierNotes" rows="2" ${supplierRo}>${escapeHtml(item.supplierNotes || '')}</textarea></div>
          <div class="col-md-6"><label class="form-label">Operations issues</label><textarea class="form-control" name="operationsIssue" rows="2" ${opsRo}>${escapeHtml(item.operationsIssue || '')}</textarea></div>
          <div class="col-md-6"><label class="form-label">Trip completion</label><input class="form-control" name="tripCompletionStatus" value="${escapeHtml(item.tripCompletionStatus || '')}" ${opsRo}></div>
        </div>
      </div>
      <div class="form-section">
        <h3>Dates</h3>
        <div class="row g-3">
          <div class="col-md-3">
            <label class="form-label">Travel start</label>
            <input class="form-control" type="date" name="startDate" value="${escapeHtml(formatDate(item.startDate).replace('—', ''))}" ${(canEdit.sales || canEdit.supplier || canEdit.operations) ? '' : 'readonly'}>
          </div>
          <div class="col-md-3">
            <label class="form-label">Travel end</label>
            <input class="form-control" type="date" name="endDate" value="${escapeHtml(formatDate(item.endDate).replace('—', ''))}" ${(canEdit.sales || canEdit.supplier || canEdit.operations) ? '' : 'readonly'}>
          </div>
          <div class="col-md-3">
            <label class="form-label">Flexible month</label>
            <input class="form-control" name="flexibleMonth" placeholder="June 2027" value="${escapeHtml(item.flexibleMonth || '')}" ${salesRo}>
          </div>
          <div class="col-md-3 d-flex align-items-end">
            <div class="form-check mb-2">
              <input class="form-check-input" type="checkbox" name="flexible" ${item.flexible ? 'checked' : ''} ${salesRo ? 'disabled' : ''}>
              <label class="form-check-label">Dates flexible</label>
            </div>
          </div>
          <div class="col-md-2"><label class="form-label">Adults</label><input class="form-control" type="number" min="1" name="adults" value="${escapeHtml(item.adults || 1)}" ${(canEdit.sales || canEdit.supplier) ? '' : 'readonly'}></div>
          <div class="col-md-2"><label class="form-label">Children</label><input class="form-control" type="number" min="0" name="children" value="${escapeHtml(item.children || 0)}" ${(canEdit.sales || canEdit.supplier) ? '' : 'readonly'}></div>
          <div class="col-md-4"><label class="form-label">Child ages</label><input class="form-control" name="childAges" value="${escapeHtml(item.childAges || '')}" ${salesRo}></div>
        </div>
      </div>
      <div class="form-section">
        <h3>Budget</h3>
        <div class="row g-3">
          <div class="col-md-3">
            <label class="form-label">Budget type</label>
            <select class="form-select" name="budgetType" ${salesRo}>${optionList(['unknown', 'band', 'quoted'], item.budgetType || 'unknown')}</select>
          </div>
          <div class="col-md-3"><label class="form-label">Amount</label>
            ${budgetHidden
              ? `<input class="form-control" value="${access.budgetAmount === 'summary' && item.budgetAmountSummary ? 'Set' : '—'}" readonly>`
              : `<input class="form-control" type="number" step="0.01" name="budgetAmount" value="${escapeHtml(item.budgetAmount || '')}" ${salesRo}>`}
          </div>
          <div class="col-md-3">
            <label class="form-label">Currency</label>
            <select class="form-select" name="currency" ${salesRo}>${optionList(['USD', 'TZS'], item.currency || 'USD')}</select>
          </div>
        </div>
      </div>
      <div class="form-section">
        <h3>Next follow-up</h3>
        <div class="row g-3">
          <div class="col-md-4"><label class="form-label">Follow-up date</label><input class="form-control" type="date" name="nextFollowUpAt" value="${escapeHtml(formatDate(item.nextFollowUpAt).replace('—', ''))}"></div>
          <div class="col-md-8"><label class="form-label">Next action</label><input class="form-control" name="nextAction" value="${escapeHtml(item.nextAction || '')}"></div>
          <div class="col-12" id="lost-wrap" style="${terminal ? '' : 'display:none'}">
            <label class="form-label">Close / archive reason</label>
            <input class="form-control" name="lostReason" value="${escapeHtml(item.lostReason || '')}" placeholder="Why this file is closed or archived">
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
  const handovers = detail.handovers || [];
  const enquiry = detail.enquiry || {};
  const dept = enquiry.department || STAGE_DEPARTMENT[enquiry.stage] || '';
  document.getElementById('page').innerHTML = `
    <div class="d-flex justify-content-between align-items-start mb-4">
      <div>
        <h1 class="fs-3 mb-1">${escapeHtml(enquiry.clientName || enquiry.enquiryId)}</h1>
        <p class="text-secondary mb-0">${escapeHtml(enquiry.enquiryId)} · ${escapeHtml(enquiry.stage)}${dept ? ' · ' + escapeHtml(dept) : ''}${enquiry.bookingRef ? ' · ' + escapeHtml(enquiry.bookingRef) : ''}</p>
      </div>
      <div class="d-flex gap-2">
        ${canAction('generateMilestones') || isAdmin() ? `<button class="btn btn-outline-primary btn-sm" id="make-milestones" type="button">Create deposit / balance</button>` : ''}
      </div>
    </div>
    ${enquiryForm(enquiry, clients.items || [])}
    <div class="row g-3 mt-1">
      <div class="col-lg-6">
        <div class="card"><div class="card-body">
          <h2 class="h6">Diary</h2>
          <form id="activity-form" class="activity-composer mb-3">
            <div class="row g-2">
              <div class="col-md-4"><select class="form-select" name="type">${optionList(ACTIVITY_TYPES, 'follow-up')}</select></div>
              <div class="col-md-4"><select class="form-select" name="department">${optionList(DEPARTMENTS, dept || 'Sales')}</select></div>
              <div class="col-12"><input class="form-control" name="summary" placeholder="What was done" required></div>
              <div class="col-md-6"><input class="form-control" name="outcome" placeholder="Outcome"></div>
              <div class="col-md-6"><input class="form-control" name="nextAction" placeholder="Next action"></div>
              <div class="col-md-6"><input class="form-control" type="date" name="dueAt" aria-label="Follow-up date"></div>
              <div class="col-md-6"><button class="btn btn-light w-100" type="submit">Log diary entry</button></div>
            </div>
          </form>
          ${listOrEmpty(detail.activities, (item) => `<div class="border-bottom py-2"><div>${escapeHtml(item.summary)}</div><div class="small text-secondary">${escapeHtml(item.type)}${item.department ? ' · ' + escapeHtml(item.department) : ''} · ${escapeHtml(formatDate(item.dueAt || item.createdAt))}${item.outcome ? ' · ' + escapeHtml(item.outcome) : ''}${item.nextAction ? ' · next: ' + escapeHtml(item.nextAction) : ''}</div></div>`)}
        </div></div>
      </div>
      <div class="col-lg-6">
        <div class="card mb-3"><div class="card-body">
          <h2 class="h6">Payment milestones</h2>
          ${listOrEmpty(payments, (item) => `
            <div class="border rounded-2 p-3 mb-2">
              <div class="d-flex justify-content-between">
                <strong>${escapeHtml(item.kind)}</strong>
                <span class="badge text-bg-light">${escapeHtml(item.status)}</span>
              </div>
              <div>${escapeHtml(item.currency)} ${escapeHtml(item.amount)} · due ${escapeHtml(formatDate(item.dueDate))}</div>
              ${item.note ? `<div class="small text-secondary">${escapeHtml(item.note)}</div>` : ''}
              ${canAction('markPaymentPaid') && item.status === 'due' ? `<button class="btn btn-sm btn-primary mt-2 mark-paid" data-id="${escapeHtml(item.paymentId)}" type="button">Mark received</button>` : ''}
            </div>`)}
          <p class="small text-secondary mb-0">${fieldAccess('payments') === 'full' ? 'Public T&amp;Cs: 50% deposit to book, balance 90 days before departure. Cancel &gt;90 days = 50%, ≤90 days = 100%.' : 'Payment status is summarised for your role. Only Accounts can edit amounts.'}</p>
        </div></div>
        <div class="card"><div class="card-body">
          <h2 class="h6">Handover</h2>
          <form id="handover-form" class="mb-3">
            <div class="row g-2">
              <div class="col-md-6"><label class="form-label">From</label><select class="form-select" name="fromDepartment">${optionList(DEPARTMENTS, dept || 'Sales')}</select></div>
              <div class="col-md-6"><label class="form-label">To</label><select class="form-select" name="toDepartment">${optionList(DEPARTMENTS, 'Reservations')}</select></div>
              <div class="col-md-6"><label class="form-label">Hand to</label><select class="form-select" name="handedTo">${staffOptions(enquiry.ownerId)}</select></div>
              <div class="col-md-6"><label class="form-label">Date</label><input class="form-control" type="date" name="handoverDate" value="${escapeHtml(new Date().toISOString().slice(0, 10))}"></div>
              <div class="col-12"><label class="form-label">Reason</label><input class="form-control" name="reason" required placeholder="Why handing over"></div>
              <div class="col-12"><label class="form-label">Remarks</label><input class="form-control" name="remarks"></div>
              <div class="col-12"><button class="btn btn-light" type="submit">Record handover</button></div>
            </div>
          </form>
          ${listOrEmpty(handovers, (item) => `<div class="border-bottom py-2"><div>${escapeHtml(item.fromDepartment || '—')} → ${escapeHtml(item.toDepartment)}</div><div class="small text-secondary">${escapeHtml(formatDate(item.handoverDate))} · ${escapeHtml(item.reason || '')} · ${escapeHtml(item.ackStatus || 'Pending')}${item.handedToName ? ' · to ' + escapeHtml(item.handedToName) : ''}</div>
            ${item.ackStatus !== 'Acknowledged' ? `<button class="btn btn-sm btn-light mt-1 ack-handover" data-id="${escapeHtml(item.handoverId)}" type="button">Acknowledge</button>` : ''}
          </div>`)}
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
      await api('createActivity', {
        enquiryId: enquiryId,
        type: form.type,
        summary: form.summary,
        department: form.department,
        outcome: form.outcome,
        nextAction: form.nextAction,
        dueAt: form.dueAt
      });
      notify('Diary entry logged.', 'success');
      await renderEnquiryDetail(enquiryId);
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
  const handoverForm = document.getElementById('handover-form');
  if (handoverForm) {
    handoverForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = handoverForm.querySelector('button[type=submit]');
      const form = Object.fromEntries(new FormData(handoverForm).entries());
      setBusy(button, true, 'Saving…');
      try {
        await api('createHandover', Object.assign({ enquiryId: enquiryId }, form));
        notify('Handover recorded.', 'success');
        await renderEnquiryDetail(enquiryId);
      } catch (error) {
        setBusy(button, false);
        notify(error.message, 'danger');
      }
    });
  }
  document.querySelectorAll('.ack-handover').forEach((button) => {
    button.addEventListener('click', async () => {
      setBusy(button, true, 'Saving…');
      try {
        await api('acknowledgeHandover', { handoverId: button.getAttribute('data-id') });
        notify('Handover acknowledged.', 'success');
        await renderEnquiryDetail(enquiryId);
      } catch (error) {
        setBusy(button, false);
        notify(error.message, 'danger');
      }
    });
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
  const deptDisplay = form.querySelector('[name=departmentDisplay]');
  if (stage && lostWrap) {
    stage.addEventListener('change', () => {
      lostWrap.style.display = TERMINAL_STAGES.indexOf(stage.value) !== -1 ? '' : 'none';
      if (deptDisplay) deptDisplay.value = STAGE_DEPARTMENT[stage.value] || '';
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

async function renderClients(editClientId) {
  const data = await api('listClients', {});
  let editing = null;
  if (editClientId) {
    try {
      const detail = await api('getClientDetail', { clientId: editClientId });
      editing = detail.client;
    } catch (error) {
      notify(error.message, 'danger');
    }
  }
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
          <h2 class="h6 mb-3">${editing ? 'Edit client' : 'New client'}</h2>
          ${editing ? `<input type="hidden" name="clientId" value="${escapeHtml(editing.clientId)}">` : ''}
          <div class="mb-3"><label class="form-label">Full name</label><input class="form-control" name="fullName" required value="${escapeHtml((editing && editing.fullName) || '')}"></div>
          <div class="mb-3"><label class="form-label">Email</label><input class="form-control" type="email" name="email" value="${escapeHtml((editing && editing.email) || '')}"></div>
          <div class="mb-3">${phoneField('', editing || { phoneCountry: '255' })}</div>
          <details class="mb-3" ${editing ? 'open' : ''}>
            <summary class="small mb-2">More details</summary>
            <div class="mb-3 mt-2"><label class="form-label">Nationality / residence</label><input class="form-control" name="nationality" value="${escapeHtml((editing && editing.nationality) || '')}"></div>
            <div class="mb-3"><label class="form-label">Party type</label><select class="form-select" name="partyType">${optionList(PARTY_TYPES, (editing && editing.partyType) || 'couple')}</select></div>
            <div class="mb-3"><label class="form-label">Language notes</label><input class="form-control" name="languageNotes" value="${escapeHtml((editing && editing.languageNotes) || '')}"></div>
            <div class="mb-3"><label class="form-label">How they heard of Lamai</label><select class="form-select" name="source">${optionList(['web form', 'email', 'phone/WhatsApp', 'repeat guest', 'referral', 'other'], (editing && editing.source) || 'web form')}</select></div>
          </details>
          <div class="mb-3"><label class="form-label">Notes</label><textarea class="form-control" name="notes" rows="2">${escapeHtml((editing && editing.notes) || '')}</textarea></div>
          <div class="form-sticky-actions d-flex gap-2 flex-wrap">
            <button class="btn btn-primary" type="submit">${editing ? 'Save changes' : 'Save client'}</button>
            ${editing
              ? `<a class="btn btn-light" href="#/clients">Cancel</a><button class="btn btn-light" name="thenEnquiry" value="1" type="submit">Save and file enquiry</button>`
              : `<button class="btn btn-light" name="thenEnquiry" value="1" type="submit">Save and file enquiry</button>`}
          </div>
        </div></form>
      </div>
      <div class="col-lg-7">
        <div class="card"><div class="card-body">
          ${(data.items || []).length
            ? `<div class="table-responsive"><table class="table align-middle">
            <thead><tr><th>Name</th><th>Phone</th><th>Party</th><th></th></tr></thead>
            <tbody>${data.items.map((item) => `<tr>
              <td><a href="#/clients/${escapeHtml(item.clientId)}">${escapeHtml(item.fullName)}</a></td>
              <td>+${escapeHtml(item.phoneCountry || '')} ${escapeHtml(item.phoneNumber || '')}</td>
              <td>${escapeHtml(item.partyType || '')}</td>
              <td class="text-nowrap">
                <a class="btn btn-sm btn-light" href="#/clients/${escapeHtml(item.clientId)}">Edit</a>
                ${isAdmin() ? `<button class="btn btn-sm btn-light delete-client" data-id="${escapeHtml(item.clientId)}" data-name="${escapeHtml(item.fullName)}" type="button">Delete</button>` : ''}
              </td>
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
      const saved = payload.clientId
        ? await api('updateClient', payload)
        : await api('createClient', payload);
      notify(payload.clientId ? 'Client updated.' : 'Client saved.', 'success');
      if (fileEnquiry && saved && saved.clientId) {
        window.sessionStorage.setItem('lamai.newEnquiryClient', saved.clientId);
        go('#/enquiries/new');
        return;
      }
      if (!payload.clientId && state.csvRows && state.csvRows.length) {
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
          <td>${item.status === 'due' && canAction('markPaymentPaid') ? `<button class="btn btn-sm btn-primary mark-paid" data-id="${escapeHtml(item.paymentId)}" type="button">Mark received</button>` : ''}</td>
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

function reportFilterPayload(form) {
  const data = new FormData(form);
  const payload = {
    period: String(data.get('period') || 'daily'),
    date: String(data.get('date') || ''),
    department: String(data.get('department') || ''),
    staffId: String(data.get('staffId') || ''),
    stage: String(data.get('stage') || ''),
    status: String(data.get('status') || '')
  };
  if (!isAdmin()) {
    payload.department = (state.session && state.session.department) || '';
  }
  return payload;
}

function renderReportResult(report) {
  const header = report.header || {};
  const kpis = report.kpis || [];
  const toneMap = { primary: 'primary', warning: 'warning', danger: 'danger', success: 'success', info: 'info' };
  return `
    <div class="card mb-3"><div class="card-body">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div>
          <h2 class="h5 mb-1">${escapeHtml(header.title || 'Report')}</h2>
          <p class="text-secondary mb-0 small">${escapeHtml(header.startDate || '')} → ${escapeHtml(header.endDate || '')}
            · ${escapeHtml(header.department || '')}
            · Ref ${escapeHtml(report.reportRef || '')}
            · ${escapeHtml(header.generatedBy || '')}</p>
        </div>
        <button class="btn btn-outline-primary" id="download-excel" type="button">Download Excel</button>
      </div>
    </div></div>
    <div class="row g-3 mb-4">
      ${kpis.map((kpi) => statCard('ti-chart-bar', kpi.label, typeof kpi.value === 'number' ? kpi.value.toLocaleString() : kpi.value, toneMap[kpi.tone] || 'primary')).join('') || '<div class="col-12 text-secondary">No KPIs for this scope.</div>'}
    </div>
    ${(report.exceptions || []).length ? `<div class="card mb-3"><div class="card-body">
      <h2 class="h6">Exceptions</h2>
      <div class="table-responsive"><table class="table align-middle">
        <thead><tr><th>Kind</th><th>Guest</th><th>Summary</th></tr></thead>
        <tbody>${report.exceptions.map((row) => `<tr>
          <td>${escapeHtml(row.kind)}</td>
          <td><a href="#/enquiries/${escapeHtml(row.enquiryId)}">${escapeHtml(row.clientName || row.enquiryId)}</a></td>
          <td>${escapeHtml(row.summary || '')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div></div>` : ''}
    <div class="row g-3 mb-3">
      <div class="col-lg-4"><div class="card"><div class="card-body">
        <h2 class="h6">By stage</h2>
        <div class="table-responsive"><table class="table">
          <thead><tr><th>Stage</th><th>Count</th></tr></thead>
          <tbody>${(report.byStage || []).map((row) => `<tr><td>${escapeHtml(row.stage)}</td><td>${escapeHtml(row.count)}</td></tr>`).join('') || '<tr><td colspan="2" class="text-secondary">None</td></tr>'}</tbody>
        </table></div>
      </div></div></div>
      <div class="col-lg-8"><div class="card"><div class="card-body">
        <h2 class="h6 mb-3">Files (${escapeHtml(report.recordTotal || (report.records || []).length)})</h2>
        ${(report.records || []).length
          ? `<div class="table-responsive"><table class="table table-clickable align-middle">
            <thead><tr><th>Guest</th><th>Stage</th><th>Dept</th><th>Owner</th><th>Travel</th><th>Follow-up</th></tr></thead>
            <tbody>${(report.records || []).map(enquiryRow).join('')}</tbody>
          </table></div>`
          : '<p class="text-secondary mb-0">No files in this period.</p>'}
      </div></div></div>
    </div>
    <div class="row g-3">
      <div class="col-lg-6"><div class="card"><div class="card-body">
        <h2 class="h6">Handovers</h2>
        ${listOrEmpty(report.handovers, (item) => `<div class="border-bottom py-2">
          <a href="#/enquiries/${escapeHtml(item.enquiryId)}">${escapeHtml(item.clientName || item.enquiryId)}</a>
          <div class="small text-secondary">${escapeHtml(item.fromDepartment || '—')} → ${escapeHtml(item.toDepartment)} · ${escapeHtml(formatDate(item.handoverDate))} · ${escapeHtml(item.ackStatus || '')}</div>
        </div>`)}
      </div></div></div>
      <div class="col-lg-6"><div class="card"><div class="card-body">
        <h2 class="h6">Diary</h2>
        ${listOrEmpty(report.activities, (item) => `<div class="border-bottom py-2">
          <div class="small text-secondary">${escapeHtml(item.type || '')} · ${escapeHtml(item.enquiryId)} · ${escapeHtml(formatDate(item.createdAt))}</div>
          <div>${escapeHtml(item.summary || '')}</div>
        </div>`)}
      </div></div></div>
    </div>`;
}

async function renderReports() {
  const today = (state.bootstrap && state.bootstrap.today) || new Date().toISOString().slice(0, 10);
  const roleId = permissions().roleId || '';
  const lockedDept = (state.session && state.session.department) || '';
  const staff = ((state.bootstrap && state.bootstrap.staff) || []).filter((person) => {
    if (isAdmin()) return true;
    return person.department === lockedDept;
  });
  const stages = ['', ...roleStages(), 'Closed', 'Archived'];

  document.getElementById('page').innerHTML = `
    <div class="mb-4">
      <h1 class="fs-3 mb-1">Reports</h1>
      <p class="text-secondary mb-0">Daily, weekly, and monthly department reports. Export matches what you see on screen.</p>
    </div>
    <form id="report-filters" class="card mb-3"><div class="card-body">
      <div class="row g-3 align-items-end">
        <div class="col-md-3">
          <label class="form-label">Period</label>
          <select class="form-select" name="period">
            <option value="daily" selected>Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label">Date</label>
          <input class="form-control" type="date" name="date" value="${escapeHtml(today)}" required>
        </div>
        <div class="col-md-3">
          <label class="form-label">Department</label>
          ${isAdmin()
            ? `<select class="form-select" name="department">
                <option value="ALL">All departments</option>
                ${DEPARTMENTS.map((dept) => `<option value="${escapeHtml(dept)}">${escapeHtml(dept)}</option>`).join('')}
              </select>`
            : `<input class="form-control" name="department" value="${escapeHtml(lockedDept)}" readonly>
               <div class="form-text">Locked to your department (${escapeHtml(roleId)}).</div>`}
        </div>
        <div class="col-md-3">
          <label class="form-label">Staff</label>
          <select class="form-select" name="staffId">
            <option value="">All staff</option>
            ${staff.map((person) => `<option value="${escapeHtml(person.userId)}">${escapeHtml(person.displayName)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label">Stage</label>
          <select class="form-select" name="stage">
            ${stages.map((stage) => `<option value="${escapeHtml(stage)}">${escapeHtml(stage || 'Any stage')}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label">File status</label>
          <select class="form-select" name="status">
            <option value="">Any status</option>
            ${FILE_STATUSES.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-6 d-flex gap-2 justify-content-md-end">
          <button class="btn btn-primary" type="submit" id="generate-report">Generate</button>
        </div>
      </div>
    </div></form>
    <div id="report-result"><div class="text-secondary">Choose a period and generate a report.</div></div>`;

  const form = document.getElementById('report-filters');
  let lastPayload = null;

  const runExport = async (button) => {
    if (!lastPayload) {
      notify('Generate a report first.', 'warning');
      return;
    }
    setBusy(button, true, 'Preparing…');
    try {
      const file = await api('exportReportCsv', lastPayload);
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
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('generate-report');
    const payload = reportFilterPayload(form);
    setBusy(button, true, 'Generating…');
    try {
      const report = await api('generateDepartmentReport', payload);
      lastPayload = payload;
      document.getElementById('report-result').innerHTML = renderReportResult(report);
      bindTableLinks();
      const download = document.getElementById('download-excel');
      if (download) {
        download.addEventListener('click', () => runExport(download));
      }
      setBusy(button, false);
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
}

async function renderSettings() {
  const data = await api('getAdminData', {});
  const settings = data.settings || {};
  document.getElementById('page').innerHTML = `
    <div class="mb-4"><h1 class="fs-3 mb-1">Settings</h1><p class="text-secondary">Company profile, staff accounts, and trip reference lists.</p></div>
    <form id="company-form" class="card mb-3"><div class="card-body p-4">
      <h2 class="h6 mb-3">Company profile</h2>
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label">Legal name</label><input class="form-control" name="legalName" value="${escapeHtml(settings.legalName || '')}"></div>
        <div class="col-md-6"><label class="form-label">Email</label><input class="form-control" name="email" value="${escapeHtml(settings.email || '')}"></div>
        <div class="col-md-6"><label class="form-label">Phone</label><input class="form-control" name="phone" value="${escapeHtml(settings.phone || '')}"></div>
        <div class="col-md-6"><label class="form-label">TIN</label><input class="form-control" name="tin" value="${escapeHtml(settings.tin || '')}"></div>
        <div class="col-12"><label class="form-label">Office</label><input class="form-control" name="office" value="${escapeHtml(settings.office || '')}"></div>
        <div class="col-md-6"><label class="form-label">Postal</label><input class="form-control" name="postal" value="${escapeHtml(settings.postal || '')}"></div>
        <div class="col-md-6"><label class="form-label">Timezone</label><input class="form-control" name="timezone" value="${escapeHtml(settings.timezone || 'Africa/Dar_es_Salaam')}"></div>
      </div>
      <button class="btn btn-primary mt-3" type="submit">Save company profile</button>
    </div></form>
    <form id="staff-form" class="card mb-3"><div class="card-body p-4">
      <h2 class="h6 mb-3">Add staff</h2>
      <div class="mb-3"><label class="form-label">Name</label><input class="form-control" name="displayName" required></div>
      <div class="mb-3"><label class="form-label">Department role</label><select class="form-select" name="workLabel">${optionList(WORK_LABELS, 'Sales')}</select>
        <div class="form-text">Sets Sales, Reservations, Accounts, Operations, or Guide permissions.</div></div>
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
        <div class="mb-3"><label class="form-label">Department role</label><select class="form-select" name="workLabel">${optionList(WORK_LABELS, 'Sales')}</select></div>
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
  document.getElementById('company-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]');
    const settingsPayload = Object.fromEntries(new FormData(event.target).entries());
    setBusy(button, true, 'Saving…');
    try {
      await api('updateSettings', { settings: settingsPayload });
      setBusy(button, false);
      notify('Company profile saved.', 'success');
    } catch (error) {
      setBusy(button, false);
      notify(error.message, 'danger');
    }
  });
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
  return kind + ':' + (item.enquiryId || item.paymentId || item.handoverId || '');
}

function seenNoticeIds() {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(SEEN_KEY) || '[]'));
  } catch (error) {
    return new Set();
  }
}

function flattenNotices() {
  const notices = state.notices || { dueToday: [], overdue: [], unpaid: [], pendingHandovers: [], missingConfirmations: [] };
  return []
    .concat((notices.overdue || []).map((item) => Object.assign({}, item, { kind: 'overdue', label: 'Overdue' })))
    .concat((notices.dueToday || []).map((item) => Object.assign({}, item, { kind: 'due', label: 'Due today' })))
    .concat((notices.unpaid || []).map((item) => Object.assign({}, item, { kind: 'pay', label: 'Payment due' })))
    .concat((notices.pendingHandovers || []).map((item) => Object.assign({}, item, { kind: 'handover', label: 'Handover' })))
    .concat((notices.missingConfirmations || []).map((item) => Object.assign({}, item, { kind: 'supplier', label: 'Missing confirmation' })));
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
      }, 300);
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

async function refreshBootstrap(force) {
  state.bootstrap = await api('getBootstrap', force ? { forceSchema: true } : {});
  state.session = state.bootstrap.session || state.session;
  state.bootstrapToken = window.localStorage.getItem('lamai.token') || '';
  if (state.bootstrap.dueCount != null) setChrome(!!state.session);
  return state.bootstrap;
}

async function ensureBootstrap(force) {
  const token = window.localStorage.getItem('lamai.token') || '';
  if (!force && state.bootstrap && state.bootstrapToken === token && state.bootstrap.session) {
    state.session = state.bootstrap.session;
    return state.bootstrap;
  }
  return refreshBootstrap(force);
}

function requireAdmin() {
  if (!isAdmin()) {
    denyPage('Only Admin can open this page.');
    return false;
  }
  return true;
}

async function renderHandovers() {
  if (!requireModule('handovers')) return;
  const data = await api('listHandovers', { pendingOnly: false });
  document.getElementById('page').innerHTML = `
    <div class="mb-4"><h1 class="fs-3 mb-1">Handovers</h1><p class="text-secondary">Incoming and outgoing department handovers.</p></div>
    <div class="card"><div class="card-body">
      ${listOrEmpty(data.items, (item) => `<div class="border-bottom py-3 d-flex justify-content-between align-items-start gap-3 flex-wrap">
        <div>
          <a href="#/enquiries/${escapeHtml(item.enquiryId)}">${escapeHtml(item.clientName || item.enquiryId)}</a>
          <div class="small text-secondary">${escapeHtml(item.fromDepartment || '—')} → ${escapeHtml(item.toDepartment)} · ${escapeHtml(formatDate(item.handoverDate))} · ${escapeHtml(item.ackStatus || 'Pending')}</div>
          <div class="small">${escapeHtml(item.reason || '')}${item.handedToName ? ' · to ' + escapeHtml(item.handedToName) : ''}</div>
        </div>
        ${item.ackStatus !== 'Acknowledged' ? `<button class="btn btn-sm btn-primary ack-handover" data-id="${escapeHtml(item.handoverId)}" type="button">Acknowledge</button>` : ''}
      </div>`)}
    </div></div>`;
  document.querySelectorAll('.ack-handover').forEach((button) => {
    button.addEventListener('click', async () => {
      setBusy(button, true, 'Saving…');
      try {
        await api('acknowledgeHandover', { handoverId: button.getAttribute('data-id') });
        notify('Handover acknowledged.', 'success');
        await renderHandovers();
      } catch (error) {
        setBusy(button, false);
        notify(error.message, 'danger');
      }
    });
  });
}

async function renderArchive() {
  if (!requireModule('archive')) return;
  const data = await api('listArchivedEnquiries', {});
  document.getElementById('page').innerHTML = `
    <div class="mb-4"><h1 class="fs-3 mb-1">Archive</h1><p class="text-secondary">Closed and archived files remain searchable.</p></div>
    ${(data.items || []).length
      ? `<div class="card"><div class="card-body">
      <div class="table-responsive"><table class="table table-clickable align-middle">
        <thead><tr><th>Guest</th><th>Stage</th><th>Dept</th><th>Owner</th><th>Travel</th><th>Reason</th></tr></thead>
        <tbody>${(data.items || []).map((item) => `<tr data-href="#/enquiries/${escapeHtml(item.enquiryId)}">
          <td>${escapeHtml(item.clientName || item.enquiryId)}</td>
          <td>${escapeHtml(item.stage)}</td>
          <td>${escapeHtml(item.department || '—')}</td>
          <td>${escapeHtml(item.ownerName || '—')}</td>
          <td>${escapeHtml(formatDate(item.startDate))}</td>
          <td>${escapeHtml(item.lostReason || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div></div>`
      : '<div class="card"><div class="card-body"><p class="text-secondary mb-0">No closed or archived files in your scope.</p></div></div>'}`;
  bindTableLinks();
}

async function route() {
  const seq = (route.seq = (route.seq || 0) + 1);
  showAlert('');
  const info = parseHash();
  if (info.path === '/sign-out') {
    showSigningOut();
    try { await api('logout', {}); } catch (error) { /* ignore */ }
    clearToken();
    state.session = null;
    state.bootstrap = null;
    state.bootstrapToken = '';
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    if (seq !== route.seq) return;
    go('#/sign-in');
    return;
  }

  const hasToken = !!window.localStorage.getItem('lamai.token');
  if (hasToken) {
    setChrome(true);
    if (!state.bootstrap || !state.bootstrap.session) showPageLoading();
  }

  try {
    await ensureBootstrap(false);
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
    else if (info.path === '/enquiries/new') {
      if (!canAction('createEnquiry')) denyPage('Only Sales or Admin can create a new enquiry.');
      else await renderEnquiryNew();
    } else if (info.parts[0] === 'enquiries' && info.parts[1]) await renderEnquiryDetail(info.parts[1]);
    else if (info.path === '/enquiries') await renderEnquiryList();
    else if (info.parts[0] === 'clients' && info.parts[1]) await renderClients(info.parts[1]);
    else if (info.path === '/clients') await renderClients();
    else if (info.path === '/work') await renderWork();
    else if (info.path === '/handovers') await renderHandovers();
    else if (info.path === '/archive') await renderArchive();
    else if (info.path === '/payments') {
      if (requireModule('payments', 'Only Accounts or Admin can open payments.')) await renderPayments();
    } else if (info.path === '/reports') {
      if (requireModule('reports')) await renderReports();
    } else if (info.path === '/settings') {
      if (requireModule('settings', 'Only Admin can open Settings.')) await renderSettings();
    } else {
      document.getElementById('page').innerHTML = '<div class="alert alert-light">Page not found.</div>';
    }
  } catch (error) {
    if (seq !== route.seq) return;
    if (error.code === 'UNAUTHENTICATED') {
      clearToken();
      state.bootstrap = null;
      state.bootstrapToken = '';
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
