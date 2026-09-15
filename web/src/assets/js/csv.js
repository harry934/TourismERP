import { COUNTRY_CODES } from './country-codes.js';

const HEADER_MAP = {
  fullname: 'fullName',
  name: 'fullName',
  yourname: 'fullName',
  guest: 'fullName',
  guestname: 'fullName',
  client: 'fullName',
  email: 'email',
  mail: 'email',
  phone: 'phone',
  phonenumber: 'phone',
  whatsapp: 'phone',
  mobile: 'phone',
  telephone: 'phone',
  tel: 'phone',
  nationality: 'nationality',
  country: 'nationality',
  residence: 'nationality',
  notes: 'notes',
  message: 'notes',
  comment: 'notes',
  comments: 'notes',
  enquiry: 'notes',
  partytype: 'partyType',
  party: 'partyType',
  source: 'source',
  languagenotes: 'languageNotes',
  language: 'languageNotes'
};

function normalizeHeader(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => String(value).trim()));
}

function splitPhone(raw) {
  const text = String(raw || '').trim();
  if (!text) return { phoneCountry: '255', phoneNumber: '' };
  const digits = text.replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  const ranked = COUNTRY_CODES.slice().sort((a, b) => b.dial.length - a.dial.length);
  for (let i = 0; i < ranked.length; i += 1) {
    const dial = ranked[i].dial;
    if (digits.indexOf(dial) === 0 && digits.length > dial.length) {
      return { phoneCountry: dial, phoneNumber: digits.slice(dial.length) };
    }
  }
  return { phoneCountry: '255', phoneNumber: digits.replace(/^0/, '') };
}

export function mapClientCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const keys = rows[0].map((header) => HEADER_MAP[normalizeHeader(header)] || '');
  return rows.slice(1, 401).map((row) => {
    const record = {
      fullName: '',
      email: '',
      phoneCountry: '255',
      phoneNumber: '',
      nationality: '',
      partyType: 'couple',
      languageNotes: '',
      source: 'web form',
      notes: ''
    };
    const extras = [];
    row.forEach((value, index) => {
      const field = keys[index];
      const trimmed = String(value || '').trim();
      if (!trimmed) return;
      if (!field) {
        extras.push(trimmed);
        return;
      }
      if (field === 'phone') {
        const split = splitPhone(trimmed);
        record.phoneCountry = split.phoneCountry;
        record.phoneNumber = split.phoneNumber;
        return;
      }
      record[field] = trimmed;
    });
    if (extras.length) {
      record.notes = [record.notes, extras.join(' · ')].filter(Boolean).join('\n');
    }
    return record;
  }).filter((record) => record.fullName);
}

export const SAMPLE_CLIENT_CSV = 'fullName,email,phone,nationality,partyType,notes\nJane Guest,jane@example.com,+255768506258,United Kingdom,couple,Found us on the website\n';
