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
  Date: FakeDate, Intl, console,
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
  code, key: code === 'KeyQ' ? 'q' : 'Control', ctrlKey: code.startsWith('Control'), repeat, preventDefault() {}
});
const finishFlash = () => get('water-flash').handlers.animationend({ animationName: 'water-flash' });

now += 20 * 60 * 1000 - 1;
run('tick()');
assert.equal(get('water-flash').classList.contains('flashing'), false);
now += 1;
run('tick()');
assert.equal(get('water-flash').classList.contains('flashing'), true);
assert.equal(get('water-reminder').hidden, true);
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
console.log('PASS: 20-minute boundaries, flash-to-text sequence, left Ctrl only, held-key filtering, confetti cleanup and cap, reminder cancellation, resume without backlog, manual test cadence, daily 07:30 reset and 36-count goal.');
