// Dev-only smoke test: drives the real UI in a temp profile and checks state.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path'); const os = require('os');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-e2e-'));
app.setPath('userData', ud);
const errors = [];
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (ev) => { if (ev.level === 'error' || ev.level === 3) errors.push(ev.message); });
  wc.on('render-process-gone', (_e2, d) => errors.push('render gone ' + d.reason));
});
require('../src/main/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { console.log('FAIL', m); app.exit(1); };
setTimeout(() => { console.log('FAIL timeout at step', global.__step); app.exit(2); }, 40000);
app.whenReady().then(async () => {
  await wait(500);
  const st = () => global.__qb.store.state;
  st().meta.lastBriefing = require('../src/shared/logic').dayKey(Date.now());
  const main = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Questbook');
  const hud = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Questbook HUD');
  const js = (w, code) => w.webContents.executeJavaScript(code);
  await wait(4500); // let the first scheduler tick pass
  main.webContents.send('nav', 'book'); await wait(400);
  global.__step = (global.__step || 0) + 1; await js(main, `(()=>{const i=document.getElementById('book-add'); i.value='Тестовый квест ~15 @сегодня > открыть терминал'; i.form.requestSubmit();})()`);
  await wait(500);
  const q = st().quests[0];
  if (!q || q.status !== 'today' || q.estimateMin !== 15 || q.nextStep !== 'открыть терминал') return fail('capture ' + JSON.stringify(q));
  if ((await js(main, `document.getElementById('book-add').value`)) !== '') return fail('input not cleared');
  main.webContents.send('nav', 'today'); await wait(400);
  global.__step = (global.__step || 0) + 1; await js(main, `document.querySelector('[data-a="questStart"]').click()`); await wait(400);
  if (st().activeQuestId !== q.id) return fail('start');
  console.log('HERO', await js(main, `document.querySelector('.next')?.innerText`), 'active', st().activeQuestId, q.id);
  global.__step = (global.__step || 0) + 1; await js(main, `document.querySelector('[data-a="stepDone"]').click()`); await wait(500);
  if (!(await js(main, `!!document.getElementById('next-step-input')`))) return fail('askNext not shown');
  global.__step = (global.__step || 0) + 1; await js(main, `(()=>{const i=document.getElementById('next-step-input'); i.value='запустить тесты'; i.form.requestSubmit();})()`); await wait(500);
  if (st().quests[0].nextStep !== 'запустить тесты') return fail('next step not saved');
  // HUD shows active step and completes quest
  const hudText = await js(hud, `document.body.innerText`);
  if (!hudText.includes('запустить тесты')) return fail('hud missing step: ' + hudText);
  global.__step = (global.__step || 0) + 1; await js(hud, `document.querySelector('[data-a="complete"]').click()`); await wait(500);
  if (st().quests[0].status !== 'done' || st().player.xp < 15) return fail('complete via hud xp=' + st().player.xp);
  // habit toggle via HUD
  const hid = st().habits[1].id;
  global.__step = (global.__step || 0) + 1; await js(hud, `document.querySelector('[data-a="habit"][data-id="${hid}"]')?.click()`); await wait(400);
  const k = Object.keys(st().habitLog)[0];
  if (!k || !st().habitLog[k][hid] || !st().habitLog[k][hid].done) return fail('habit toggle');
  // ritual editor round trip
  main.webContents.send('nav', 'rituals'); await wait(300);
  global.__step = (global.__step || 0) + 1; await js(main, `document.querySelector('[data-a="newHabit"]').click()`); await wait(300);
  global.__step = (global.__step || 0) + 1; await js(main, `(()=>{document.getElementById('d-title').value='Растяжка'; document.querySelector('[data-d="addStep"]').click();})()`); await wait(200);
  global.__step = (global.__step || 0) + 1; await js(main, `(()=>{document.querySelector('[data-step="0"]').value='Наклоны'; document.querySelector('[data-d="save"]').click();})()`); await wait(500);
  const nh = st().habits.find((h) => h.title === 'Растяжка');
  if (!nh || nh.steps.length !== 1 || !nh.time) return fail('habit save ' + JSON.stringify(nh));
  // settings change
  main.webContents.send('nav', 'settings'); await wait(300);
  global.__step = (global.__step || 0) + 1; await js(main, `(()=>{const i=document.getElementById('set-todayLimit'); i.value='2'; i.dispatchEvent(new Event('change',{bubbles:true}));})()`); await wait(400);
  if (st().settings.todayLimit !== 2) return fail('settings');
  // persisted?
  global.__qb.store.save(true);
  const disk = JSON.parse(fs.readFileSync(path.join(ud, 'questbook.json'), 'utf8'));
  if (disk.settings.todayLimit !== 2 || disk.quests.length !== 1) return fail('persist');
  if (errors.length) return fail('console errors: ' + errors.join(' | '));
  console.log('E2E OK · xp', st().player.xp);
  app.exit(0);
});
