// Dev-only: seeds demo data into a temp profile and captures screenshots of every view.
const { app } = require('electron');
const fs = require('fs'); const path = require('path'); const os = require('os');
const OUT = process.env.QB_SHOT || path.join(os.tmpdir(), 'qb-shots');
fs.mkdirSync(OUT, { recursive: true });
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'qb-ud-'));
app.setPath('userData', ud);
const L = require('../src/shared/logic');
const { createActions } = require('../src/main/actions');
const now = Date.now();
const s = L.defaultState(now);
s.settings.theme = process.env.QB_THEME || 'dark';
s.meta.lastBriefing = L.dayKey(now); s.meta.lastReview = L.dayKey(now);
// backdate habits & add history
for (const h of s.habits) { h.createdDay = L.addDays(L.dayKey(now), -40); }
const A = createActions(() => s, () => now - 3600000 * 3);
s.habits.push({ id: 'h3', title: 'Без телефона первый час', kind: 'habit', days: [1,2,3,4,5], time: null, remind: [], hard: false, steps: [], createdDay: L.addDays(L.dayKey(now), -40), archived: false });
for (let i = 1; i <= 40; i++) {
  const k = L.addDays(L.dayKey(now), -i);
  s.habitLog[k] = {};
  s.habits.forEach((h, j) => { if ((i * (j + 3)) % 7 !== 0) s.habitLog[k][h.id] = { done: true, steps: [] }; });
  const n = (i * 7) % 5;
  for (let x = 0; x < n; x++) s.log.push({ at: new Date(k + 'T15:00').getTime() + x * 600000, type: x % 2 ? 'quest' : 'habit', ref: 'r' + i + x, text: x % 2 ? 'Квест из прошлого' : 'Ритуал отбоя', xp: 15 + x * 10 });
}
s.player.xp = 540;
A.questCapture('Починить алерты на 5xx в Gateway API ~45 ! @сегодня > открыть дашборд с ошибками');
A.questCapture('Ответить на ревью PR ~20 @сегодня');
A.questAdd({ title: 'Записаться к стоматологу', area: 'life', estimateMin: 5, nextStep: 'Найти номер клиники' });
A.questAdd({ title: 'Разобрать runbook по ротации сертификатов', estimateMin: 90, steps: [{ text: 'Собрать текущие шаги' }, { text: 'Проверить на стейдже' }, { text: 'Обновить в вики' }] });
A.questAdd({ title: 'Продлить домен', area: 'life', estimateMin: 10 });
const q1 = s.quests.find((q) => q.title.startsWith('Починить'));
q1.steps = [{ id: 'a', text: 'Открыть дашборд с ошибками', done: true }, { id: 'b', text: 'Найти маршрут с ростом 5xx', done: false }, { id: 'c', text: 'Поправить таймаут и выкатить', done: false }];
q1.nextStep = 'Найти маршрут с ростом 5xx';
A.questStart(q1.id);
s.activeSince = now - 23 * 60000;
const done = A.questAdd({ title: 'Обновить зависимости Helm-чарта', estimateMin: 30, today: true }).id;
A.questComplete(done);
s.log.forEach((e) => { if (e.at > now - 86400000 && e.at < now) e.at = Math.min(e.at, now); });
s.habits[0].time = (() => { const d = new Date(now + 40 * 60000); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; })();
A.sagaSave({ title: 'Япония 2.0', why: 'Понимать игры и аниме без субтитров', area: 'life', targetPerWeek: 3, sessionMin: 30,
  chapters: [{ title: 'Возвращение' }, { title: 'Кана без подсказок' }, { title: 'Первые 300 слов' }],
  sessionTypes: [{ name: 'Игра' }, { name: 'Повторение' }, { name: 'Аудирование' }] });
const g = s.sagas[0]; g.createdAt = now - 30 * 86400000;
A.chapterSave(g.id, g.chapters[0].id, { title: 'Возвращение', goal: 'Вернуться без перегруза', criterion: 'Провести 3 спокойных занятия с Wagotabi',
  steps: [{ text: 'Открыть Wagotabi и вспомнить управление' }, { text: 'Повторить знакомый материал 15 минут' }, { text: 'Ещё одно занятие без нового материала' }] });
