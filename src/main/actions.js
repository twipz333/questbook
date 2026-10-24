'use strict';
const L = require('../shared/logic');

/** All state mutations. Each returns { ok, error?, toast? } — toast is a visible win for the UI. */
function createActions(getState, now = () => Date.now()) {
  const S = () => getState();
  const today = () => L.dayKey(now(), S().settings.dayStartHour);

  function gain(type, ref, text, xp) {
    const s = S();
    const before = L.levelInfo(s.player.xp).level;
    s.player.xp = Math.max(0, s.player.xp + xp);
    s.log.unshift({ at: now(), type, ref, text, xp });
    if (s.log.length > 2000) s.log.length = 2000;
    const after = L.levelInfo(s.player.xp).level;
    if (after > before) {
      s.log.unshift({ at: now(), type: 'level', ref: null, text: `Уровень ${after}: ${L.levelTitle(after)}`, xp: 0 });
      return { levelUp: after };
    }
    return {};
  }

  function revoke(type, ref) {
    const s = S();
    const anyDay = type === 'chapter' || type === 'saga' || type === 'quest';
    const i = s.log.findIndex((e) => e.type === type && e.ref === ref && (anyDay || L.dayKey(e.at, s.settings.dayStartHour) === today()));
    if (i >= 0) { s.player.xp = Math.max(0, s.player.xp - (s.log[i].xp || 0)); s.log.splice(i, 1); }
  }

  const findQ = (id) => S().quests.find((q) => q.id === id);
  const findH = (id) => S().habits.find((h) => h.id === id);
  const findG = (id) => (S().sagas || []).find((g) => g.id === id);

  function pauseActive() {
    const s = S();
    const q = findQ(s.activeQuestId);
    if (q && s.activeSince) q.focusSec = (q.focusSec || 0) + Math.round((now() - s.activeSince) / 1000);
    s.activeQuestId = null;
    s.activeSince = null;
  }

  // saga sessions don't eat the daily quest limit
  function todayCount() { return S().quests.filter((q) => q.status === 'today' && !q.sagaId).length; }

  const A = {
    // ---------------- quests ----------------
    questAdd(p) {
      const s = S();
      const title = (p.title || '').trim();
      if (!title) return { ok: false, error: 'Нужно название квеста' };
      const q = {
        id: L.uid(), title,
        notes: p.notes || '',
        kind: p.kind === 'main' ? 'main' : 'side',
        area: p.area === 'life' ? 'life' : 'work',
        estimateMin: p.estimateMin || null,
        nextStep: (p.nextStep || '').trim(),
        steps: (p.steps || []).filter((x) => x.text && x.text.trim()).map((x) => ({ id: L.uid(), text: x.text.trim(), done: false })),
        status: 'inbox', createdAt: now(), doneAt: null, doneDay: null, focusSec: 0,
      };
      s.quests.unshift(q);
      let msg = 'Квест записан в книгу';
      if (p.today) {
        if (todayCount() < s.settings.todayLimit) { q.status = 'today'; msg = 'Квест взят на сегодня'; }
        else msg = `Лимит дня ${s.settings.todayLimit} — квест ждёт в книге`;
      }
      return { ok: true, id: q.id, toast: msg };
    },

    questCapture(text) {
      const p = L.parseCapture(text || '');
      if (!p.area) p.area = 'work';
      return A.questAdd(p);
    },

    questUpdate(id, patch) {
      const q = findQ(id);
      if (!q) return { ok: false, error: 'Квест не найден' };
      for (const k of ['title', 'notes', 'kind', 'area', 'estimateMin', 'nextStep']) if (k in patch) q[k] = patch[k];
      if (Array.isArray(patch.steps)) {
        q.steps = patch.steps.filter((x) => x.text && x.text.trim()).map((x) => ({ id: x.id || L.uid(), text: x.text.trim(), done: !!x.done }));
      }
      return { ok: true };
    },

    questDelete(id) {
      const s = S();
      if (s.activeQuestId === id) pauseActive();
      s.quests = s.quests.filter((q) => q.id !== id);
      return { ok: true };
    },

    questToToday(id) {
      const q = findQ(id);
      if (!q) return { ok: false };
      if (q.status === 'today') return { ok: true };
      if (todayCount() >= S().settings.todayLimit) {
        return { ok: false, error: `Лимит дня — ${S().settings.todayLimit}. Заверши или верни один квест в книгу.` };
      }
      q.status = 'today';
      return { ok: true };
    },

    questToInbox(id) {
      const s = S();
      const q = findQ(id);
      if (!q) return { ok: false };
      if (s.activeQuestId === id) pauseActive();
      q.status = 'inbox';
      return { ok: true };
    },

    questReopen(id) {
      const q = findQ(id);
      if (!q || q.status !== 'done') return { ok: false };
      revoke('quest', id);
      q.status = 'inbox'; q.doneAt = null; q.doneDay = null;
      return { ok: true };
    },

    questStart(id) {
      const s = S();
      const q = findQ(id);
      if (!q) return { ok: false };
      if (q.status !== 'today') {
        if (!q.sagaId && todayCount() >= s.settings.todayLimit) {
          // Starting is more important than the limit: swap out the last non-active today quest
          const victim = [...s.quests].reverse().find((x) => x.status === 'today' && !x.sagaId && x.id !== s.activeQuestId);
          if (victim) victim.status = 'inbox';
        }
        q.status = 'today';
      }
      if (s.activeQuestId && s.activeQuestId !== id) pauseActive();
      s.activeQuestId = id;
      s.activeSince = now();
      s.meta.lastFocusCheckAt = now();
      return { ok: true, toast: `В пути: ${q.title}` };
    },

    questPause() { pauseActive(); return { ok: true }; },

    questComplete(id) {
      const s = S();
      const q = findQ(id);
      if (!q) return { ok: false };
      if (s.activeQuestId === id) pauseActive();
      q.status = 'done'; q.doneAt = now(); q.doneDay = today();
      const xp = L.questXp(q);
      const r = gain('quest', id, q.title, xp);
      if (q.sagaId) {
        const g = findG(q.sagaId);
        const min = Math.max(1, Math.round((q.focusSec || 0) / 60)) || q.estimateMin || 30;
        s.sagaLog.push({ id: L.uid(), sagaId: q.sagaId, chapterId: q.chapterId || null, at: now(), min, questId: id });
        if (g) {
          const v = L.sagaView(s, g, now());
          return { ok: true, toast: `Сессия «${g.title}» · +${xp} XP · ${v.weekSessions}/${v.target} на неделе`, xp, sagaId: g.id, ...r };
        }
      }
      return { ok: true, toast: `Квест выполнен · +${xp} XP`, xp, ...r };
    },

    questToggleStep(qid, sid) {
      const q = findQ(qid);
      const st = q && q.steps.find((x) => x.id === sid);
      if (!st) return { ok: false };
      st.done = !st.done;
      if (st.done) {
        if (q.nextStep === st.text) q.nextStep = (q.steps.find((x) => !x.done) || {}).text || '';
        const r = gain('step', sid, `${q.title} → ${st.text}`, L.STEP_XP);
        return { ok: true, toast: `Шаг сделан · +${L.STEP_XP} XP`, ...r };
      }
      revoke('step', sid);
      return { ok: true };
    },

    /** HUD "Шаг готов": finishes the current next step; returns needNext when the user should name a new one. */
    questStepDone(qid) {
      const q = findQ(qid);
      if (!q) return { ok: false };
      const st = q.steps.find((x) => !x.done && (!q.nextStep || x.text === q.nextStep)) || q.steps.find((x) => !x.done);
      if (st) return { ...A.questToggleStep(qid, st.id), needNext: !q.steps.some((x) => !x.done) && !q.nextStep };
      const label = q.nextStep || 'шаг';
      q.nextStep = '';
      const r = gain('step', L.uid(), `${q.title} → ${label}`, L.STEP_XP);
      return { ok: true, toast: `Шаг сделан · +${L.STEP_XP} XP`, needNext: true, ...r };
    },

    // ---------------- habits ----------------
    habitSave(p) {
      const s = S();
      const steps = (p.steps || []).filter((x) => x.text && x.text.trim()).map((x) => ({ id: x.id || L.uid(), text: x.text.trim() }));
      const remind = (p.remind || []).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
      const fields = {
        title: (p.title || '').trim(), kind: p.kind === 'ritual' ? 'ritual' : 'habit',
        days: Array.isArray(p.days) ? p.days : [], time: p.time || null,
        remind: p.time ? remind : [], hard: !!(p.hard && p.time), steps,
      };
      if (!fields.title) return { ok: false, error: 'Нужно название' };
      if (p.id) {
        const h = findH(p.id);
        if (!h) return { ok: false };
        Object.assign(h, fields);
        return { ok: true };
      }
      s.habits.push({ id: L.uid(), createdAt: now(), createdDay: today(), archived: false, ...fields });
      return { ok: true, toast: 'Ритуал добавлен' };
    },

    habitArchive(id) {
      const h = findH(id);
      if (!h) return { ok: false };
      h.archived = true;
      return { ok: true };
    },

    habitToggle(id, forceDone) {
      const s = S();
      const h = findH(id);
      if (!h) return { ok: false };
      const key = today();
      s.habitLog[key] = s.habitLog[key] || {};
      const e = s.habitLog[key][id] || { done: false, steps: [] };
      const target = forceDone === undefined ? !e.done : !!forceDone;
      if (target === e.done) return { ok: true };
      e.done = target;
      e.at = now();
      if (target) e.steps = (h.steps || []).map((x) => x.id);
      s.habitLog[key][id] = e;
      if (target) {
        const xp = L.habitXp(h);
        const r = gain('habit', id, h.title, xp);
        const st = L.habitStreak(s, h, key).streak;
        return { ok: true, toast: `${h.title} · +${xp} XP · серия ${st}`, ...r };
      }
      revoke('habit', id);
      return { ok: true };
    },

    habitToggleStep(id, sid) {
      const s = S();
      const h = findH(id);
      if (!h) return { ok: false };
      const key = today();
      s.habitLog[key] = s.habitLog[key] || {};
      const e = s.habitLog[key][id] || { done: false, steps: [] };
      e.steps = e.steps.includes(sid) ? e.steps.filter((x) => x !== sid) : [...e.steps, sid];
      s.habitLog[key][id] = e;
      const all = h.steps.length > 0 && h.steps.every((x) => e.steps.includes(x.id));
      if (all && !e.done) return A.habitToggle(id, true);
      if (!all && e.done) { e.done = false; revoke('habit', id); }
      return { ok: true };
    },

    snooze(id, minutes) {
      const s = S();
      const key = today() + '|' + id;
      s.meta.snoozes[key] = s.meta.snoozes[key] || { count: 0, until: 0 };
      s.meta.snoozes[key].count++;
      s.meta.snoozes[key].until = now() + minutes * 60000;
      return { ok: true };
    },

    // ---------------- sagas ----------------
    sagaSave(p) {
      const s = S();
      const title = (p.title || '').trim();
      if (!title) return { ok: false, error: 'Нужно название саги' };
      const old = p.id ? findG(p.id) : null;
      const chapters = (p.chapters || []).filter((c) => c.title && c.title.trim()).map((c) => {
        const prev = old && old.chapters.find((x) => x.id === c.id);
        return { id: c.id || L.uid(), title: c.title.trim(), done: prev ? prev.done : false, doneAt: prev ? prev.doneAt : null };
      });
      const fields = {
        title, why: (p.why || '').trim(), area: p.area === 'work' ? 'work' : 'life', chapters,
        targetPerWeek: Math.max(1, Math.min(7, +p.targetPerWeek || 3)),
        sessionMin: Math.max(5, Math.min(240, +p.sessionMin || 30)),
        quietDays: Math.max(2, Math.min(30, +p.quietDays || 5)),
      };
      if (old) { Object.assign(old, fields); return { ok: true }; }
      s.sagas.push({ id: L.uid(), createdAt: now(), status: 'active', doneAt: null, ...fields });
      return { ok: true, toast: 'Сага начата. Первая сессия — когда будешь готов.' };
    },

    sagaArchive(id) {
      const g = findG(id);
      if (!g) return { ok: false };
      g.status = 'archived';
      const s = S();
      for (const q of s.quests) if (q.sagaId === id && q.status !== 'done') { if (s.activeQuestId === q.id) pauseActive(); q.status = 'inbox'; }
      return { ok: true };
    },

    sagaPause(id) {
      const g = findG(id);
      if (!g) return { ok: false };
      g.status = g.status === 'paused' ? 'active' : 'paused';
      if (g.status === 'active') g.createdAt = Math.max(g.createdAt, now()); // resume resets the quiet timer
      return { ok: true, toast: g.status === 'paused' ? 'Сага на паузе — напоминаний не будет' : 'Сага снова в пути' };
    },

    /** Create (or reuse) today's session quest for the saga and start it. */
    sagaStartSession(id) {
      const s = S();
      const g = findG(id);
      if (!g) return { ok: false };
      const v = L.sagaView(s, g, now());
      let q = v.openQuestId && findQ(v.openQuestId);
      if (!q) {
        const ch = v.current;
        q = {
          id: L.uid(), title: ch ? `${g.title} · ${ch.title}` : g.title, notes: '',
          kind: 'main', area: g.area, estimateMin: g.sessionMin || 30,
          nextStep: ch ? `Продолжить главу «${ch.title}»` : 'Сделай одну маленькую вещь по саге',
          steps: [], status: 'today', createdAt: now(), doneAt: null, doneDay: null, focusSec: 0,
          sagaId: g.id, chapterId: ch ? ch.id : null,
        };
        s.quests.unshift(q);
      }
      return A.questStart(q.id);
    },

    /** Session done outside the app (read a chapter on the phone, etc.). */
    sagaLogSession(id) {
      const s = S();
      const g = findG(id);
      if (!g) return { ok: false };
      const v = L.sagaView(s, g, now());
      s.sagaLog.push({ id: L.uid(), sagaId: id, chapterId: v.current ? v.current.id : null, at: now(), min: g.sessionMin || 30 });
      const r = gain('saga-session', id, `${g.title}: сессия`, L.SAGA_SESSION_XP);
      return { ok: true, toast: `Сессия записана · ${v.weekSessions + 1}/${v.target} на неделе`, ...r };
    },

    sagaToggleChapter(id, chId) {
      const s = S();
      const g = findG(id);
      const ch = g && g.chapters.find((c) => c.id === chId);
      if (!ch) return { ok: false };
      ch.done = !ch.done;
      ch.doneAt = ch.done ? now() : null;
      if (!ch.done) {
        revoke('chapter', chId);
        if (g.status === 'done') { g.status = 'active'; g.doneAt = null; revoke('saga', id); }
        return { ok: true };
      }
      let r = gain('chapter', chId, `${g.title}: глава «${ch.title}»`, L.CHAPTER_XP);
      if (g.chapters.every((c) => c.done)) {
        g.status = 'done'; g.doneAt = now();
        r = { ...r, ...gain('saga', id, `Сага завершена: ${g.title}`, L.SAGA_XP) };
        return { ok: true, toast: `Сага «${g.title}» завершена · +${L.CHAPTER_XP + L.SAGA_XP} XP`, sagaDone: true, ...r };
      }
      return { ok: true, toast: `Глава пройдена · +${L.CHAPTER_XP} XP`, ...r };
    },

    // ---------------- misc ----------------
    settingsUpdate(patch) {
      Object.assign(S().settings, patch);
      return { ok: true };
    },

    briefingDone() { S().meta.lastBriefing = today(); return { ok: true }; },
  };
  return A;
}

module.exports = { createActions };
