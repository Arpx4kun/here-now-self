const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '..', 'city-clocks.js'), 'utf8') + '\n' + html.match(/<script>([\s\S]*?)<\/script>/)[1];
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
    textContent: '', hidden: true, children: [], handlers: {}, dataset: {},
    style: { setProperty() {} },
    classList: {
      add: name => classes.add(name), remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, on) { on ? classes.add(name) : classes.delete(name); }
    },
    attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, blur() {},
    addEventListener(name, handler) { this.handlers[name] = handler; },
    appendChild(child) { this.children.push(child); child.parent = this; },
    get firstElementChild() { return this.children[0]; },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  };
}
const elements = {};
const get = id => elements[id] ||= Object.assign(element(), { id });
class FakeDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const context = vm.createContext({
  Date: FakeDate, Intl, console, Audio: FakeAudio,
  localStorage: { getItem: key => storage[key] || null, setItem: (key, value) => storage[key] = value },
  document: {
    body: element(), getElementById: get, querySelector: get,
    querySelectorAll: selector => selector === '[data-test-time]' ? ['test-soft-time', 'test-strong-time', 'test-reset-time'].map(get) : [],
    createElement: element, addEventListener: (name, handler) => listeners[name] = handler
  },
  window: { innerWidth: 1920, innerHeight: 1080, addEventListener() {} },
  setInterval() {}, setTimeout(handler) { timers.push(handler); }
});
vm.runInContext(script, context);
const run = code => vm.runInContext(code, context);
const keydown = listeners.keydown;
const press = (code, repeat = false) => keydown({
  code, key: code.startsWith('Key') ? code.slice(3).toLowerCase() : 'Control', ctrlKey: code.startsWith('Control'), repeat, preventDefault() {}
});
const animationEnd = get('water-flash').handlers.animationend;
const finishFlash = () => animationEnd({ animationName: 'water-flash' });
const sound = name => audioInstances.find(audio => audio.src === `${name}.mp3`);
const enableSound = get('enable-sound').handlers.click;

