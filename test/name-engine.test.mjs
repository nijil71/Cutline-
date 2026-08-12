import test from 'node:test';
import assert from 'node:assert/strict';

import { slug, joinSlug, dateFolder, timestampSlug } from '../src/naming/slug.js';
import { stripTitleNoise, pickSegment, subjectWords } from '../src/naming/title-clean.js';
import {
  findTicket, findPrice, findError, findHttpStatus, normalizePrice,
} from '../src/naming/extractors.js';
import {
  buildName, scopeFromUrl, isPrivate, folderFor, productFromJsonLd,
  sanitizeFolderSegment, sanitizeFileBase,
} from '../src/naming/name-engine.js';
import { DEFAULTS } from '../src/config/defaults.js';

const NOW = new Date(2026, 7, 12, 1, 4, 51); // 2026-08-12 01:04:51 local

/* -------------------------------------------------------------------- slug */

test('slug: basic normalisation', () => {
  assert.equal(slug('Hello, World!'), 'hello-world');
  assert.equal(slug('  --Trim--  '), 'trim');
  assert.equal(slug('Café Münster'), 'cafe-munster');
  assert.equal(slug('R&D + AI'), 'r-and-d-plus-ai');
});

test('slug: preserves case when asked (issue keys)', () => {
  assert.equal(slug('Q-413488', { lower: false }), 'Q-413488');
});

test('slug: escapes Windows reserved device names', () => {
  assert.equal(slug('CON'), '_con');
  assert.equal(slug('lpt1'), '_lpt1');
  assert.equal(slug('console'), 'console'); // not reserved
});

test('slug: truncates at a word boundary', () => {
  const out = slug('one two three four five six seven eight', { maxLen: 20 });
  assert.ok(out.length <= 20);
  assert.ok(!out.endsWith('-'));
  assert.equal(out, 'one-two-three-four');
});

test('joinSlug: drops repeated tokens', () => {
  assert.equal(joinSlug(['jira', 'jira-Q-413488']), 'jira-Q-413488');
  assert.equal(joinSlug(['amazon', '', 'amazon-echo', 'dot']), 'amazon-echo-dot');
});

test('dateFolder / timestampSlug', () => {
  assert.equal(dateFolder('YYYY-MM', NOW), '2026-08');
  assert.equal(dateFolder('YYYY-MM-DD', NOW), '2026-08-12');
  assert.equal(dateFolder('YYYY/MM', NOW), '2026/08');
  assert.equal(timestampSlug(NOW), '2026-08-12-010451');
});

/* ------------------------------------------------------------- title-clean */

test('stripTitleNoise: browser suffixes and unread counters', () => {
  assert.equal(stripTitleNoise('Inbox (24) - Gmail - Google Chrome'), 'Inbox (24) - Gmail');
  assert.equal(stripTitleNoise('(3) Slack | general'), 'Slack | general');
  assert.equal(
    stripTitleNoise('Payment timeout and 4 more pages - Personal - Microsoft​ Edge'),
    'Payment timeout',
  );
  assert.equal(stripTitleNoise('app.tsx - Visual Studio Code'), 'app.tsx');
});

test('pickSegment: prefers the first meaningful segment, not the longest', () => {
  // Longest-segment logic would wrongly return "Mendix Documentation".
  assert.equal(pickSegment('Getting started | Mendix Documentation', 'mendix'), 'Getting started');
  // First segment is a generic site word, so we fall through to the next.
  assert.equal(pickSegment('Dashboard | Acme Corp', 'acme'), 'Acme Corp');
  // When every segment is junk there is nothing to rescue; downstream treats
  // the resulting one-word subject as low confidence.
  assert.equal(pickSegment('Home | Acme', 'acme'), 'Home');
});

test('subjectWords: strips SEO filler', () => {
  const words = subjectWords(
    'Buy Lenovo Legion 5i Gen 9 Gaming Laptop Online at Low Prices in India : Amazon.in',
    { scope: 'amazon', maxWords: 4 },
  );
  assert.deepEqual(words, ['Lenovo', 'Legion', '5i', 'Gen']);
});

test('subjectWords: falls back rather than returning nothing', () => {
  // Every word is filler; we must not return an empty subject.
  const words = subjectWords('The Best Deals', { scope: 'x', maxWords: 5 });
  assert.deepEqual(words, ['The', 'Best', 'Deals']);
});

/* -------------------------------------------------------------- extractors */

