'use strict';

// 地点来自 Open-Meteo / GeoNames；网络时钟来自 TimeAPI.io，无需 Key。
const CityClocks = (() => {
  const defaults = [
    { country: 'NZ', english: 'Auckland', chinese: '奥克兰', zone: 'Pacific/Auckland' },
    { country: 'CN', english: 'Xiamen', chinese: '厦门', zone: 'Asia/Shanghai' }
  ];
  const key = 'clock-cities-v1';
  const mono = () => typeof performance === 'undefined' ? Date.now() : performance.now();
  const validZone = zone => {
    try { new Intl.DateTimeFormat('en', { timeZone: zone }); return typeof zone === 'string'; }
    catch (_) { return false; }
  };
  let cities = defaults.map(city => ({ ...city }));
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(saved) && saved.length === 2) cities = saved.map((city, i) =>
      city && /^[A-Z]{2}$/.test(city.country) && typeof city.english === 'string' && city.english.length <= 200 &&
      typeof city.chinese === 'string' && city.chinese.length <= 200 && validZone(city.zone) ? city : defaults[i]);
  } catch (_) {}
  let anchor = null;
  let notify = () => {};
  let paused = () => false;
  const versions = [0, 0];
  const searches = [0, 0];
  const pending = [false, false];
  const network = [null, null];
  const statuses = ['尚未同步 · 暂用电脑时间', '尚未同步 · 暂用电脑时间'];
  const nameFormats = new Map();
  const offsetFormats = new Map();
  const el = id => document.getElementById(id);
  function utcNow() { return anchor ? anchor.utc + mono() - anchor.monotonic : Date.now(); }
  function offsetText(seconds) {
    const minutes = Math.round(Math.abs(seconds) / 60);
    return `UTC${seconds < 0 ? '−' : '+'}${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  function parseNetwork(data) {
    const seconds = data?.currentUtcOffset?.seconds;
    const local = data?.currentLocalTime;
    if (!Number.isFinite(seconds) || Math.abs(seconds) > 86400 || typeof local !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(local)) throw new Error('时间服务返回的数据无效');
    // 返回的是无偏移的当地时间，绝不能让 Date 按电脑时区解释它。
    const utc = Date.parse(local.replace(/(\.\d{3})\d+$/, '$1') + 'Z') - seconds * 1000;
    if (!Number.isFinite(utc)) throw new Error('时间服务返回的数据无效');
    return { utc, seconds, transitions: data.dstInterval || null };
  }
  async function json(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`服务暂不可用（${response.status}）`);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function updateStatus(i) { el(`city-status-${i}`).textContent = statuses[i]; }
  async function sync(i) {
    if (typeof fetch === 'undefined' || paused() || pending[i]) return;
    pending[i] = true;
    const version = versions[i];
    const zone = cities[i].zone;
    statuses[i] = '正在同步网络时间…'; updateStatus(i);
    const started = mono();
    try {
      const data = await json(`https://timeapi.io/api/timezone/zone?timeZone=${encodeURIComponent(zone)}`);
      const received = mono();
      if (version !== versions[i] || paused()) return;
      if (data.timeZone !== zone) throw new Error('时间服务返回的时区不匹配');
      const parsed = parseNetwork(data);
      // 用请求往返耗时的一半补偿网络延迟；两座城市共享同一 UTC 时钟。
      if (i === 0 || !anchor) anchor = { utc: parsed.utc + (received - started) / 2, monotonic: received };
      network[i] = parsed;
      statuses[i] = `网络已同步 · ${offsetText(parsed.seconds)}`;
      notify(false);
    } catch (_) {
      if (version !== versions[i]) return;
      statuses[i] = anchor ? '同步失败 · 沿用已校准时间，稍后重试' : '同步失败 · 暂用电脑时间，稍后重试';
    } finally {
      pending[i] = false;
      updateStatus(i);
      if (version !== versions[i]) sync(i);
    }
  }
  function actualOffset(i, date, testing = false) {
    const info = network[i];
    if (info && !testing) {
      const interval = info.transitions;
      if (interval?.dstStart && interval?.dstEnd) {
        const start = Date.parse(interval.dstStart), end = Date.parse(interval.dstEnd);
        const adjustment = interval.dstOffsetToStandardTime?.seconds;
        if (Number.isFinite(adjustment)) return info.seconds +
          ((date.getTime() >= start && date.getTime() < end ? adjustment : 0) -
           (info.utc >= start && info.utc < end ? adjustment : 0));
      }
      return info.seconds;
    }
    const zone = cities[i].zone;
    if (!offsetFormats.has(zone)) offsetFormats.set(zone, new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' }));
    const value = offsetFormats.get(zone).formatToParts(date).find(part => part.type === 'timeZoneName').value;
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(value);
    return match ? (match[1] === '-' ? -1 : 1) * (+match[2] * 3600 + +(match[3] || 0) * 60) : 0;
  }
  function currentName(i, date) {
    const zone = cities[i].zone;
    if (!nameFormats.has(zone)) nameFormats.set(zone, new Intl.DateTimeFormat('zh-CN', { timeZone: zone, timeZoneName: 'long' }));
    return nameFormats.get(zone).formatToParts(date).find(part => part.type === 'timeZoneName').value;
  }
  function renderNames() {
    for (const [i, id] of ['auckland', 'china'].entries()) {
      el(`${id}-city`).textContent = cities[i].chinese;
      el(`${id}-english`).textContent = cities[i].english.toUpperCase();
      el(`${id}-clock`).setAttribute('aria-label', `${cities[i].chinese}时间`);
    }
    for (const id of ['soft-time-label', 'strong-time-label', 'reset-time-label', 'test-time-label']) {
      const labels = { 'soft-time-label': '初级防熬夜提醒', 'strong-time-label': '高级防熬夜提醒', 'reset-time-label': '每日恢复与清零', 'test-time-label': '模拟日期与时间' };
      el(id).textContent = `${labels[id]}（${cities[0].chinese}时间）`;
    }
  }
  function openSettings() {
    for (let i = 0; i < 2; i++) {
      el(`city-country-${i}`).value = cities[i].country;
      el(`city-query-${i}`).value = cities[i].english;
      updateStatus(i);
    }
  }
  function rank(place) {
    return place.feature_code === 'PPLC' ? 0 : /^PPLA/.test(place.feature_code || '') ? 1 : /^PPL/.test(place.feature_code || '') ? 2 : 3;
  }
  async function select(i, place, searchVersion) {
    const button = el(`city-search-${i}`);
    button.disabled = true;
    el(`city-results-${i}`).textContent = '正在获取中英文名称…';
    try {
      const localized = await json(`https://geocoding-api.open-meteo.com/v1/get?id=${place.id}&language=zh`);
      if (searchVersion !== searches[i] || paused()) return;
      const translated = (localized.results || []).find(p => p.id === place.id) || localized;
      if (!validZone(place.timezone)) throw new Error('该地点没有有效的时区数据');
      cities[i] = { id: place.id, country: place.country_code, english: place.name,
        chinese: translated.name || place.name, zone: place.timezone };
      versions[i] += 1; network[i] = null;
      try { localStorage.setItem(key, JSON.stringify(cities)); } catch (_) {}
      el(`city-results-${i}`).textContent = /[\u3400-\u9fff]/.test(cities[i].chinese) ? '已应用并保存' : '已应用并保存；数据源未提供中文译名，显示原名';
      renderNames(); openSettings(); notify(i === 0); sync(i);
    } catch (error) {
      if (searchVersion === searches[i]) el(`city-results-${i}`).textContent = `未更改城市：${error.message || '查询失败，请重试'}`;
    } finally { button.disabled = false; }
  }
  async function search(i) {
    if (paused()) { el(`city-results-${i}`).textContent = '请先恢复实际状态，再设置城市。'; return; }
    const country = el(`city-country-${i}`).value.trim().toUpperCase();
    const query = el(`city-query-${i}`).value.trim();
    const version = ++searches[i];
    const results = el(`city-results-${i}`);
    if (!/^[A-Z]{2}$/.test(country) || query.length < 2) { results.textContent = '请输入两位国家代码和至少两个字符的城市名。'; return; }
    el(`city-country-${i}`).value = country;
    results.textContent = '正在搜索…';
    try {
      const data = await json(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&countryCode=${country}&language=en&count=30`);
      if (version !== searches[i]) return;
      const places = (data.results || []).filter(p => p.country_code === country && p.timezone && Number.isInteger(p.id))
        .sort((a, b) => rank(a) - rank(b) || (b.population || 0) - (a.population || 0));
      results.textContent = places.length ? '' : '未找到地点，请尝试其他拼写或增加省／州名。';
      for (const place of places.slice(0, 12)) {
        const item = document.createElement('button'); item.type = 'button';
        item.textContent = `${place.name} · ${[place.admin1, place.admin2, place.country_code].filter(Boolean).join(' / ')}${rank(place) > 2 ? ' · 其他地点' : ''}`;
        item.addEventListener('click', () => select(i, place, version)); results.appendChild(item);
      }
    } catch (_) {
      if (version === searches[i]) results.textContent = '城市查询失败，请检查网络后重试；原城市保持不变。';
    }
  }
  function init({ onChange, isTesting }) {
    notify = onChange; paused = isTesting;
    renderNames(); openSettings();
    for (let i = 0; i < 2; i++) {
      el(`city-search-${i}`).addEventListener('click', () => search(i));
      for (const input of [`city-query-${i}`, `city-country-${i}`]) {
        el(input).addEventListener('input', () => { searches[i] += 1; el(`city-results-${i}`).textContent = ''; });
        el(input).addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); search(i); } });
      }
    }
    el('city-sync').addEventListener('click', () => { sync(0); sync(1); });
    sync(0); sync(1);
    let lastResume = mono();
    const resume = () => {
      if (document.hidden || mono() - lastResume < 60000) return;
      lastResume = mono(); sync(0); sync(1);
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', () => { sync(0); sync(1); });
  }
  return { get: i => cities[i], utcNow, actualOffset, currentName, offsetText, parseNetwork, rank, init, openSettings, syncAll: () => Promise.all([sync(0), sync(1)]) };
})();
