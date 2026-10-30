'use strict';
// Глобальное освещение методом radiance cascades (каскады излучения, А. Санников).
// Сцена освещения рисуется в низком разрешении: rgb — излучение, альфа — заслонка. Jump flooding строит по
// ней поле расстояний до ближайшей поверхности, по которому лучи шагают большими прыжками. Дальше каскады:
// зонды нулевого каскада стоят в каждом текселе и смотрят в 4 стороны на 1 тексель; у каждого следующего
// зонды вдвое реже, направлений вчетверо больше, а отрезок луча вчетверо длиннее — так ближний свет
// считается подробно в пространстве, а дальний — подробно по углу. Слияние сверху вниз (с «билинейной
// поправкой»: луч тянется к каждому из четырёх соседних зондов верхнего каскада) даёт в каждом текселе
// свет, пришедший со всех сторон, — с мягкими тенями и цветными отсветами от всего, что светится.
// Внутрь заслонок свет «затекает» нормированным размытием: так освещаются сами кирпичи и ракетка.
// Мячи в растр не рисуются: маленький яркий диск ловится дискретным числом лучей, и при сдвиге мяча на долю
// текселя свет вокруг мерцал бы на десятки процентов. Вместо этого каждый луч — конус своего направления,
// и для мяча считается точная доля конуса, которую он закрывает: свет меняется плавно. Так же считаются
// прожекторы на стенах, только они прозрачные и светят лишь в свой конус: луч, пришедший к прожектору
// не из этого конуса, света от него не получает.
(function (AK) {
  const GI = { ready: false, quality: 'high', light: null, scene: null, w: 0, h: 0, cascades: 0 };
  // Качество (main.js понижает его, если видеокарта не успевает): разрешение света, кратно 2^(каскадов-1),
  // пропорции поля 3:4
  const QUALITY = { high: [384, 512], medium: [288, 384], low: [192, 256] };
  const R0 = 1;          // длина отрезка луча нулевого каскада, текселей
  const SEED_THR = 0.2;  // с какой яркости излучатель считается поверхностью, на которой луч останавливается
  const BLUR_R = 12;     // радиус нормированного размытия (σ = 5 текселей)
  const MAXS = 16;       // источников-дисков, которые считаются аналитически; остальные рисуются в растр

  const FS_SEED = `#version 300 es
  precision highp float;
  uniform sampler2D u_scene; uniform float u_thr;
  out vec4 o;
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 s = texelFetch(u_scene, p, 0);
    bool surf = s.a > 0.5 || max(s.r, max(s.g, s.b)) > u_thr;
    o = surf ? vec4(vec2(p) + 0.5, 0.0, 1.0) : vec4(0.0);
  }`;

  // Шаг jump flooding: из 9 кандидатов на расстоянии u_step берём ближайшую поверхность.
  const FS_JFA = `#version 300 es
  precision highp float;
  uniform sampler2D u_tex; uniform int u_step; uniform ivec2 u_size;
  out vec4 o;
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec2 fp = vec2(p) + 0.5;
    vec4 best = texelFetch(u_tex, p, 0);
    float bd = best.w > 0.5 ? dot(best.xy - fp, best.xy - fp) : 1e20;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      ivec2 q = p + ivec2(x, y) * u_step;
      if (q.x < 0 || q.y < 0 || q.x >= u_size.x || q.y >= u_size.y) continue;
      vec4 s = texelFetch(u_tex, q, 0);
      if (s.w < 0.5) continue;
      vec2 d = s.xy - fp;
      float dd = dot(d, d);
      if (dd < bd) { bd = dd; best = s; }
    }
    o = best;
  }`;

  // Какие источники вообще могут попасть на отрезки зонда каскада u_n: кольцо [t0, t1] вокруг него с запасом
  // на изгиб лучей поправкой; прожектор — только если зонд в его конусе. Это зависит лишь от зонда, а в
  // каскаде каждый зонд повторяется в 4^n блоках направлений, поэтому маска считается заранее, по текселю
  // на зонд. 16 бит маски — в r и g по 8 (точно для half float).
  const FS_NEAR = `#version 300 es
  precision highp float; precision highp int;
  uniform int u_n; uniform float u_r0;
  uniform int u_ns; uniform vec3 u_src[${MAXS}]; uniform vec4 u_sdir[${MAXS}];
  out vec4 o;
  void main() {
    float sp = float(1 << u_n);
    vec2 probe = (floor(gl_FragCoord.xy) + 0.5) * sp;
    float p4 = pow(4.0, float(u_n));
    float t0 = u_r0 * (p4 - 1.0) / 3.0, t1 = u_r0 * (p4 * 4.0 - 1.0) / 3.0;
    float slack = 3.0 * sp + 1.0;
    int near = 0;
    for (int i = 0; i < ${MAXS}; i++) {
      if (i >= u_ns) break;
      vec2 v = probe - u_src[i].xy;
      float D = length(v), r = abs(u_src[i].z);
      if (D + r <= t0 - slack || D - r >= t1 + slack) continue;
      vec4 sd = u_sdir[i];
      if (sd.z >= -1.0 && D > r + slack && dot(v, sd.xy) < (sd.z - (r + slack) / D) * D) continue;
      near |= 1 << i;
    }
    o = vec4(float(near & 255), float(near >> 8), 0.0, 1.0);
  }`;

  // Один каскад: трассировка своих лучей и слияние с уже посчитанным каскадом выше. Каскад хранится
  // «предусреднённым»: в текселе — среднее по четырём своим направлениям, которые сливаются в одно
  // направление каскада ниже. Тогда слияние читает один тексель на зонд, текстуры каскадов — размером
  // с сам свет, а нулевой каскад сразу даёт освещённость (среднее по всем направлениям).
  // Раскладка «сначала направление»: текстура разбита на блоки по направлениям, в блоке — сетка зондов.
  const FS_CASC = `#version 300 es
  precision highp float; precision highp int;
  uniform sampler2D u_jfa; uniform sampler2D u_scene; uniform sampler2D u_up; uniform sampler2D u_near;
  uniform ivec2 u_size; uniform int u_n; uniform int u_top; uniform float u_r0; uniform vec3 u_sky;
  // источники-диски: центр и радиус в текселях (радиус < 0 — прозрачный источник), излучение и направленность:
  // xy — ось конуса, z и w — косинусы его внешнего и внутреннего края (z < -1 — светит во все стороны)
  uniform vec3 u_src[${MAXS}]; uniform vec3 u_scol[${MAXS}]; uniform vec4 u_sdir[${MAXS}];
  out vec4 o;
  const float PI = 3.14159265359, TAU = 6.28318530718;

  // rgb — свет, собранный на отрезке a→b; a — прозрачность (1, если луч ни во что не упёрся).
  // Луч — конус с полушириной h (радиан), который начался за t0 текселей до a; bm — битовая маска мячей,
  // которые могут в него попасть.
  vec4 march(vec2 a, vec2 b, float h, float t0, int bm) {
    vec2 dl = b - a;
    float len = length(dl);
    if (len < 1e-4) return vec4(0.0, 0.0, 0.0, 1.0);
    vec2 dir = dl / len, sz = vec2(u_size);
    // растровая сцена: поле расстояний
    float t = 0.0, tHit = len;
    vec3 hitE = vec3(0.0);
    bool hit = false;
    for (int i = 0; i < 40; i++) {
      vec2 p = a + dir * t;
      if (p.x < 0.0 || p.y < 0.0 || p.x >= sz.x || p.y >= sz.y) break;
      vec4 s = texelFetch(u_jfa, ivec2(p), 0);
      float d = s.w > 0.5 ? length(s.xy - p) : 1e4;
      if (d < 1.0) {
        // на сглаженном краю излучение домножено на покрытие — берём излучение самого материала
        vec4 e = texelFetch(u_scene, ivec2(s.xy), 0);
        hitE = e.rgb / max(e.a, 0.25); tHit = t; hit = true;
        break;
      }
      t += max(d - 0.75, 0.5);
      if (t >= len) break;
    }
    // Источники-диски. cv — доля конуса, которую закрывает диск; считаем её вдоль самого луча (с поправкой
    // он чуть повёрнут) — тогда на стыке с каскадом выше ширина нашего конуса равна суммарной ширине его
    // четырёх. Кому из каскадов достаётся диск, решаем не скачком, а по доле его протяжённости вдоль луча,
    // попавшей на наш отрезок (у непрозрачного — делённой на то, что не забрали каскады ниже): в сумме
    // выходит ровно cv, без разрывов.
    vec3 rad = vec3(0.0);
    float T = 1.0;
    vec2 apex = a - dir * t0;
    float end = min(len, tHit);
    for (int i = 0; i < ${MAXS}; i++) {
      if ((bm >> i) == 0) break;
      if (((bm >> i) & 1) == 0) continue;
      float r = abs(u_src[i].z);
      bool opaque = u_src[i].z > 0.0;
      vec4 sd = u_sdir[i];
      float sp = sd.z < -1.0 ? 1.0 : smoothstep(sd.z, sd.w, -dot(dir, sd.xy)); // свет идёт к зонду, против луча
      if (sp <= 0.0 && !opaque) continue;
      float tc = dot(u_src[i].xy - a, dir);
      if (tc - r >= end || tc + r <= 0.0) continue; // диск целиком за концом отрезка или до его начала
      float wb = u_n == 0 ? 0.0 : clamp((r - tc) / (2.0 * r), 0.0, 1.0); // доля до начала отрезка
      float we = clamp((end - tc + r) / (2.0 * r), 0.0, 1.0);             // до конца отрезка
      vec2 cq = u_src[i].xy - apex;
      float D = length(cq), cr = cq.x * dir.y - cq.y * dir.x, cd = dot(cq, dir), cv = 1.0;
      if (D > r || !opaque) {
        if (D > r && cd > 0.0 && abs(cr) > r + D * h) continue; // ось проходит дальше, чем достаёт конус
        float al = D > r ? asin(r / D) : 0.5 * PI;              // угловой радиус диска
        float dd = D > 1e-4 ? atan(cr, cd) : 0.0;               // и угол его центра от оси
        cv = max(0.0, min(h, dd + al) - max(-h, dd - al)) / (2.0 * h);
        // Внутри прозрачного диска покрытие плавно доходит до полного к центру. Иначе на краю скачок: снаружи
        // диск виден лишь в половине направлений, а внутри сразу во всех.
        if (D <= r) cv = mix(1.0, cv, D / r);
      }
      if (!opaque) { rad += T * (we - wb) * cv * sp * u_scol[i]; continue; }
      float c = (we - wb) * cv / max(1.0 - wb * cv, 1e-3);
      rad += T * c * sp * u_scol[i];
      T *= 1.0 - c;
    }
    return hit ? vec4(rad + T * hitE, 0.0) : vec4(rad, T);
  }

  void main() {
    ivec2 tc = ivec2(gl_FragCoord.xy);
    int sp = 1 << u_n;                      // шаг зондов, текселей; столько же блоков по стороне текстуры
    ivec2 pg = u_size / sp;
    ivec2 blk = tc / pg, pi = tc - blk * pg;
    int dp = blk.y * sp + blk.x;            // направление каскада ниже, в которое сольются наши четыре
    float nd = float(4 << (2 * u_n));       // своих направлений: 4^(n+1)
    vec2 probe = (vec2(pi) + 0.5) * float(sp);
    float p4 = pow(4.0, float(u_n));
    float t0 = u_r0 * (p4 - 1.0) / 3.0, t1 = u_r0 * (p4 * 4.0 - 1.0) / 3.0;
    // четыре соседних зонда каскада выше и их билинейные веса
    int sp1 = sp * 2;
    ivec2 pg1 = u_size / sp1;
    vec2 g = probe / float(sp1) - 0.5;
    vec2 bf = floor(g), f = g - bf;
    ivec2 b0 = ivec2(bf);
    // Какие источники могут попасть на отрезки этого зонда (см. FS_NEAR), и какие из них лежат близко
    // к оси каждого направления; slack — запас на изгиб лучей поправкой.
    float slack = 1.5 * float(sp1) + 1.0;
    ivec2 nm = ivec2(texelFetch(u_near, pi, 0).rg);
    int near = nm.x | (nm.y << 8);
    vec3 sum = vec3(0.0);
    for (int c = 0; c < 4; c++) {
      int d = dp * 4 + c;
      float ang = TAU * (float(d) + 0.5) / nd;
      vec2 dir = vec2(cos(ang), sin(ang));
      vec2 a = probe + dir * t0;
      float h = PI / nd;
      int bm = 0;
      for (int i = 0; i < ${MAXS}; i++) {
        if ((near >> i) == 0) break;
        if (((near >> i) & 1) == 0) continue;
        vec2 cp = u_src[i].xy - probe;
        float r = abs(u_src[i].z) + slack;
        if (dot(cp, dir) > -r && abs(cp.x * dir.y - cp.y * dir.x) < r + length(cp) * h) bm |= 1 << i;
      }
      if (u_top == 1) {
        vec4 r = march(a, probe + dir * t1, h, t0, bm);
        sum += r.rgb + r.a * u_sky;
        continue;
      }
      // «билинейная поправка»: луч тянется к концу отрезка каждого из соседних зондов выше.
      // Без неё вокруг маленьких ярких источников на границах каскадов проступают кольца.
      ivec2 ub = ivec2(d % sp1, d / sp1) * pg1;
      for (int k = 0; k < 4; k++) {
        ivec2 off = ivec2(k & 1, k >> 1);
        ivec2 q = clamp(b0 + off, ivec2(0), pg1 - 1);
        vec2 w2 = mix(1.0 - f, f, vec2(off));
        vec4 r = march(a, (vec2(q) + 0.5) * float(sp1) + dir * t1, h, t0, bm);
        vec3 up = r.a > 0.0 ? texelFetch(u_up, ub + q, 0).rgb : vec3(0.0);
        sum += w2.x * w2.y * (r.rgb + r.a * up);
      }
    }
    o = vec4(sum * 0.25, 1.0);
  }`;

  // Освещённость из нулевого каскада. Для нормированного размытия сразу домножаем на «свободно»
  // (1 − заслонка) и кладём его в альфу.
  const FS_FLU = `#version 300 es
  precision highp float;
  uniform sampler2D u_c0; uniform sampler2D u_scene;
  out vec4 o;
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    float free = 1.0 - clamp(texelFetch(u_scene, p, 0).a, 0.0, 1.0);
    o = vec4(texelFetch(u_c0, p, 0).rgb * free, free);
  }`;

  const FS_BLUR = `#version 300 es
  precision highp float;
  uniform sampler2D u_tex; uniform ivec2 u_dir; uniform ivec2 u_size;
  out vec4 o;
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 s = vec4(0.0);
    for (int i = -${BLUR_R}; i <= ${BLUR_R}; i++) {
      ivec2 q = clamp(p + u_dir * i, ivec2(0), u_size - 1);
      s += exp(-float(i * i) / 50.0) * texelFetch(u_tex, q, 0);
    }
    o = s;
  }`;

  // Снаружи заслонок — посчитанная освещённость, внутри — средняя освещённость вокруг (размытая по свободным пикселям).
  const FS_MIX = `#version 300 es
  precision highp float;
  uniform sampler2D u_flu; uniform sampler2D u_blur;
  out vec4 o;
  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    vec4 f = texelFetch(u_flu, p, 0), b = texelFetch(u_blur, p, 0);
    vec3 inside = b.a > 1e-5 ? b.rgb / b.a : vec3(0.0);
    o = vec4(f.rgb + (1.0 - f.a) * inside, 1.0);
  }`;

  // Отладка: показать промежуточную текстуру на весь экран
  const FS_SHOW = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 o;
  uniform sampler2D u_tex; uniform int u_mode; uniform float u_exp; uniform vec2 u_size;
  void main() {
    vec4 s = texture(u_tex, v_uv);
    vec3 c = u_mode == 2 ? vec3(s.a) : u_mode == 3 ? vec3(s.w > 0.5 ? length(s.xy - v_uv * u_size) / 64.0 : 1.0) : s.rgb * u_exp;
    o = vec4(c / (1.0 + c), 1.0);
  }`;

  let gl, full, T = null;
  const P = {};

  function tex(w, h, linear) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const f = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('GI: float-цель недоступна');
    return { tex: t, fb, w, h };
  }
  function to(t) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); gl.viewport(0, 0, t.w, t.h); }
  function src(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t.tex); }
  function use(p) { gl.useProgram(p.p); return p.u; }

  GI.init = function (ctx, program, fullFn, vsFull) {
    gl = ctx; full = fullFn;
    P.seed = program(vsFull, FS_SEED);
    P.jfa = program(vsFull, FS_JFA);
    P.near = program(vsFull, FS_NEAR);
    P.casc = program(vsFull, FS_CASC);
    P.flu = program(vsFull, FS_FLU);
    P.blur = program(vsFull, FS_BLUR);
    P.mix = program(vsFull, FS_MIX);
    P.show = program(vsFull, FS_SHOW);
    GI.setQuality(GI.quality);
    GI.ready = true;
  };

  GI.setQuality = function (q) {
    if (T) for (const k in T) { gl.deleteTexture(T[k].tex); gl.deleteFramebuffer(T[k].fb); }
    const [w, h] = QUALITY[q];
    GI.quality = q; GI.w = w; GI.h = h;
    // каскадов столько, чтобы самый дальний доставал через всю диагональ
    let n = 1;
    while ((R0 * (Math.pow(4, n) - 1)) / 3 < Math.hypot(w, h)) n++;
    GI.cascades = n;
    T = {
      scene: tex(w, h, false), jfaA: tex(w, h, false), jfaB: tex(w, h, false),
      cA: tex(w, h, false), cB: tex(w, h, false), near: tex(w, h, false),
      flu: tex(w, h, false), blA: tex(w, h, false), blB: tex(w, h, false),
      light: tex(w, h, true),
    };
    GI.scene = T.scene; GI.light = T.light;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  // Источники-диски на этот кадр: координаты в текселях сцены освещения. false — мест нет, рисуй в растр.
  // Прожектор: ax, ay — ось (единичная), cosOut и cosIn — косинусы внешнего и внутреннего края конуса.
  const srcPos = new Float32Array(MAXS * 3), srcCol = new Float32Array(MAXS * 3), srcDir = new Float32Array(MAXS * 4);
  GI.ns = 0;
  GI.addLight = function (x, y, r, er, eg, eb, opaque, ax, ay, cosOut, cosIn) {
    if (GI.ns >= MAXS) return false;
    const k = GI.ns, i = k * 3, j = k * 4;
    GI.ns++;
    srcPos[i] = x; srcPos[i + 1] = y; srcPos[i + 2] = opaque ? r : -r;
    srcCol[i] = er; srcCol[i + 1] = eg; srcCol[i + 2] = eb;
    if (cosOut === undefined) { srcDir[j] = 0; srcDir[j + 1] = 0; srcDir[j + 2] = -2; srcDir[j + 3] = -1; }
    else { srcDir[j] = ax; srcDir[j + 1] = ay; srcDir[j + 2] = cosOut; srcDir[j + 3] = cosIn; }
    return true;
  };

  GI.compute = function (sky) {
    const w = GI.w, h = GI.h;
    let u;
    // поверхности
    u = use(P.seed); to(T.jfaA); src(0, T.scene);
    gl.uniform1i(u.u_scene, 0); gl.uniform1f(u.u_thr, SEED_THR);
    full();
    // jump flooding
    u = use(P.jfa); gl.uniform1i(u.u_tex, 0); gl.uniform2i(u.u_size, w, h);
    let a = T.jfaA, b = T.jfaB;
    for (let st = 1 << Math.ceil(Math.log2(Math.max(w, h)) - 1); st >= 1; st >>= 1) {
      to(b); src(0, a); gl.uniform1i(u.u_step, st); full();
      [a, b] = [b, a];
    }
    const jfa = a;
    // каскады сверху вниз; перед каждым — маска источников для его зондов
    const un = use(P.near);
    gl.uniform1f(un.u_r0, R0); gl.uniform1i(un.u_ns, GI.ns);
    gl.uniform3fv(un.u_src, srcPos); gl.uniform4fv(un.u_sdir, srcDir);
    u = use(P.casc);
    gl.uniform1i(u.u_jfa, 0); gl.uniform1i(u.u_scene, 1); gl.uniform1i(u.u_up, 2); gl.uniform1i(u.u_near, 3);
    gl.uniform2i(u.u_size, w, h); gl.uniform1f(u.u_r0, R0); gl.uniform3fv(u.u_sky, sky);
    gl.uniform3fv(u.u_src, srcPos); gl.uniform3fv(u.u_scol, srcCol); gl.uniform4fv(u.u_sdir, srcDir);
    src(0, jfa); src(1, T.scene);
    let cur = T.cA, up = T.cB;
    for (let n = GI.cascades - 1; n >= 0; n--) {
      use(P.near);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.near.fb); gl.viewport(0, 0, w >> n, h >> n);
      gl.uniform1i(un.u_n, n);
      full();
      use(P.casc);
      to(cur); src(2, up); src(3, T.near);
      gl.uniform1i(u.u_n, n); gl.uniform1i(u.u_top, n === GI.cascades - 1 ? 1 : 0);
      full();
      [cur, up] = [up, cur];
    }
    const c0 = up;
    // освещённость и свет внутри заслонок
    u = use(P.flu); to(T.flu); src(0, c0); src(1, T.scene);
    gl.uniform1i(u.u_c0, 0); gl.uniform1i(u.u_scene, 1);
    full();
    u = use(P.blur); gl.uniform1i(u.u_tex, 0); gl.uniform2i(u.u_size, w, h);
    to(T.blA); src(0, T.flu); gl.uniform2i(u.u_dir, 1, 0); full();
    to(T.blB); src(0, T.blA); gl.uniform2i(u.u_dir, 0, 1); full();
    u = use(P.mix); to(T.light); src(0, T.flu); src(1, T.blB);
    gl.uniform1i(u.u_flu, 0); gl.uniform1i(u.u_blur, 1);
    full();
    GI.jfa = jfa;
  };

  // Отладочный вывод на экран: mode 0 — свет, 1 — излучение сцены, 2 — заслонки, 3 — поле расстояний
  GI.show = function (mode, exposure) {
    const u = use(P.show);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    src(0, mode === 0 ? T.light : mode === 3 ? GI.jfa : T.scene);
    gl.uniform1i(u.u_tex, 0); gl.uniform1i(u.u_mode, mode); gl.uniform1f(u.u_exp, exposure || 1);
    gl.uniform2f(u.u_size, GI.w, GI.h);
    full();
  };

  AK.GI = GI;
})(window.AK);