(async () => {
const mode = () => run('displayState.mode');
const at = value => { now = Date.parse(value); run('tick()'); };
const finish = () => finishFlash();
const clickSleep = get('sleep-toggle').handlers.click;
const clickSleepTimes = count => { for (let i = 0; i < count; i++) clickSleep(); };
const toggleTest = get('test-toggle').handlers.click;
const testRecovery = get('test-reset-time').handlers.click;
const submitSettings = get('settings-panel').handlers.submit;
const resetRecords = get('reset-water').handlers.click;
const configure = (minutes, volume, times = ['00:00', '01:00', '07:30']) => {
  get('reminder-minutes').value = minutes;
  get('daily-volume').value = volume;
  get('night-soft-time').value = times[0];
  get('night-strong-time').value = times[1];
  get('reset-time').value = times[2];
  submitSettings({ preventDefault() {} });
};
const reload = () => {
  const copy = vm.createContext({ Date: FakeDate, Intl, console, Audio: FakeAudio,
    localStorage: context.localStorage, document: context.document, window: context.window,
    setInterval() {}, setTimeout() {} });
  vm.runInContext(script, copy);
  return copy;
};
assert.equal(mode(), 'normal');
assert.equal(get('main').inert, undefined);
get('sound-gate').hidden = false;
press('KeyZ'); press('ControlLeft');
assert.equal(mode(), 'normal');
assert.equal(get('count').textContent, 0);
get('sound-start').handlers.click();
assert.equal(get('sound-gate').hidden, true);
assert.equal(get('main').inert, false);
assert.match(html, /background: rgb\(0 0 0 \/ 50%\)/);
assert.match(html, /water-flash \.9s ease-in-out 3/);
assert.equal(html.includes('.night-strong .water { display: none; }'), false);

// 正常、初级、高级三个状态均允许喝水提醒和音效。
now += 20 * 60 * 1000;
run('tick()');
assert.equal(run('reminderFlashing'), true);
finish();
assert.equal(get('water-reminder').hidden, false);
press('ControlRight'); press('ControlLeft', true);
assert.equal(sound('cheerful').plays, 0);
press('ControlLeft');
assert.equal(get('count').textContent, 1);
assert.equal(sound('cheerful').plays, 1);
assert.equal(get('confetti').children.length, 80);
assert.equal(get('water-reminder').hidden, true);
finish();
assert.equal(get('water-reminder').hidden, true);

// 白天按钮进入就寝；跨午夜和一点保持就寝，不更新为提醒状态。
clickSleep();
assert.equal(mode(), 'sleep');
assert.equal(run('displayState.wakeAt'), Date.parse('2026-10-12T18:30:00Z'));
assert.equal(sound('music').plays, 1);
const playsBeforeSleep = audioInstances.map(audio => audio.plays);
at('2026-10-12T11:00:00Z');
run('triggerWaterReminder()'); press('ControlLeft');
at('2026-10-12T12:00:00Z');
run('triggerWaterReminder()');
assert.equal(mode(), 'sleep');
assert.equal(run('reminderFlashing'), false);
assert.equal(get('water-reminder').hidden, true);
assert.deepEqual(audioInstances.map(audio => audio.plays), playsBeforeSleep);
assert.equal(context.document.body.classList.contains('night-strong'), false);
const reopened = reload();
assert.equal(vm.runInContext('displayState.mode', reopened), 'sleep');
assert.equal(vm.runInContext('displayState.wakeAt', reopened), run('displayState.wakeAt'));
at('2026-10-12T18:29:59Z');
assert.equal(mode(), 'sleep');
at('2026-10-12T18:30:00Z');
assert.equal(mode(), 'normal');
assert.equal(sound('begining').plays, 1);
assert.equal(sound('begining').paused, false);
assert.equal(get('count').textContent, 0);
assert.equal(run('nextWaterReminderAt'), now + 20 * 60 * 1000);
run('tick(); tick()');
assert.equal(sound('begining').plays, 1);

// Z 在正常状态进入；手动退出没有额外的免提醒状态。
press('KeyZ');
assert.equal(mode(), 'sleep');
press('KeyZ', true);
assert.equal(mode(), 'sleep');
press('KeyZ');
assert.equal(mode(), 'normal');
at('2026-10-13T10:59:59Z');
assert.equal(mode(), 'normal');
const softBefore = sound('aesthetic').plays;
at('2026-10-13T11:00:00Z');
assert.equal(mode(), 'soft-reminder');
assert.equal(sound('aesthetic').plays, softBefore + 1);
const deadline = run('nextWaterReminderAt');
run('clearWaterReminder(); triggerWaterReminder()');
assert.equal(sound('fresh').paused, false);
assert.equal(run('nextWaterReminderAt'), deadline);
finish();
press('ControlLeft');
assert.equal(sound('cheerful').paused, false);
press('KeyQ'); press('KeyZ', true);
assert.equal(run('displayState.presses'), 0);
press('KeyZ'); press('KeyZ');
assert.equal(mode(), 'soft-reminder');
press('KeyZ');
assert.equal(mode(), 'sleep');
press('KeyZ');
assert.equal(mode(), 'soft-reminder'); // 离开就寝即按真实时间提醒。
const strongBefore = sound('fragrance').plays;
at('2026-10-13T11:59:59Z');
assert.equal(mode(), 'soft-reminder');
at('2026-10-13T12:00:00Z');
assert.equal(mode(), 'strong-reminder');
assert.equal(sound('fragrance').plays, strongBefore + 1);
run('tick(); tick()');
assert.equal(sound('fragrance').plays, strongBefore + 1);
run('triggerWaterReminder()');
assert.equal(run('reminderFlashing'), true);
finish();
press('ControlLeft');
for (let i = 0; i < 9; i++) press('KeyZ');
assert.equal(mode(), 'strong-reminder');
press('KeyZ');
assert.equal(mode(), 'sleep');
press('KeyZ');
assert.equal(mode(), 'strong-reminder');
clickSleepTimes(9);
assert.equal(mode(), 'strong-reminder');
assert.equal(run('displayState.presses'), 9);
clickSleep();
assert.equal(mode(), 'sleep'); // 屏幕按钮与 Z 共同遵守十次确认。
const quietPlays = audioInstances.map(audio => audio.plays);
at('2026-10-13T16:00:00Z');
run('triggerWaterReminder()');
assert.deepEqual(audioInstances.map(audio => audio.plays), quietPlays);
at('2026-10-13T18:30:00Z');
assert.equal(mode(), 'normal');

// 初级状态点击进入同样保持睡眠到恢复时刻。
at('2026-10-14T11:00:00Z');
assert.equal(mode(), 'soft-reminder');
clickSleep();
assert.equal(mode(), 'soft-reminder');
assert.equal(run('displayState.presses'), 1);
press('KeyZ');
assert.equal(run('displayState.presses'), 2);
clickSleep();
assert.equal(mode(), 'sleep');
at('2026-10-14T12:00:00Z');
assert.equal(mode(), 'sleep');
at('2026-10-14T18:30:00Z');
assert.equal(mode(), 'normal');

// 配置、目标、重置和测试隔离。
configure(5, 2000);
assert.equal(run('GOAL'), 40);
assert.equal(get('total').textContent, ' / 40 次');
assert.equal(run('nextWaterReminderAt'), now + 5 * 60 * 1000);
const realStorage = JSON.stringify(storage);
toggleTest();
configure(2, 2500);
const beginningBeforeTest = sound('begining').plays;
testRecovery();
assert.equal(mode(), 'normal');
assert.equal(get('count').textContent, 0);
assert.equal(sound('begining').plays, beginningBeforeTest + 1);
run('tick(); tick()');
assert.equal(sound('begining').plays, beginningBeforeTest + 1);
testRecovery();
assert.equal(sound('begining').plays, beginningBeforeTest + 2);
run('triggerWaterReminder()'); finish();
assert.equal(get('water-reminder').hidden, false);
toggleTest();
assert.equal(mode(), 'normal');
assert.equal(run('GOAL'), 40);
assert.equal(get('water-reminder').hidden, true);
finish();
assert.equal(get('water-reminder').hidden, true);
assert.equal(JSON.stringify(storage), realStorage);
for (let i = 0; i < 45; i++) press('ControlLeft');
assert.equal(get('count').textContent, 40);
assert(get('confetti').children.length <= 240);
while (timers.length) timers.shift()();
assert.equal(get('confetti').children.length, 0);
configure(5, 50);
assert.equal(get('count').textContent, 40);
assert.equal(get('fill').style.width, '100%');
resetRecords();
assert.equal(get('count').textContent, 0);
configure(0, 1825);
assert.equal(run('GOAL'), 1);

// 自定义跨午夜和 DST：就寝优先于所有时间驱动的提醒。
configure(20, 1800, ['22:30', '23:30', '08:00']);
at('2026-10-15T09:29:59Z');
assert.equal(mode(), 'normal');
at('2026-10-15T09:30:00Z');
assert.equal(mode(), 'soft-reminder');
at('2026-10-15T10:30:00Z');
assert.equal(mode(), 'strong-reminder');
press('KeyZ');
at('2026-10-15T11:00:00Z');
assert.equal(run('displayState.presses'), 1);
clickSleepTimes(9); // 已经按过一次 Z，按钮接着累计到十次。
assert.equal(run('displayState.wakeAt'), Date.parse('2026-10-15T19:00:00Z'));
at('2026-10-15T19:00:00Z');
assert.equal(mode(), 'normal');
assert.equal(get('test-reset-time').dataset.testTime, '08:00:00');
toggleTest();
const customRecoveryBefore = sound('begining').plays;
testRecovery();
assert.equal(get('auckland-hours').textContent, '08:00');
assert.equal(sound('begining').plays, customRecoveryBefore + 1);
toggleTest();
configure(20, 1800, ['00:00', '01:00', '02:30']);
toggleTest();
get('test-time').value = '2026-09-27T00:00:00';
const dstRecoveryBefore = sound('begining').plays;
testRecovery();
assert.equal(get('auckland-hours').textContent, '03:00');
assert.equal(sound('begining').plays, dstRecoveryBefore + 1);
toggleTest();
at('2026-09-26T10:00:00Z');
clickSleep();
assert.equal(run('displayState.wakeAt'), Date.parse('2026-09-26T14:00:00Z'));
run('exitSleep(displayNow())');
configure(20, 1800);
at('2026-04-04T10:00:00Z');
clickSleep();
assert.equal(run('displayState.wakeAt'), Date.parse('2026-04-04T19:30:00Z'));

// 自动播放拒绝不会在进入就寝后补播提醒。
run('exitSleep(displayNow())');
sound('fresh').blocked = true;
run("playSound('fresh')");
await new Promise(resolve => setImmediate(resolve));
assert.equal(run("pendingSounds.has('fresh')"), true);
sound('fresh').blocked = false;
enableSound();
await new Promise(resolve => setImmediate(resolve));
assert.equal(get('enable-sound').hidden, true);
sound('fragrance').blocked = true;
run("playSound('fragrance'); enterSleep(displayNow())");
await new Promise(resolve => setImmediate(resolve));
assert.equal(run('pendingSounds.size'), 0);
assert(audioInstances.every(audio => audio.src === 'music.mp3' || audio.paused));
assert.equal(mode(), 'sleep');
// 重新载入已选城市：左侧纽约用于提醒/清零，右侧尼泊尔处理 45 分钟偏移。
storage['clock-cities-v1'] = JSON.stringify([
  {country:'US',english:'New York',chinese:'纽约',zone:'America/New_York'},
  {country:'NP',english:'Kathmandu',chinese:'加德满都',zone:'Asia/Kathmandu'}
]);
delete storage['display-state-v1'];
delete storage['sleep-display-v1'];
now = Date.parse('2026-10-13T04:30:00Z'); // 纽约 00:30，尼泊尔 10:15。
const relocated = reload();
assert.equal(vm.runInContext('displayState.mode', relocated), 'soft-reminder');
assert.equal(get('auckland-hours').textContent, '00:30');
assert.equal(get('china-hours').textContent, '10:15');
assert.match(get('china-season').textContent, /UTC\+05:45/);
assert.equal(vm.runInContext('waterDay(displayNow())', relocated), '2026-10-12');
assert.equal(vm.runInContext('nextRecovery(displayNow())', relocated), Date.parse('2026-10-13T11:30:00Z'));
console.log('PASS: shared Z/button counters, recovery test preset plays Beginning once and clears records, repeated/custom/DST recovery tests, test restoration; four states, sleep suppression, configuration, audio and daily reset.');
})().catch(error => { console.error(error); process.exitCode = 1; });