test('findTicket: trusted sources accept a bare match', () => {
  assert.equal(findTicket('Some text Q-413488 here', { trusted: true }), 'Q-413488');
});

test('findTicket: untrusted matches must be corroborated by the title', () => {
  assert.equal(findTicket('body mentions ABC-123', { title: 'unrelated' }), null);
  assert.equal(findTicket('body mentions ABC-123', { title: 'Bug ABC-123 open' }), 'ABC-123');
});

test('findTicket: rejects lookalikes', () => {
  assert.equal(findTicket('encoded as UTF-8 always', { trusted: true }), null);
  assert.equal(findTicket('RTX-4060 laptop GPU', { trusted: true }), null);
  assert.equal(findTicket('see RFC-2616 section 4', { trusted: true }), null);
});

test('findPrice + normalizePrice', () => {
  assert.equal(findPrice('Deal price: ₹79,999 only'), '79999');
  assert.equal(findPrice('$1,299.00 today'), '1299');
  assert.equal(findPrice('costs £45.50'), '45-50');
  assert.equal(findPrice('no prices here'), null);
  assert.equal(normalizePrice('12,345.00'), '12345');
});

test('findError: distinctive package segment plus camel-split class', () => {
  assert.deepEqual(
    findError('at org.bouncycastle.crypto.InvalidCipherTextException: bad padding'),
    ['bouncycastle', 'invalid', 'cipher', 'text'],
  );
  assert.deepEqual(
    findError('System.NullReferenceException was unhandled'),
    ['null', 'reference'],
  );
  assert.equal(findError('everything is fine'), null);
});

test('findHttpStatus', () => {
  assert.equal(findHttpStatus('404 Not Found'), '404');
  assert.equal(findHttpStatus('HTTP 500 Internal Server Error'), '500');
  assert.equal(findHttpStatus('costs 500 dollars'), null);
});

/* ------------------------------------------------------------------- scope */

test('scopeFromUrl: reduces host to its identifying label', () => {
  assert.equal(scopeFromUrl('https://www.amazon.in/dp/B0XYZ'), 'amazon');
  assert.equal(scopeFromUrl('https://docs.mendix.com/refguide/'), 'mendix');
  assert.equal(scopeFromUrl('https://sub.company.co.uk/x'), 'company');
  assert.equal(scopeFromUrl('https://linear.app/team/issue/ENG-42'), 'linear');
  assert.equal(scopeFromUrl('https://acme.atlassian.net/browse/Q-1'), 'jira');
  assert.equal(scopeFromUrl('http://localhost:3000/'), 'local');
});

/* ----------------------------------------------------------------- privacy */

test('isPrivate: host globs and path fragments', () => {
  assert.equal(isPrivate('https://hdfcbank.com/x', DEFAULTS.privateHosts), true);
  assert.equal(isPrivate('https://acme.com/login', DEFAULTS.privateHosts), true);
  assert.equal(isPrivate('https://acme.com/dashboard', DEFAULTS.privateHosts), false);
});

test('buildName: private context yields a bare timestamp', () => {
  const out = buildName(
    { url: 'https://mybank.com/accounts', title: 'Balance ₹4,20,000 — Savings' },
    DEFAULTS, NOW,
  );
  assert.equal(out.redacted, true);
  assert.equal(out.base, 'screenshot-2026-08-12-010451');
  assert.ok(!out.base.includes('420000'));
});

test('buildName: incognito is always redacted', () => {
  const out = buildName(
    { url: 'https://example.com/a', title: 'Something Interesting Here', incognito: true },
    DEFAULTS, NOW,
  );
  assert.equal(out.redacted, true);
});

/* ----------------------------------------------------------------- folders */

test('sanitizeFolderSegment: keeps hyphens, blocks traversal', () => {
  assert.equal(sanitizeFolderSegment('2026-08'), '2026-08');
  assert.equal(sanitizeFolderSegment('..'), '');
  assert.equal(sanitizeFolderSegment('My Work'), 'My Work');
  assert.equal(sanitizeFolderSegment('bad:name?'), 'badname');
});

test('sanitizeFileBase: hand-edited names cannot escape the folder', () => {
  assert.equal(sanitizeFileBase('../../etc/passwd'), 'etc-passwd');
  assert.equal(sanitizeFileBase('a/b\\c'), 'a-b-c');
  assert.equal(sanitizeFileBase('name:with?bad|chars'), 'namewithbadchars');
  assert.equal(sanitizeFileBase('  spaced out  '), 'spaced out');
  assert.ok(sanitizeFileBase('').startsWith('screenshot-'));
  assert.ok(sanitizeFileBase('...').startsWith('screenshot-'));
});

