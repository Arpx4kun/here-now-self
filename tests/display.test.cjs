const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
let now = Date.parse('2026-10-12T05:00:00Z');
const storage = {};
const listeners = {};
const timers = [];
const audioInstances = [];
class FakeAudio {
  constructor(src) { this.src = src; this.currentTime = 0; this.paused = true; this.plays = 0; audioInstances.push(this); }
  play() {
    this.plays += 1;
    if (this.blocked) return Promise.reject(Object.assign(new Error('Gesture required'), { name: 'NotAllowedError' }));
    this.paused = false;
    return Promise.resolve();
  }
  pause() { this.paused = true; }
}
function element() {
  const classes = new Set();
  return {
    textContent: '', hidden: true, children: [], handlers: {},
    style: { setProperty() {} },
    classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, on) { on ? classes.add(name) : classes.delete(name); }
    },
    setAttribute() {}, blur() {},
    addEventListener(name, handler) { this.handlers[name] = handler; },
    appendChild(child) { this.children.push(child); child.parent = this; },
    get firstElementChild() { return this.children[0]; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  };
}
const elements = {};
const get = id => elements[id] ||= element();
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const context = vm.createContext({
  Date: FakeDate, Intl, console, Audio: FakeAudio,
  localStorage: { getItem: key => storage[key] || null, setItem: (key, value) => storage[key] = value },
  document: {
    body: element(), getElementById: get, querySelector: get, querySelectorAll: () => [],
    createElement: element, addEventListener: (name, handler) => listeners[name] = handler
  },
  window: { innerWidth: 1920, innerHeight: 1080, addEventListener() {} },
  setInterval() {}, setTimeout(handler) { timers.push(handler); }
});
vm.runInContext(script, context);
const run = code => vm.runInContext(code, context);
const press = (code, repeat = false) => listeners.keydown({
  code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : 'Control', ctrlKey: code.startsWith('Control'), repeat, preventDefault() {}
});
const finishFlash = () => get('water-flash').handlers.animationend({ animationName: 'water-flash' });
const sound = name => audioInstances.find(audio => audio.src === `${name}.mp3`);
const enableSound = get('enable-sound').handlers.click;

