'use strict';
// Настройки для экспериментов: панель с ползунками и качеством картинки (клавиша O). Значения лежат в AK.S,
// отрисовка читает их каждый кадр, так что всё меняется на лету; выбор запоминается в браузере.
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
  // Качество: свет (gi.js), разрешение рисунка — пикселей на точку экрана (main.js) — и сглаживание (renderer.js).
  // При «авто» main.js сам снижает их, если видеокарта не успевает, и сообщает сюда (sync), на чём остановился;
  // выбор вручную выключает авто
  const GI_Q = [['high', 'высокое'], ['medium', 'среднее'], ['low', 'низкое'], ['off', 'выкл']];
  const RES = [[2, '×2'], [1.5, '×1.5'], [1, '×1'], [0.75, '×0.75'], [0.5, '×0.5']];
  const AA = [[1, 'вкл'], [0, 'выкл']];
  const QDEF = { qAuto: true, giQ: 'high', res: 2, aa: 1 };
  S.qAuto = saved.qAuto !== false;
  S.giQ = GI_Q.some(q => q[0] === saved.giQ) ? saved.giQ : QDEF.giQ;
  S.res = RES.some(r => r[0] === saved.res) ? saved.res : QDEF.res;
  S.aa = AA.some(a => a[0] === saved.aa) ? saved.aa : QDEF.aa;
  const cur = { giQ: S.giQ, res: S.res, aa: S.aa }; // что стоит на самом деле
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
  const qual = document.createElement('div');
  qual.className = 'qual';
  const seg = (k, label, list) => `<div class="seg" data-k="${k}"><span>${label}</span>` +
    list.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join('') + '</div>';
  qual.innerHTML = '<label class="chk"><input type="checkbox"><span>качество — авто</span></label>' +
    '<small>само снижает, если видеокарта не успевает</small>' +
    seg('giQ', 'свет', GI_Q) + seg('res', 'разрешение', RES) + seg('aa', 'сглаживание', AA) +
    '<small>свет — глобальное освещение (L); разрешение — пикселей на точку экрана, ×2 и ×1.5 — на экранах ' +
    'с масштабом</small>';
  const chk = qual.querySelector('input');
  function showQ() {
    chk.checked = S.qAuto;
    qual.classList.toggle('auto', S.qAuto);
    for (const b of qual.querySelectorAll('button')) {
      const k = b.parentNode.dataset.k;
      b.classList.toggle('on', String(cur[k]) === b.dataset.v);
    }
  }
  const setQ = () => { save(); showQ(); if (AK.Settings.onQuality) AK.Settings.onQuality(); };
  chk.addEventListener('change', () => { S.qAuto = chk.checked; setQ(); chk.blur(); });
  qual.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const k = b.parentNode.dataset.k;
    if (S.qAuto) Object.assign(S, cur); // из авто в ручное — от того, что стоит сейчас, а не от прошлого выбора
    S.qAuto = false; S[k] = k === 'giQ' ? b.dataset.v : +b.dataset.v;
    setQ(); b.blur();
  });
  panel.appendChild(qual);
  showQ();

  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.innerHTML = '<button type="button">по умолчанию</button><span><kbd>O</kbd> закрыть</span>';
  foot.querySelector('button').addEventListener('click', e => {
    for (const d of DEFS) S[d.id] = d.def;
    Object.assign(S, QDEF);
    rows.forEach(f => f());
    setQ();
    e.currentTarget.blur();
  });
  panel.appendChild(foot);
  document.getElementById('wrap').appendChild(panel);

  AK.S = S;
  AK.Settings = {
    get open() { return !panel.classList.contains('hidden'); },
    toggle(on = !this.open) { panel.classList.toggle('hidden', !on); return on; },
    onQuality: null, // main.js: применить качество из S
    sync(giQ, res, aa) { cur.giQ = giQ; cur.res = res; cur.aa = aa; showQ(); }, // что стоит на самом деле
  };
})(window.AK);