test('folderFor: base + rule + date', () => {
  const settings = {
    ...DEFAULTS,
    folderRules: [{ pattern: '*.atlassian.net', folder: 'Work' }],
  };
  assert.equal(
    folderFor('https://acme.atlassian.net/browse/Q-1', settings, NOW),
    'Screenshots/Work/2026-08',
  );
  assert.equal(folderFor('https://example.com/', settings, NOW), 'Screenshots/2026-08');
});

/* -------------------------------------------------------------- schema.org */

test('productFromJsonLd: reads name and price, including @graph', () => {
  const nodes = [{
    '@graph': [
      { '@type': 'BreadcrumbList' },
      { '@type': 'Product', name: 'Lenovo Legion 5i', offers: { '@type': 'Offer', price: '79999' } },
    ],
  }];
  assert.deepEqual(productFromJsonLd(nodes), { name: 'Lenovo Legion 5i', price: '79999' });
  assert.equal(productFromJsonLd([{ '@type': 'Article' }]), null);
});

/* -------------------------------------------------- end-to-end name building */

test('buildName: Amazon product page', () => {
  const out = buildName({
    url: 'https://www.amazon.in/dp/B0D1234',
    title: 'Buy Lenovo Legion 5i Gen 9 Gaming Laptop Online at Low Prices in India : Amazon.in',
    jsonld: [{ '@type': 'Product', name: 'Lenovo Legion 5i Gen 9', offers: { price: '79999' } }],
  }, DEFAULTS, NOW);

  assert.equal(out.base, 'amazon-lenovo-legion-5i-gen-9-79999');
  assert.equal(out.confidence, 'high');
  assert.equal(out.folder, 'Screenshots/2026-08');
});

test('buildName: Jira issue keeps the key uppercase', () => {
  const out = buildName({
    url: 'https://acme.atlassian.net/browse/Q-413488',
    title: '[Q-413488] Payment gateway timeout on checkout - Jira',
    adapter: { scope: 'jira', ticket: 'Q-413488', trustedTicket: true },
  }, DEFAULTS, NOW);

  // Key uppercase, subject lowercase, and the key is not re-spent as subject words.
  assert.equal(out.base, 'jira-Q-413488-payment-gateway-timeout');
  assert.equal(out.confidence, 'high');
});

test('buildName: exception in the selection wins over the title', () => {
  const out = buildName({
    url: 'https://myapp.mendixcloud.com/p/error',
    title: 'MyApp',
    selection: 'Caused by: org.bouncycastle.crypto.InvalidCipherTextException: pad block corrupted',
  }, DEFAULTS, NOW);

  assert.equal(out.base, 'mendix-bouncycastle-invalid-cipher-text-error');
  assert.equal(out.confidence, 'high');
});

test('buildName: a price on a non-commerce page is ignored', () => {
  const out = buildName({
    url: 'https://blog.example.com/post',
    title: 'Why we moved off Kubernetes',
    text: 'It was costing us $12,000 a month.',
  }, DEFAULTS, NOW);

  assert.ok(!out.base.includes('12000'), `unexpected price in ${out.base}`);
  assert.equal(out.base, 'example-why-we-moved-kubernetes'); // "off" is filler
});

test('buildName: thin title falls back to a timestamp rather than guessing', () => {
  const out = buildName({ url: 'https://example.com/', title: 'Home' }, DEFAULTS, NOW);
  assert.equal(out.base, 'example-2026-08-12-010451');
  assert.equal(out.confidence, 'low');
});

test('buildName: never emits an empty or single-token name', () => {
  const cases = [
    { url: 'https://example.com/', title: '' },
    { url: '', title: '' },
    { url: 'https://a.com/', title: '   ' },
  ];
  for (const ctx of cases) {
    const out = buildName(ctx, DEFAULTS, NOW);
    assert.ok(out.base.split('-').filter(Boolean).length >= 2, `too thin: ${out.base}`);
  }
});

test('buildName: respects maxNameLength', () => {
  const out = buildName({
    url: 'https://example.com/',
    title: 'An extremely long page title that keeps going and going and going and going forever',
  }, { ...DEFAULTS, maxNameLength: 40, maxWords: 12 }, NOW);
  assert.ok(out.base.length <= 40, `too long (${out.base.length}): ${out.base}`);
});