(async () => {
assert.match(html, /background: #87ceeb/);
assert.match(html, /water-flash \.9s ease-in-out 3/);
assert.match(html, /0%, 100% \{ opacity: 0; \} 50% \{ opacity: \.9; \}/);

now += 20 * 60 * 1000 - 1;
run('tick()');
assert.equal(get('water-flash').classList.contains('flashing'), false);
now += 1;
run('tick()');
assert.equal(get('water-flash').classList.contains('flashing'), true);
assert.equal(get('water-reminder').hidden, true);
assert.equal(sound('fresh').plays, 1);
finishFlash();
assert.equal(get('water-reminder').hidden, false);
press('ControlRight');
press('ControlLeft', true);
assert.equal(get('count').textContent, 0);
assert.equal(get('confetti').children.length, 0);
press('ControlLeft');
assert.equal(get('count').textContent, 1);
assert.equal(get('water-reminder').hidden, true);
assert.equal(get('confetti').children.length, 80);
assert.equal(JSON.parse(storage['water-display-v1']).count, 1);

now += 20 * 60 * 1000;
run('tick()');
press('ControlLeft'); // 闪烁中喝水会取消提醒，迟来的结束事件不能再次显示文字。
finishFlash();
assert.equal(get('water-reminder').hidden, true);
assert.equal(get('count').textContent, 2);
for (let i = 0; i < 10; i++) press('ControlLeft');
assert(get('confetti').children.length <= 240);
while (timers.length) timers.shift()();
assert.equal(get('confetti').children.length, 0);

now += 3 * 60 * 60 * 1000; // 休眠跨过多个提醒，只触发一次。
run('tick()');
finishFlash();
run('tick()');
assert.equal(get('water-flash').classList.contains('flashing'), false);
assert.equal(get('water-reminder').hidden, false);
const deadline = run('nextWaterReminderAt');
get('test-water-reminder').handlers.click();
assert.equal(run('nextWaterReminderAt'), deadline); // 手动测试不改变20分钟周期。
finishFlash();

now = Date.parse('2026-10-12T18:29:59Z');
run('tick()');
assert.equal(get('count').textContent, 12);
now += 1000;
run('tick()');
assert.equal(get('count').textContent, 0);
for (let i = 0; i < 40; i++) press('ControlLeft');
assert.equal(get('count').textContent, 36);
assert.equal(get('water-reminder').hidden, true);
now = Date.parse('2026-10-13T05:00:00Z'); // 18:00，普通状态按一次 Z 就寝。
run('tick(); triggerWaterReminder()');
press('KeyZ');
assert(audioInstances.every(audio => audio.paused));
const silentPlays = audioInstances.map(audio => audio.plays);
assert.equal(run('sleepUntil'), Date.parse('2026-10-13T18:30:00Z'));
assert.equal(get('water-flash').classList.contains('flashing'), false);
assert.equal(get('water-reminder').hidden, true);
assert.equal(context.document.body.classList.contains('sleeping'), true);
now += 7 * 60 * 60 * 1000;
run('tick(); triggerWaterReminder()');
assert.deepEqual(audioInstances.map(audio => audio.plays), silentPlays);
assert.equal(get('water-flash').classList.contains('flashing'), false);
assert.equal(run('activeNightStage'), 0);
now = Date.parse('2026-10-13T18:29:59Z');
run('tick()');
assert(run('sleepUntil') > 0);
now += 1000;
run('tick()');
assert.equal(run('sleepUntil'), 0);
assert.equal(context.document.body.classList.contains('sleeping'), false);
assert.equal(run('nextWaterReminderAt'), now + 20 * 60 * 1000);
now += 20 * 60 * 1000;
run('tick()');
assert.equal(get('water-flash').classList.contains('flashing'), true);
finishFlash();

now = Date.parse('2026-10-14T11:00:00Z'); // 00:00，三次 Z。
run('tick()');
assert.equal(sound('aesthetic').paused, false);
const midnightPlays = sound('aesthetic').plays;
run('tick(); tick()');
assert.equal(sound('aesthetic').plays, midnightPlays);
press('KeyQ');
press('KeyZ', true);
assert.equal(run('nightState.presses'), 0);
press('KeyZ'); press('KeyZ');
assert.equal(run('sleepUntil'), 0);
assert.equal(run('activeNightStage'), 1);
press('KeyZ');
assert(run('sleepUntil') > 0);
assert.equal(run('activeNightStage'), 0);

now = Date.parse('2026-10-15T12:00:00Z'); // 次日 01:00，十次 Z。
run('tick()');
assert.equal(sound('fragrance').paused, false);
const oneAmPlays = sound('fragrance').plays;
run('tick(); tick()');
assert.equal(sound('fragrance').plays, oneAmPlays);
for (let i = 0; i < 9; i++) press('KeyZ');
assert.equal(run('sleepUntil'), 0);
assert.equal(run('activeNightStage'), 2);
press('KeyZ');
assert.equal(run('sleepUntil'), Date.parse('2026-10-15T18:30:00Z'));
const sleepingStorage = storage['sleep-display-v1'];
const reopened = vm.createContext({
  Date: FakeDate, Intl, console, Audio: FakeAudio, localStorage: context.localStorage,
  document: context.document, window: context.window, setInterval() {}, setTimeout() {}
});
vm.runInContext(script, reopened);
assert.equal(vm.runInContext('sleepUntil', reopened), Number(sleepingStorage));
assert.equal(vm.runInContext('activeNightStage', reopened), 0);
assert.equal(get('water-flash').classList.contains('flashing'), false);

run("enterSleep(new Date('2026-09-26T10:00:00Z'))");
assert.equal(run('sleepUntil'), Date.parse('2026-09-26T18:30:00Z')); // 夏令时开始后的 07:30。
run("enterSleep(new Date('2026-04-04T10:00:00Z'))");
assert.equal(run('sleepUntil'), Date.parse('2026-04-04T19:30:00Z')); // 夏令时结束后的 07:30。

// 浏览器拒绝自动播放后，可点击补播；就寝会取消待播，异步回调不能重新启用声音。
run('sleepUntil = 0; stopSounds()');
sound('fresh').blocked = true;
run("playSound('fresh')");
await new Promise(resolve => setImmediate(resolve));
assert.equal(run("pendingSounds.has('fresh')"), true);
assert.equal(get('enable-sound').hidden, false);
sound('fresh').blocked = false;
enableSound();
await new Promise(resolve => setImmediate(resolve));
assert.equal(sound('fresh').paused, false);
assert.equal(get('enable-sound').hidden, true);
sound('fragrance').blocked = true;
run("playSound('fragrance'); enterSleep(displayNow())");
await new Promise(resolve => setImmediate(resolve));
assert.equal(run('pendingSounds.size'), 0);
assert(audioInstances.every(audio => audio.paused));
console.log('PASS: reminders, smooth sky-blue 3×0.9s flash, audio mapping and single night triggers, autoplay retry, sleep audio cancellation, confetti, Ctrl filtering, daily reset, Z thresholds, persistence, 07:30 wake, DST.');
})().catch(error => { console.error(error); process.exitCode = 1; });
