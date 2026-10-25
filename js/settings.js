'use strict';
// Настройки для экспериментов: панель с ползунками (клавиша O). Значения лежат в AK.S, отрисовка читает их
// каждый кадр, так что всё меняется на лету; выбор запоминается в браузере.
(function (AK) {
  const { clamp } = AK.U;
  const KEY = 'arkanoid-gl.settings';
  const DEFS = [
    { id: 'ballLight', label: 'свет мяча на поле', def: 0, max: 1.5, note: 'при глобальном освещении (L)' },
    { id: 'ballHalo', label: 'ореол мяча', def: 0, max: 2 },
    { id: 'ballTrail', label: 'шлейф мяча', def: 1, max: 2 },
    { id: 'ballBright', label: 'яркость мяча', def: 1, min: 0.3, max: 1, note: 'ниже 65% гаснет bloom вокруг' },
  ];
  const S = {};
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { saved = {}; }
  for (const d of DEFS) {
    const v = saved[d.id];
    S[d.id] = typeof v === 'number' && isFinite(v) ? clamp(v, d.min || 0, d.max) : d.def;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* без хранилища — до перезагрузки */ } }

  // ---- Панель ----
  const panel = document.createElement('div');
  panel.id = 'settings';
  panel.className = 'hidden';
  panel.innerHTML = '<h3>НАСТРОЙКИ</h3>';
  const rows = DEFS.map(d => {
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = `<span>${d.label}</span><input type="range" min="${(d.min || 0) * 100}" max="${d.max * 100}" step="5"><b></b>` +
      (d.note ? `<small>${d.note}</small>` : '');
    const inp = row.querySelector('input'), out = row.querySelector('b');
    const show = () => { inp.value = Math.round(S[d.id] * 100); out.textContent = inp.value + '%'; };
    inp.addEventListener('input', () => { S[d.id] = inp.value / 100; out.textContent = inp.value + '%'; save(); });
    inp.addEventListener('change', () => inp.blur()); // стрелки снова двигают ракетку, а не ползунок
    panel.appendChild(row);
    show();
    return show;
  });
  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.innerHTML = '<button type="button">по умолчанию</button><span><kbd>O</kbd> закрыть</span>';
  foot.querySelector('button').addEventListener('click', e => {
    for (const d of DEFS) S[d.id] = d.def;
    rows.forEach(f => f());
    save();
    e.currentTarget.blur();
  });
  panel.appendChild(foot);
  document.getElementById('wrap').appendChild(panel);

  AK.S = S;
  AK.Settings = {
    get open() { return !panel.classList.contains('hidden'); },
    toggle(on = !this.open) { panel.classList.toggle('hidden', !on); return on; },
  };
})(window.AK);
