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
    const anyDay = type === 'chapter' || type === 'saga' || type === 'quest' || type === 'saga-step';
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
        area: p.area === 'work' ? 'work' : 'life',
        estimateMin: p.estimateMin || null,
        nextStep: (p.nextStep || '').trim(),
        steps: (p.steps || []).filter((x) => x.text && x.text.trim()).map((x) => ({ id: L.uid(), text: x.text.trim(), done: false })),
        status: 'inbox', createdAt: now(), doneAt: null, doneDay: null, focusSec: 0,
        dueDay: p.dueDay || null, dueTime: p.dueDay && p.dueTime ? p.dueTime : null,
        links: L.cleanLinks(p.links),
      };
      s.quests.unshift(q);
      const due = L.dueInfo(q, now(), s.settings.dayStartHour);
      let msg = due ? `Квест записан · срок ${due.label}` : 'Квест записан в книгу';
      if (p.today || (q.dueDay && q.dueDay <= today())) {
        if (todayCount() < s.settings.todayLimit) { q.status = 'today'; msg = due ? `Квест на сегодня · ${due.label}` : 'Квест взят на сегодня'; }
        else msg = `Лимит дня ${s.settings.todayLimit} — квест ждёт в книге`;
      }
      return { ok: true, id: q.id, toast: msg };
    },

    questCapture(text) {
      const p = L.parseCapture(text || '', now(), S().settings.dayStartHour);
      if (!p.area) p.area = 'life'; // default sphere; #работа switches it
      return A.questAdd(p);
    },

    questUpdate(id, patch) {
      const q = findQ(id);
      if (!q) return { ok: false, error: 'Квест не найден' };
      for (const k of ['title', 'notes', 'kind', 'area', 'estimateMin', 'nextStep']) if (k in patch) q[k] = patch[k];
      if (Array.isArray(patch.links)) q.links = L.cleanLinks(patch.links);
      if ('dueDay' in patch) {
        q.dueDay = /^\d{4}-\d{2}-\d{2}$/.test(patch.dueDay || '') ? patch.dueDay : null;
        q.dueTime = q.dueDay && /^\d{2}:\d{2}$/.test(patch.dueTime || '') ? patch.dueTime : null;
      }
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
      if (q.sagaId) S().sagaLog = S().sagaLog.filter((e) => e.questId !== id);
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
      if (q.status === 'done') return { ok: false, error: 'Квест уже выполнен' }; // double click / two windows
      if (s.activeQuestId === id) pauseActive();
      q.status = 'done'; q.doneAt = now(); q.doneDay = today();
      const xp = L.questXp(q);
      const r = gain('quest', id, q.title, xp);
      if (q.sagaId && !s.sagaLog.some((e) => e.questId === id)) {
        const g = findG(q.sagaId);
        const sec = q.focusSec || 0;
        // actual focus time; if the timer never ran, fall back to the planned length and flag it
        const estimated = sec === 0;
        const min = estimated ? (q.estimateMin || 0) : Math.max(1, Math.round(sec / 60));
        const entry = {
          id: L.uid(), sagaId: q.sagaId, chapterId: q.chapterId || null, at: now(), min, estimated,
          questId: id, typeId: q.sagaTypeId || null, plannedStepId: q.sagaStepId || null,
          stepId: null, stepDone: false, note: '', wrapped: false,
        };
        s.sagaLog.push(entry);
        if (g) {
          const v = L.sagaView(s, g, now());
          const ch = v.chapters.find((c) => c.id === entry.chapterId);
          const planned = ch && ch.steps.find((st) => st.id === entry.plannedStepId);
          return {
            ok: true, xp, sagaId: g.id, ...r,
            toast: `Сессия «${g.title}» · ${min} мин · ${v.weekSessions}/${v.target} на неделе`,
            sagaSession: { logId: entry.id, sagaId: g.id, title: g.title, min, estimated, stepId: planned && !planned.done ? planned.id : null, stepText: planned ? planned.text : '' },
          };
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
      // Merge by id: the saga editor only sends id + title, so everything else a chapter
      // carries (done, goal, criterion, steps, future fields) must survive the edit.
      const chapters = (p.chapters || []).filter((c) => c.title && c.title.trim()).map((c) => {
        const prev = old && c.id && old.chapters.find((x) => x.id === c.id);
        if (prev) return { ...L.chapterOf(prev), title: c.title.trim() };
        return { id: L.uid(), title: c.title.trim(), done: false, doneAt: null, goal: '', criterion: '', steps: [] };
      });
      const sessionTypes = (p.sessionTypes || []).filter((t) => t.name && t.name.trim())
        .map((t) => ({ id: t.id || L.uid(), name: t.name.trim().slice(0, 40) }));
      const fields = {
        title, why: (p.why || '').trim(), area: p.area === 'work' ? 'work' : 'life', chapters, sessionTypes,
        targetPerWeek: Math.max(1, Math.min(7, +p.targetPerWeek || 3)),
        sessionMin: Math.max(5, Math.min(240, +p.sessionMin || 30)),
        quietDays: Math.max(2, Math.min(30, +p.quietDays || 5)),
        remind: p.remind !== false,
        remindEvery: Math.max(3, Math.min(30, +p.remindEvery || 7)),
      };
      if (old) {
        Object.assign(old, fields);
        if (old.status === 'done' && chapters.some((c) => !c.done)) { old.status = 'active'; old.doneAt = null; revoke('saga', old.id); }
        return { ok: true };
      }
      s.sagas.push({ id: L.uid(), createdAt: now(), status: 'active', doneAt: null, ...fields });
      return { ok: true, toast: 'Сага начата. Начни с одной главы и пары маленьких шагов.' };
    },

    /** Edit one chapter's plan: goal, completion criterion and small steps (done state kept by id). */
    chapterSave(sagaId, chId, p) {
      const g = findG(sagaId);
      const idx = g ? g.chapters.findIndex((c) => c.id === chId) : -1;
      if (idx < 0) return { ok: false, error: 'Глава не найдена' };
      const prev = L.chapterOf(g.chapters[idx]);
      const title = (p.title || '').trim() || prev.title;
      const steps = (p.steps || []).filter((x) => x.text && x.text.trim()).map((x) => {
        const old = x.id && prev.steps.find((st) => st.id === x.id);
        return old ? { ...old, text: x.text.trim() } : { id: L.uid(), text: x.text.trim(), done: false, doneAt: null };
      });
      g.chapters[idx] = { ...prev, title, goal: (p.goal || '').trim(), criterion: (p.criterion || '').trim(), steps };
      return { ok: true };
    },

    /** Steps are ticked independently; finishing a chapter stays a manual decision. */
    chapterToggleStep(sagaId, chId, stepId, forceDone) {
      const g = findG(sagaId);
      const ch = g && g.chapters.find((c) => c.id === chId);
      if (!ch || !Array.isArray(ch.steps)) return { ok: false };
      const st = ch.steps.find((x) => x.id === stepId);
      if (!st) return { ok: false };
      const target = forceDone === undefined ? !st.done : !!forceDone;
      if (target === !!st.done) return { ok: true };
      st.done = target;
      st.doneAt = target ? now() : null;
      if (!target) { revoke('saga-step', stepId); return { ok: true }; }
      const r = gain('saga-step', stepId, `${g.title}: ${st.text}`, L.SAGA_STEP_XP);
      const left = ch.steps.filter((x) => !x.done).length;
      const hint = left ? `осталось шагов: ${left}` : (ch.criterion ? `проверь критерий главы: ${ch.criterion}` : 'все шаги главы сделаны');
      return { ok: true, toast: `Шаг сделан · +${L.SAGA_STEP_XP} XP · ${hint}`, ...r };
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
      if (!g || g.status === 'done' || g.status === 'archived') return { ok: false };
      g.status = g.status === 'paused' ? 'active' : 'paused';
      if (g.status === 'active') g.resumedAt = now(); // resuming resets the reminder cycle
      return { ok: true, toast: g.status === 'paused' ? 'Сага на паузе — напоминаний не будет' : 'Сага снова в пути' };
    },

    /**
     * Start a session with a concrete action.
     * opts.stepId: a step id, 'none' (just practise), or undefined (suggested next step)
     * opts.min: planned length (a guide, not a timer to sit out); opts.typeId: session type
     */
    sagaStartSession(id, opts = {}) {
      const s = S();
      const g = findG(id);
      if (!g || g.status === 'done' || g.status === 'archived') return { ok: false, error: 'Сага не активна' };
      if (g.status === 'paused') { g.status = 'active'; g.resumedAt = now(); }
      const v = L.sagaView(s, g, now());
      const ch = v.current;
      let step = null;
      if (opts.stepId && opts.stepId !== 'none') step = ch && ch.steps.find((st) => st.id === opts.stepId && !st.done) || null;
      else if (opts.stepId === undefined) step = v.nextStep;
      const min = Math.max(1, Math.min(240, +opts.min || v.suggestedMin));
      if (opts.min) g.lastPlannedMin = min;
      const typeId = opts.typeId !== undefined ? opts.typeId : v.lastTypeId;
      if (typeId && v.types.some((t) => t.id === typeId)) g.lastTypeId = typeId;
      let q = v.openQuestId && findQ(v.openQuestId);
      if (!q) {
        q = { id: L.uid(), notes: '', kind: 'main', steps: [], status: 'today', createdAt: now(), doneAt: null, doneDay: null, focusSec: 0, sagaId: g.id };
        s.quests.unshift(q);
      }
      Object.assign(q, {
        title: ch ? `${g.title} · ${ch.title}` : g.title, area: g.area, estimateMin: min,
        nextStep: step ? step.text : (ch ? `Любое полезное действие по главе «${ch.title}»` : 'Позанимайся по саге'),
        chapterId: ch ? ch.id : null, sagaStepId: step ? step.id : null, sagaTypeId: typeId || null,
      });
      const r = A.questStart(q.id);
      return { ...r, toast: `Сессия ~${min} мин: ${q.nextStep}` };
    },

    /** A session done outside the app. Real duration is required. opId guards against double submit. */
    sagaLogSession(id, p = {}) {
      const s = S();
      const g = findG(id);
      if (!g) return { ok: false };
      const min = Math.round(+p.min);
      if (!(min > 0)) return { ok: false, error: 'Укажи, сколько минут длилось занятие' };
      if (p.opId && s.sagaLog.some((e) => e.opId === p.opId)) return { ok: true }; // duplicate submit
      const v = L.sagaView(s, g, now());
      const entry = {
        id: L.uid(), opId: p.opId || null, sagaId: id, chapterId: v.current ? v.current.id : null, at: now(),
        min: Math.min(min, 600), estimated: false, manual: true, typeId: p.typeId || null,
        stepId: null, stepDone: false, note: (p.note || '').trim().slice(0, 280), wrapped: true,
      };
      s.sagaLog.push(entry);
      if (p.typeId && v.types.some((t) => t.id === p.typeId)) g.lastTypeId = p.typeId;
      let r = gain('saga-session', entry.id, `${g.title}: занятие ${entry.min} мин`, L.SAGA_SESSION_XP);
      if (p.stepId && v.current) {
        const st = v.current.steps.find((x) => x.id === p.stepId);
        if (st) {
          entry.stepId = st.id; entry.stepDone = true;
          const rs = A.chapterToggleStep(id, v.current.id, st.id, true);
          r = { ...r, levelUp: r.levelUp || rs.levelUp };
        }
      }
      return { ok: true, toast: `Занятие записано · ${entry.min} мин · ${v.weekSessions + 1}/${v.target} на неделе`, ...r };
    },

    /** After a session: optionally tick the step that was done and keep a short note. */
    sagaSessionWrap(logId, p = {}) {
      const s = S();
      const e = s.sagaLog.find((x) => x.id === logId);
      if (!e) return { ok: false };
      const g = findG(e.sagaId);
      let r = {};
      if (p.stepId && g) {
        const ch = g.chapters.find((c) => (c.steps || []).some((st) => st.id === p.stepId));
        if (ch) {
          r = A.chapterToggleStep(g.id, ch.id, p.stepId, true);
          e.stepId = p.stepId; e.stepDone = true;
        }
      }
      if (typeof p.note === 'string') e.note = p.note.trim().slice(0, 280);
      e.wrapped = true;
      return { ok: true, toast: e.stepDone ? (r.toast || 'Шаг отмечен') : 'Сессия записана', levelUp: r.levelUp };
    },

    sagaToggleChapter(id, chId) {
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