g.chapters[0].steps[0].done = true; g.chapters[0].steps[0].doneAt = now - 15 * 86400000;
s.sagaLog.push({ id: 'sl1', sagaId: g.id, chapterId: g.chapters[0].id, at: now - 15 * 86400000, min: 12, typeId: g.sessionTypes[0].id, stepId: g.chapters[0].steps[0].id, stepDone: true, note: 'вспомнил меню и сохранения', wrapped: true });
s.sagaLog.push({ id: 'sl2', sagaId: g.id, chapterId: g.chapters[0].id, at: now - 17 * 86400000, min: 25, typeId: g.sessionTypes[2].id, note: '', wrapped: true });
A.sagaSave({ title: 'Изучить Electron', area: 'work', targetPerWeek: 2, sessionMin: 45, chapters: [{ title: 'Tutorial' }, { title: 'IPC и preload' }] });
s.sagas[1].createdAt = now - 3 * 86400000;
s.settings.hudBounds = { x: 1600 - 328, y: 1000 - 300, width: 328, height: 300 };
fs.writeFileSync(path.join(ud, 'questbook.json'), JSON.stringify(s));

require('../src/main/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function cap(w, name) { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG()); }
app.whenReady().then(async () => {
  await wait(2500);
  const qb = global.__qb;
  const { BrowserWindow } = require('electron');
  const byTitle = (t) => BrowserWindow.getAllWindows().find((w) => w.getTitle() === t);
  const main = byTitle('Questbook');
  for (const page of ['today', 'briefing', 'book', 'sagas', 'rituals', 'chronicle', 'settings']) {
    main.webContents.send('nav', page); await wait(600); await cap(main, 'main-' + page);
  }
  main.webContents.send('nav', 'sagas'); await wait(300);
  await main.webContents.executeJavaScript("document.querySelector('[data-a=\"sagaExpand\"]').click(); document.querySelector('[data-a=\"sagaHistory\"]').click()"); await wait(300); await cap(main, 'main-sagas-open');
  await main.webContents.executeJavaScript("document.querySelector('[data-a=\"sagaLaunch\"]').click()"); await wait(400); await cap(main, 'main-launcher');
  await main.webContents.executeJavaScript("document.querySelector('[data-d=\"close\"]').click()");
  await main.webContents.executeJavaScript("document.querySelector('[data-a=\"editChapter\"]').click()"); await wait(400); await cap(main, 'main-chapter');
  await main.webContents.executeJavaScript("document.querySelector('[data-d=\"close\"]').click()");
  await main.webContents.executeJavaScript("document.querySelector('[data-a=\"sagaQuickStart\"]').click()"); await wait(500);
  main.webContents.send('nav', 'today'); await wait(400); await cap(main, 'main-today-session');
  await main.webContents.executeJavaScript("document.querySelector('.next [data-a=\"questComplete\"]').click()"); await wait(600); await cap(main, 'main-wrap');
  await main.webContents.executeJavaScript("document.querySelector('[data-d=\"wrapSkip\"]').click()"); await wait(200);
  main.webContents.send('nav', 'sagas'); await wait(300);
  await main.webContents.executeJavaScript("document.querySelector('[data-a=\"editSaga\"]').click()"); await wait(400); await cap(main, 'main-edit-saga');
  await main.webContents.executeJavaScript("document.querySelector('[data-d=\"close\"]').click()");
  main.webContents.send('nav', 'book'); await wait(300);
  await main.webContents.executeJavaScript("document.querySelector('[data-a=\"editQuest\"]').click()"); await wait(500); await cap(main, 'main-edit-quest');
  await main.webContents.executeJavaScript("document.querySelector('[data-d=\"close\"]').click()");
  main.webContents.send('nav', 'rituals'); await wait(300);
  await main.webContents.executeJavaScript("document.querySelector('[data-a=\"editHabit\"]').click()"); await wait(500); await cap(main, 'main-edit-habit');
  const hud = byTitle('Questbook HUD'); await cap(hud, 'hud');
  console.log('HUD bounds', JSON.stringify(hud.getBounds()), await hud.webContents.executeJavaScript('document.body.className'));
  qb.store.state.settings.hudCollapsed = true; qb.broadcast(); await wait(700); await cap(hud, 'hud-collapsed');
  console.log('HUD collapsed bounds', JSON.stringify(hud.getBounds()));
  qb.store.state.settings.hudCollapsed = false; qb.broadcast();
  qb.showCapture(); await wait(800);
  const c = byTitle('Новый квест');
  await c.webContents.executeJavaScript("const i=document.getElementById('cap'); i.value='Подготовить демо для команды ~30 ! @сегодня > набросать план'; i.dispatchEvent(new Event('input'))");
  await wait(300); await cap(c, 'capture');
  qb.showOverlay(qb.store.state.habits[0].id); await wait(1500);
  const ov = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Questbook' && w !== main);
  if (ov) await cap(ov, 'overlay');
  app.exit(0);
});
