'use strict';
const fs = require('fs');
const path = require('path');
const { defaultState } = require('../shared/logic');

class Store {
  constructor(dir) {
    this.file = path.join(dir, 'questbook.json');
    this.backup = path.join(dir, 'questbook.backup.json');
    this.state = this.load();
    this.timer = null;
  }

  load() {
    for (const f of [this.file, this.backup]) {
      try {
        const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
        return migrate(raw);
      } catch (_) { /* try next */ }
    }
    return defaultState();
  }

  /** Debounced atomic save (write tmp + rename), daily backup copy. */
  save(immediate = false) {
    clearTimeout(this.timer);
    const run = () => {
      const tmp = this.file + '.tmp';
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 1));
      if (fs.existsSync(this.file)) {
        try {
          const st = fs.statSync(this.backup);
          if (Date.now() - st.mtimeMs > 6 * 3600000) fs.copyFileSync(this.file, this.backup);
        } catch (_) { fs.copyFileSync(this.file, this.backup); }
      }
      fs.renameSync(tmp, this.file);
    };
    if (immediate) run(); else this.timer = setTimeout(run, 300);
  }
}

function migrate(s) {
  const d = defaultState();
  s.settings = { ...d.settings, ...(s.settings || {}) };
  s.meta = { ...d.meta, ...(s.meta || {}) };
  for (const k of ['quests', 'habits', 'log', 'sagas', 'sagaLog']) if (!Array.isArray(s[k])) s[k] = [];
  for (const k of ['habitLog', 'fired']) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
  if (!s.player) s.player = { xp: 0 };
  s.version = 1;
  return s;
}

module.exports = { Store, migrate };
