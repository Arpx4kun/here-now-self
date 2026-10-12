const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'city-clocks.js'), 'utf8');
const nodes = {};
function get(id) {
  return nodes[id] ||= { value: '', textContent: '', handlers: {}, children: [],
    addEventListener(name, fn) { this.handlers[name] = fn; },
    setAttribute() {}, appendChild(node) { this.children.push(node); } };
}
let monotonic = 0;
let machine = Date.parse('2000-01-01T00:00:00Z');
let testing = false;
let fail = false;
let changes = [];
const saved = {};
const urls = [];
const data = zone => ({ timeZone: zone, currentLocalTime: zone === 'Asia/Shanghai' ? '2026-10-13T08:00:00.1234567' : '2026-10-13T13:00:00.1234567',
  currentUtcOffset: { seconds: zone === 'Asia/Shanghai' ? 28800 : 46800 } });
class WrongDate extends Date { static now() { return machine; } }
const ctx = vm.createContext({ Intl, Date: WrongDate, performance: { now: () => monotonic }, AbortController,
  setTimeout, clearTimeout, setInterval() {},
  localStorage: { getItem: k => saved[k] || null, setItem: (k, v) => saved[k] = v },
  document: { getElementById: get, createElement: () => get(`item-${Math.random()}`), addEventListener() {} },
  window: { addEventListener() {} },
  fetch: async url => {
    urls.push(url);
    if (fail) throw new Error('offline');
    let body;
    if (url.includes('/timezone/')) body = data(decodeURIComponent(url.split('=')[1]));
    else if (url.includes('/get?')) body = { id: 1, name: '纽约' };
    else body = { results: [
      { id: 2, name: 'New York Airport', country_code: 'US', timezone: 'America/New_York', feature_code: 'AIRP', population: 99999999 },
      { id: 1, name: 'New York', country_code: 'US', timezone: 'America/New_York', feature_code: 'PPLA', admin1: 'New York', population: 8000000 }
    ] };
    return { ok: true, json: async () => body };
  }
});
vm.runInContext(source, ctx);
const run = code => vm.runInContext(code, ctx);
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  ctx.changed = left => changes.push(left);
  ctx.testing = () => testing;
  run('CityClocks.init({onChange: changed, isTesting: testing})');
  await flush();
  const expected = Date.parse('2026-10-13T00:00:00.123Z');
  assert.equal(run('CityClocks.utcNow()'), expected);
  monotonic += 3000; machine += 86400000;
  assert.equal(run('CityClocks.utcNow()'), expected + 3000, 'network clock ignores system clock changes');
  assert.equal(run('CityClocks.offsetText(20700)'), 'UTC+05:45');
  assert.equal(run('CityClocks.offsetText(-12600)'), 'UTC−03:30');
  assert.equal(run("CityClocks.currentName(0, new Date('2026-10-13T00:00:00Z'))"), '新西兰夏令时间');
  assert.throws(() => run("CityClocks.parseNetwork({currentLocalTime:'bad',currentUtcOffset:{seconds:0}})"));
  get('city-country-0').value = 'us'; get('city-query-0').value = 'New York';
  await get('city-search-0').handlers.click(); await flush();
  assert(urls.some(url => url.includes('countryCode=US')));
  assert.match(get('city-results-0').children[0].textContent, /^New York ·/);
  await get('city-results-0').children[0].handlers.click(); await flush();
  assert.equal(run('CityClocks.get(0).zone'), 'America/New_York');
  assert.equal(get('auckland-city').textContent, '纽约');
  assert.equal(get('auckland-english').textContent, 'NEW YORK');
  assert(changes.includes(true));
  assert.equal(JSON.parse(saved['clock-cities-v1'])[0].english, 'New York');
  const calibrated = run('CityClocks.utcNow()');
  const prior = urls.length;
  testing = true;
  await get('city-search-1').handlers.click(); await flush();
  assert.equal(urls.length, prior, 'test mode cannot change cities');
  testing = false; fail = true;
  get('city-sync').handlers.click(); await flush();
  assert.match(get('city-status-1').textContent, /沿用已校准时间/);
  assert.equal(run('CityClocks.utcNow()'), calibrated);
  console.log('PASS: city ranking, bilingual selection/persistence, network UTC with incorrect system clock, fractional offsets, invalid data, test isolation and offline fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
