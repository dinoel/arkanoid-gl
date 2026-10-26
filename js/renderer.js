'use strict';
// WebGL2-рендерер: пакетная отрисовка треугольников (сплошные, мягкие спрайты, AA-диски, шаровое
// затенение), процедурный фон, глобальное освещение (gi.js), HDR-bloom в два уровня и финальный композит.
(function (AK) {
  const W = 720, H = 960;
  const R = { W, H, ok: false };
  const MAX_TOP = 12; // прожекторов, которые светят на верх кирпичей
  const TOP_H = 60;   // на сколько px лампы выше верха кирпичей
  const TOP_K = 0.7;  // доля света на верх: светлый кирпич не должен пересвечиваться до белого

  const VS_MAIN = `#version 300 es
  layout(location=0) in vec2 a_pos;
  layout(location=1) in vec4 a_col;
  layout(location=2) in vec3 a_uv;
  layout(location=3) in vec4 a_lit;
  uniform vec4 u_view;
  out vec4 v_col; out vec3 v_uv; out vec4 v_lit;
  void main() {
    v_col = a_col; v_uv = a_uv; v_lit = a_lit;
    gl_Position = vec4(a_pos * u_view.xy + u_view.zw, 0.0, 1.0);
  }`;

  const FS_MAIN = `#version 300 es
  precision highp float;
  in vec4 v_col; in vec3 v_uv; in vec4 v_lit;
  uniform sampler2D u_light; uniform vec2 u_res; uniform vec3 u_amb; uniform float u_gi;
  // прожекторы для верха кирпичей: xy — источник (px поля со встряской), z — его радиус; xy — ось луча,
  // zw — косинусы внешнего и внутреннего края конуса; излучение
  uniform int u_ns; uniform vec3 u_sp[${MAX_TOP}]; uniform vec4 u_sd[${MAX_TOP}]; uniform vec3 u_sc[${MAX_TOP}];
  out vec4 o;
  float lum(vec3 c) { return dot(c, vec3(0.3, 0.5, 0.2)); }
  // Прямой свет прожекторов на верх кирпича. На пол свет считают каскады, и кирпич его заслоняет; но лампы
  // висят выше кирпичей, так что на их верх свет попадает, и друг от друга кирпичи его не загораживают.
  // Считаем, как каскады на полу: диск источника виден под долей направлений ≈ r / πD, — только расстояние
  // берём с высотой лампы над кирпичом и света даём меньше (TOP_K): кирпичи светлее пола и иначе выгорают
  // до белого. n — нормаль фаски (0 — сама грань): обращённая к лампе светлее.
  vec3 topLight(vec2 p, vec2 n) {
    vec3 s = vec3(0.0);
    for (int i = 0; i < ${MAX_TOP}; i++) {
      if (i >= u_ns) break;
      vec2 d = p - u_sp[i].xy;
      float D = max(length(d), 1e-3);
      float cone = smoothstep(u_sd[i].z, u_sd[i].w, dot(d / D, u_sd[i].xy));
      if (cone <= 0.0) continue;
      float k = cone * ${TOP_K / Math.PI} * u_sp[i].z / sqrt(D * D + ${TOP_H * TOP_H}.0);
      if (n != vec2(0.0)) k *= clamp(0.7 - 0.6 * dot(n, d / D), 0.1, 1.3);
      s += u_sc[i] * k;
    }
    return s;
  }
  vec4 shape() {
    float m = v_uv.z;
    if (m < 0.5) return v_col;
    float d = length(v_uv.xy);
    if (m < 1.5) { float f = clamp(1.0 - d, 0.0, 1.0); return v_col * (f * f); }
    float aa = max(fwidth(d) * 1.25, 1e-4);
    float edge = 1.0 - smoothstep(1.0 - aa, 1.0, d);
    if (m < 2.5) return v_col * edge;
    if (m < 3.5) {
      float z = sqrt(max(0.0, 1.0 - d * d));
      vec3 n = vec3(v_uv.xy, z);
      vec3 L = normalize(vec3(-0.45, -0.6, 0.7));
      float diff = max(dot(n, L), 0.0);
      float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
      float rim = pow(1.0 - z, 2.5);
      vec3 c = v_col.rgb * (0.22 + 0.9 * diff) + vec3(spec) * v_col.a * 1.1 + v_col.rgb * rim * 0.7;
      return vec4(c, v_col.a) * edge;
    }
    // кольцо: uv.xy в [-1,1], толщина задаётся через радиус кольца (m-4)
    float w = m - 4.0;
    float ring = 1.0 - smoothstep(0.0, w, abs(d - (1.0 - w)));
    return v_col * ring;
  }
  void main() {
    vec4 c = shape();
    // Освещаемая поверхность: цвет × (рассеянный + глобальный свет). v_lit.x — доля освещения (остальное —
    // собственное свечение), v_lit.yz — смещение в px, откуда брать свет (фаска смотрит наружу).
    if (u_gi > 0.5 && v_lit.x > 0.0) {
      vec2 uv = gl_FragCoord.xy / u_res + vec2(v_lit.y, -v_lit.z) / vec2(${W}.0, ${H}.0);
      vec3 Lc = texture(u_light, uv).rgb;
      // Фаска (задано смещение наружу): светлее та, что обращена к свету, темнее — отвёрнутая. Откуда свет —
      // по градиенту освещённости, насколько он направленный — по его величине относительно самого света.
      if (v_lit.y != 0.0 || v_lit.z != 0.0) {
        vec2 e = 3.0 / vec2(textureSize(u_light, 0));
        vec2 gd = vec2(lum(texture(u_light, uv + vec2(e.x, 0.0)).rgb) - lum(texture(u_light, uv - vec2(e.x, 0.0)).rgb),
                       lum(texture(u_light, uv - vec2(0.0, e.y)).rgb) - lum(texture(u_light, uv + vec2(0.0, e.y)).rgb));
        float gm = length(gd);
        float dk = clamp(gm / (lum(Lc) + 0.03) * 4.0, 0.0, 1.0);
        if (gm > 1e-6) Lc *= 1.0 + 0.75 * dot(normalize(v_lit.yz), gd / gm) * dk;
      }
      if (v_lit.w > 0.0) {
        vec2 p = vec2(gl_FragCoord.x / u_res.x, 1.0 - gl_FragCoord.y / u_res.y) * vec2(${W}.0, ${H}.0);
        Lc += topLight(p, v_lit.yz != vec2(0.0) ? normalize(v_lit.yz) : vec2(0.0)) * v_lit.w;
      }
      vec3 L = u_amb + Lc;
      L /= 1.0 + L * 0.06; // мягкий предел у самого источника
      c.rgb *= mix(vec3(1.0), L, v_lit.x);
    }
    o = c;
  }`;

  const VS_FULL = `#version 300 es
  layout(location=0) in vec2 a_p;
  out vec2 v_uv;
  void main() { v_uv = a_p * 0.5 + 0.5; gl_Position = vec4(a_p, 0.0, 1.0); }`;

  const FS_BG = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 o;
  uniform float u_time; uniform vec3 u_c1; uniform vec3 u_c2; uniform vec2 u_shake;
  uniform sampler2D u_light; uniform vec2 u_res; uniform vec3 u_amb; uniform float u_gi;
  float lum(vec3 c) { return dot(c, vec3(0.3, 0.5, 0.2)); }
  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += vn(p) * a; p = p * 2.03 + 7.1; a *= 0.5; } return s; }
  void main() {
    vec2 p = vec2(v_uv.x * 720.0, (1.0 - v_uv.y) * 960.0) + u_shake * 0.35;
    float t = u_time;
    vec2 q = p * 0.0032;
    float n = fbm(q + vec2(t * 0.012, -t * 0.02) + fbm(q * 1.7 - t * 0.01));
    vec3 col = mix(u_c1 * 0.025, u_c2 * 0.16, smoothstep(0.35, 0.85, n));
    col += u_c1 * 0.06 * pow(smoothstep(0.55, 0.95, n), 3.0);
    // гекс-сетка
    vec2 g = p / 40.0;
    vec2 r = vec2(1.0, 1.7320508);
    vec2 a = mod(g, r) - r * 0.5, b = mod(g - r * 0.5, r) - r * 0.5;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 ag = abs(gv);
    float hd = max(dot(ag, normalize(vec2(1.0, 1.7320508))), ag.x);
    float line = smoothstep(0.47, 0.5, hd);
    float pulse = 0.5 + 0.5 * sin(p.y * 0.012 - t * 1.3);
    vec2 sc = floor(p / 3.0);
    float s = h21(sc);
    float tw = 0.6 + 0.4 * sin(t * 2.0 + s * 40.0);
    if (u_gi > 0.5) {
      // Пол: тёмные шестигранные плитки с фаской. Направление на свет — по градиенту освещённости:
      // фаска, обращённая к мячу, ловит свет, противоположная уходит в тень.
      vec2 uv = gl_FragCoord.xy / u_res;
      vec3 Lc = texture(u_light, uv).rgb;
      vec2 e = 1.5 / vec2(textureSize(u_light, 0));
      vec2 gd = vec2(lum(texture(u_light, uv + vec2(e.x, 0.0)).rgb) - lum(texture(u_light, uv - vec2(e.x, 0.0)).rgb),
                     lum(texture(u_light, uv - vec2(0.0, e.y)).rgb) - lum(texture(u_light, uv + vec2(0.0, e.y)).rgb));
      float gm = length(gd);
      vec2 ld = gm > 1e-6 ? gd / gm : vec2(0.0);
      float dk = clamp(gm / (lum(Lc) + 0.03) * 2.5, 0.0, 1.0);
      float cell = h21(floor((g - gv) * 2.0 + 0.5));
      vec3 alb = vec3(0.15, 0.155, 0.19) * (0.8 + 0.4 * cell) + mix(u_c1 * 0.02, u_c2 * 0.05, smoothstep(0.35, 0.85, n));
      float bev = smoothstep(0.3, 0.46, hd) * (1.0 - line);
      float facing = dot(gv / max(length(gv), 1e-4), ld) * dk;
      alb *= (1.0 + bev * (1.1 * facing - 0.12)) * (1.0 - 0.65 * line);
      col = alb * (u_amb + Lc);
      // мягкое плечо: тёмные и средние тона как есть, яркие плавно упираются в потолок —
      // пол у самого мяча остаётся градиентом, а не белым пятном, и мяч на нём виден
      float l = lum(col), kn = 0.2, mx = 0.55;
      if (l > kn) col *= (kn + (mx - kn) * (1.0 - exp(-(l - kn) / (mx - kn)))) / l;
      col += u_c2 * line * (0.006 + 0.01 * pulse);
      col += vec3(0.8, 0.9, 1.0) * step(0.9975, s) * tw * 0.25;
      o = vec4(col, 1.0);
      return;
    }
    col += u_c2 * line * (0.025 + 0.03 * pulse);
    // звёзды
    col += vec3(0.8, 0.9, 1.0) * step(0.9975, s) * tw * 0.5;
    // светлое пятно к низу (подсветка ракетки)
    col += u_c2 * 0.05 * exp(-pow((p.y - 960.0) / 260.0, 2.0));
    o = vec4(col, 1.0);
  }`;

  const FS_BRIGHT = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 o;
  uniform sampler2D u_tex; uniform vec2 u_texel; uniform float u_thr;
  void main() {
    vec3 c = texture(u_tex, v_uv + u_texel * vec2(-0.5, -0.5)).rgb + texture(u_tex, v_uv + u_texel * vec2(0.5, -0.5)).rgb
           + texture(u_tex, v_uv + u_texel * vec2(-0.5, 0.5)).rgb + texture(u_tex, v_uv + u_texel * vec2(0.5, 0.5)).rgb;
    c *= 0.25;
    float l = max(c.r, max(c.g, c.b));
    float k = u_thr < 0.0 ? 1.0 : smoothstep(u_thr, u_thr + 0.35, l);
    o = vec4(c * k, 1.0);
  }`;

  const FS_BLUR = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 o;
  uniform sampler2D u_tex; uniform vec2 u_dir;
  void main() {
    vec3 s = texture(u_tex, v_uv).rgb * 0.227027;
    s += (texture(u_tex, v_uv + u_dir * 1.3846).rgb + texture(u_tex, v_uv - u_dir * 1.3846).rgb) * 0.316216;
    s += (texture(u_tex, v_uv + u_dir * 3.2308).rgb + texture(u_tex, v_uv - u_dir * 3.2308).rgb) * 0.070270;
    o = vec4(s, 1.0);
  }`;

  const FS_COMP = `#version 300 es
  precision highp float;
  in vec2 v_uv; out vec4 o;
  uniform sampler2D u_scene; uniform sampler2D u_b1; uniform sampler2D u_b2;
  uniform float u_ab; uniform float u_flash; uniform vec3 u_flashCol;
  void main() {
    vec2 d = v_uv - 0.5;
    float ab = 0.0012 + u_ab * 0.006;
    vec3 c;
    c.r = texture(u_scene, v_uv + d * ab).r;
    c.g = texture(u_scene, v_uv).g;
    c.b = texture(u_scene, v_uv - d * ab).b;
    vec3 bl = texture(u_b1, v_uv).rgb * 0.85 + texture(u_b2, v_uv).rgb * 1.15;
    c += bl;
    c += u_flashCol * u_flash;
    float vig = smoothstep(1.05, 0.3, length(d * vec2(1.1, 0.95)));
    c *= mix(0.6, 1.0, vig);
    c *= 0.97 + 0.03 * sin(gl_FragCoord.y * 3.14159);
    c = c / (1.0 + max(c - 0.9, 0.0) * 0.6); // мягкое ограничение пересветов
    o = vec4(c, 1.0);
  }`;

  let gl, canvas;
  let pMain, pBg, pBright, pBlur, pComp;
  let vao, vbo, fullVao;
  let T = null; // render targets
  let hdr = false;
  const FL = 13, MAXV = 3 * 40000;
  const data = new Float32Array(MAXV * FL);
  let nv = 0;
  let cr = 1, cg = 1, cb = 1, ca = 1;
  let dr = 1, dg = 1, db = 1, da = 1;
  let cl = 0, clx = 0, cly = 0, clt = 0; // освещение текущих примитивов (см. R.lit)
  let uView;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, name); // массив: «u_src[0]» → u.u_src
    }
    return { p, u };
  }

  function target(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } }

  R.init = function (cv) {
    canvas = cv;
    gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false });
    if (!gl) return false;
    hdr = !!gl.getExtension('EXT_color_buffer_float');
    pMain = program(VS_MAIN, FS_MAIN);
    pBg = program(VS_FULL, FS_BG);
    pBright = program(VS_FULL, FS_BRIGHT);
    pBlur = program(VS_FULL, FS_BLUR);
    pComp = program(VS_FULL, FS_COMP);
    uView = pMain.u.u_view;

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    const st = FL * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, st, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, st, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, st, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, st, 36);

    fullVao = gl.createVertexArray();
    gl.bindVertexArray(fullVao);
    const fb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    // глобальное освещение — только при float-целях рендера
    if (hdr && AK.GI) {
      try { AK.GI.init(gl, program, full, VS_FULL); } catch (e) { console.warn('Глобальное освещение недоступно:', e); }
    }
    R.giAvailable = !!(AK.GI && AK.GI.ready);
    R.ok = true;
    return true;
  };

  R.resize = function (pw, ph) {
    if (!R.ok) return;
    canvas.width = pw; canvas.height = ph;
    if (T) for (const k in T) freeTarget(T[k]);
    const w2 = Math.max(1, pw >> 1), h2 = Math.max(1, ph >> 1);
    const w4 = Math.max(1, pw >> 2), h4 = Math.max(1, ph >> 2);
    T = {
      scene: target(pw, ph),
      a1: target(w2, h2), b1: target(w2, h2),
      a2: target(w4, h4), b2: target(w4, h4),
    };
    // MSAA-буфер для сцены (рисуем в него, затем blit в текстуру)
    if (msaa) { gl.deleteRenderbuffer(msaa.rb); gl.deleteFramebuffer(msaa.fb); msaa = null; }
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    if (samples > 1) {
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, hdr ? gl.RGBA16F : gl.RGBA8, pw, ph);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) msaa = { rb, fb, w: pw, h: ph };
      else { gl.deleteRenderbuffer(rb); gl.deleteFramebuffer(fb); }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  let msaa = null;

  function full() { gl.bindVertexArray(fullVao); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  function bindTex(unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
  function to(t) { gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null); gl.viewport(0, 0, t ? t.w : canvas.width, t ? t.h : canvas.height); }

  // ---- Глобальное освещение ----
  // R.gi — считается ли свет в этом кадре; R.giOn — выбор игрока; R.amb — рассеянный свет, который есть везде.
  R.gi = false; R.giOn = true; R.giAvailable = false; R.giDebug = -1; R.amb = [0.1, 0.105, 0.13];
  R.toggleGI = () => { R.giOn = !R.giOn; return R.giOn && R.giAvailable; };

  function batchTo(fb, w, h, shx, shy) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(pMain.p);
    gl.uniform4f(uView, 2 / W, -2 / H, -1 + (2 * shx) / W, 1 - (2 * shy) / H);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    nv = 0; cl = clx = cly = clt = 0;
  }

  // Сцена освещения: rgb — излучение, альфа — заслонка. Рисуется теми же примитивами в низком разрешении.
  let giShx = 0, giShy = 0;
  R.beginGI = function (shx, shy) {
    R.gi = R.giOn && R.giAvailable;
    if (!R.gi) return false;
    const t = AK.GI.scene;
    batchTo(t.fb, t.w, t.h, shx, shy);
    giShx = shx; giShy = shy; AK.GI.ns = 0;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(pMain.u.u_gi, 0);
    return true;
  };
  // Аналитический источник-диск (см. gi.js): мяч — непрозрачный, лампа в полу — прозрачная.
  // false — если мест нет и его надо нарисовать в растр.
  R.giLight = function (x, y, r, er, eg, eb, opaque) {
    const t = AK.GI.scene;
    return AK.GI.addLight((x + giShx) * t.w / W, (H - y - giShy) * t.h / H, r * t.w / W, er, eg, eb, opaque);
  };
  // Прожектор: светит в конус с осью под углом ang (в координатах поля) и полууглом half; soft — доля
  // полуугла, на которой свет мягко гаснет к краю конуса.
  R.giSpot = function (x, y, r, er, eg, eb, ang, half, soft) {
    const t = AK.GI.scene;
    return AK.GI.addLight((x + giShx) * t.w / W, (H - y - giShy) * t.h / H, r * t.w / W, er, eg, eb, false,
      Math.cos(ang), -Math.sin(ang), Math.cos(half), Math.cos(half * (1 - soft)));
  };
  R.endGI = function (sky) {
    flush();
    gl.disable(gl.BLEND);
    bindTex(3, null);
    AK.GI.compute(sky);
  };

  let frameShake = [0, 0];
  R.begin = function (time, shx, shy, c1, c2) {
    frameShake = [shx, shy];
    to(msaa || T.scene);
    gl.disable(gl.BLEND);
    const gi = R.gi ? 1 : 0;
    if (gi) bindTex(3, AK.GI.light.tex);
    gl.useProgram(pBg.p);
    gl.uniform1f(pBg.u.u_time, time);
    gl.uniform3fv(pBg.u.u_c1, c1);
    gl.uniform3fv(pBg.u.u_c2, c2);
    gl.uniform2f(pBg.u.u_shake, shx, shy);
    gl.uniform1f(pBg.u.u_gi, gi);
    gl.uniform1i(pBg.u.u_light, 3);
    gl.uniform2f(pBg.u.u_res, canvas.width, canvas.height);
    gl.uniform3fv(pBg.u.u_amb, R.amb);
    full();
    const t = msaa || T.scene;
    batchTo(t.fb, t.w, t.h, shx, shy);
    gl.uniform1f(pMain.u.u_gi, gi);
    gl.uniform1i(pMain.u.u_light, 3);
    gl.uniform2f(pMain.u.u_res, canvas.width, canvas.height);
    gl.uniform3fv(pMain.u.u_amb, R.amb);
    gl.uniform1i(pMain.u.u_ns, top.n);
    if (top.n) {
      for (let i = 0; i < top.n; i++) { top.ps[i * 3] = top.p[i * 3] + shx; top.ps[i * 3 + 1] = top.p[i * 3 + 1] + shy; top.ps[i * 3 + 2] = top.p[i * 3 + 2]; }
      gl.uniform3fv(pMain.u.u_sp, top.ps); gl.uniform4fv(pMain.u.u_sd, top.d); gl.uniform3fv(pMain.u.u_sc, top.c);
    }
  };

  // Прожекторы, которые светят на верх кирпичей в этом кадре (задаются до R.begin): x, y — источник в px поля,
  // r — его радиус, ang — ось луча, half — полуугол конуса, soft — доля полуугла, на которой свет гаснет
  // к краю (как у R.giSpot), col — излучение.
  const top = { n: 0, p: new Float32Array(MAX_TOP * 3), ps: new Float32Array(MAX_TOP * 3), d: new Float32Array(MAX_TOP * 4), c: new Float32Array(MAX_TOP * 3) };
  R.topLights = function (list) {
    top.n = Math.min(list.length, MAX_TOP);
    for (let i = 0; i < top.n; i++) {
      const s = list[i];
      top.p.set([s.x, s.y, s.r], i * 3);
      top.d.set([Math.cos(s.ang), Math.sin(s.ang), Math.cos(s.half), Math.cos(s.half * (1 - s.soft))], i * 4);
      top.c.set(s.col, i * 3);
    }
  };

  function flush() {
    if (!nv) return;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, nv * FL);
    gl.drawArrays(gl.TRIANGLES, 0, nv);
    nv = 0;
  }

  R.end = function (aberration, flash, flashCol) {
    flush();
    gl.disable(gl.BLEND);
    if (msaa) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaa.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.scene.fb);
      gl.blitFramebuffer(0, 0, msaa.w, msaa.h, 0, 0, msaa.w, msaa.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    // яркая часть -> половинное разрешение
    gl.useProgram(pBright.p);
    to(T.a1);
    bindTex(0, T.scene.tex);
    gl.uniform1i(pBright.u.u_tex, 0);
    gl.uniform2f(pBright.u.u_texel, 1 / T.scene.w, 1 / T.scene.h);
    gl.uniform1f(pBright.u.u_thr, 0.62);
    full();
    gl.useProgram(pBlur.p);
    gl.uniform1i(pBlur.u.u_tex, 0);
    to(T.b1); bindTex(0, T.a1.tex); gl.uniform2f(pBlur.u.u_dir, 1 / T.a1.w, 0); full();
    to(T.a1); bindTex(0, T.b1.tex); gl.uniform2f(pBlur.u.u_dir, 0, 1 / T.a1.h); full();
    // четверть разрешения — широкое свечение
    gl.useProgram(pBright.p);
    to(T.a2); bindTex(0, T.a1.tex);
    gl.uniform2f(pBright.u.u_texel, 1 / T.a1.w, 1 / T.a1.h);
    gl.uniform1f(pBright.u.u_thr, -1);
    full();
    gl.useProgram(pBlur.p);
    for (let i = 0; i < 2; i++) {
      const s = 1 + i;
      to(T.b2); bindTex(0, T.a2.tex); gl.uniform2f(pBlur.u.u_dir, s / T.a2.w, 0); full();
      to(T.a2); bindTex(0, T.b2.tex); gl.uniform2f(pBlur.u.u_dir, 0, s / T.a2.h); full();
    }
    // композит
    to(null);
    gl.useProgram(pComp.p);
    bindTex(0, T.scene.tex); gl.uniform1i(pComp.u.u_scene, 0);
    bindTex(1, T.a1.tex); gl.uniform1i(pComp.u.u_b1, 1);
    bindTex(2, T.a2.tex); gl.uniform1i(pComp.u.u_b2, 2);
    gl.uniform1f(pComp.u.u_ab, aberration || 0);
    gl.uniform1f(pComp.u.u_flash, flash || 0);
    gl.uniform3fv(pComp.u.u_flashCol, flashCol || [1, 1, 1]);
    full();
    if (R.gi && R.giDebug >= 0) AK.GI.show(R.giDebug, 0.5);
    gl.activeTexture(gl.TEXTURE0);
  };

  // ---- Примитивы ----
  function ensure(k) { if (nv + k > MAXV) flush(); }
  function vert(x, y, r, g, b, a, u, v, m) {
    const i = nv * FL;
    data[i] = x; data[i + 1] = y; data[i + 2] = r; data[i + 3] = g; data[i + 4] = b; data[i + 5] = a;
    data[i + 6] = u; data[i + 7] = v; data[i + 8] = m;
    data[i + 9] = cl; data[i + 10] = clx; data[i + 11] = cly; data[i + 12] = clt;
    nv++;
  }

  // Освещение следующих примитивов: k — доля освещения (0 — светится сам, 1 — только отражает свет),
  // ox, oy — смещение в px, откуда брать свет (для граней, обращённых наружу); top — это верх кирпича,
  // и на него светят прожекторы (см. R.topLights).
  R.lit = (k = 0, ox = 0, oy = 0, top = 0) => { cl = k; clx = ox; cly = oy; clt = top; };

  // add: 0 — обычное смешивание, 1 — аддитивное (свечение)
  R.color = (r, g, b, a = 1, add = 0) => { cr = r * a; cg = g * a; cb = b * a; ca = a * (1 - add); };
  R.color2 = (r, g, b, a = 1, add = 0) => { dr = r * a; dg = g * a; db = b * a; da = a * (1 - add); };

  R.tri = (x0, y0, x1, y1, x2, y2) => {
    ensure(3);
    vert(x0, y0, cr, cg, cb, ca, 0, 0, 0);
    vert(x1, y1, cr, cg, cb, ca, 0, 0, 0);
    vert(x2, y2, cr, cg, cb, ca, 0, 0, 0);
  };
  R.quad = (x0, y0, x1, y1, x2, y2, x3, y3) => { R.tri(x0, y0, x1, y1, x2, y2); R.tri(x0, y0, x2, y2, x3, y3); };
  R.rect = (x, y, w, h) => R.quad(x, y, x + w, y, x + w, y + h, x, y + h);

  // Квадрат с градиентом по вертикали: color сверху, color2 снизу.
  R.rectV = (x, y, w, h) => {
    ensure(6);
    vert(x, y, cr, cg, cb, ca, 0, 0, 0); vert(x + w, y, cr, cg, cb, ca, 0, 0, 0); vert(x + w, y + h, dr, dg, db, da, 0, 0, 0);
    vert(x, y, cr, cg, cb, ca, 0, 0, 0); vert(x + w, y + h, dr, dg, db, da, 0, 0, 0); vert(x, y + h, dr, dg, db, da, 0, 0, 0);
  };

  R.poly = v => {
    const n = v.length / 2;
    ensure((n - 2) * 3);
    for (let i = 1; i < n - 1; i++) {
      vert(v[0], v[1], cr, cg, cb, ca, 0, 0, 0);
      vert(v[i * 2], v[i * 2 + 1], cr, cg, cb, ca, 0, 0, 0);
      vert(v[i * 2 + 2], v[i * 2 + 3], cr, cg, cb, ca, 0, 0, 0);
    }
  };

  // Веер из центра (cx,cy) цвета color2 к краям цвета color, с куполообразной подсветкой краёв.
  // lx,ly — направление на свет; k — сила.
  R.polyShade = (v, cx, cy, lx, ly, k) => {
    const n = v.length / 2;
    ensure(n * 3);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = v[i * 2], ay = v[i * 2 + 1], bx = v[j * 2], by = v[j * 2 + 1];
      let dx = ax - cx, dy = ay - cy, l = Math.hypot(dx, dy) || 1;
      const sa = 1 + k * ((dx * lx + dy * ly) / l);
      dx = bx - cx; dy = by - cy; l = Math.hypot(dx, dy) || 1;
      const sb = 1 + k * ((dx * lx + dy * ly) / l);
      vert(cx, cy, dr, dg, db, da, 0, 0, 0);
      vert(ax, ay, cr * sa, cg * sa, cb * sa, ca, 0, 0, 0);
      vert(bx, by, cr * sb, cg * sb, cb * sb, ca, 0, 0, 0);
    }
  };

  // Луч прожектора: веер из (x,y) с осью под углом ang, полууглом half и длиной len. У вершины — color,
  // на дальнем краю — color2; поперёк луча яркость спадает к краям веера до нуля.
  R.beam = (x, y, ang, half, len, seg = 10) => {
    ensure(seg * 3);
    for (let i = 0; i < seg; i++) {
      const s0 = -1 + (2 * i) / seg, s1 = -1 + (2 * (i + 1)) / seg;
      const f0 = 1 - s0 * s0, f1 = 1 - s1 * s1, fa = (f0 + f1) * 0.5;
      const a0 = ang + s0 * half, a1 = ang + s1 * half;
      vert(x, y, cr * fa, cg * fa, cb * fa, ca * fa, 0, 0, 0);
      vert(x + Math.cos(a0) * len, y + Math.sin(a0) * len, dr * f0, dg * f0, db * f0, da * f0, 0, 0, 0);
      vert(x + Math.cos(a1) * len, y + Math.sin(a1) * len, dr * f1, dg * f1, db * f1, da * f1, 0, 0, 0);
    }
  };

  R.line = (x0, y0, x1, y1, w) => {
    let dx = x1 - x0, dy = y1 - y0;
    const l = Math.hypot(dx, dy) || 1;
    dx = (-dy / l) * w * 0.5; dy = ((x1 - x0) / l) * w * 0.5;
    R.quad(x0 + dx, y0 + dy, x1 + dx, y1 + dy, x1 - dx, y1 - dy, x0 - dx, y0 - dy);
  };

  function sprite(x, y, r, m) {
    ensure(6);
    const x0 = x - r, x1 = x + r, y0 = y - r, y1 = y + r;
    vert(x0, y0, cr, cg, cb, ca, -1, -1, m); vert(x1, y0, cr, cg, cb, ca, 1, -1, m); vert(x1, y1, cr, cg, cb, ca, 1, 1, m);
    vert(x0, y0, cr, cg, cb, ca, -1, -1, m); vert(x1, y1, cr, cg, cb, ca, 1, 1, m); vert(x0, y1, cr, cg, cb, ca, -1, 1, m);
  }
  R.soft = (x, y, r) => sprite(x, y, r, 1);
  R.disc = (x, y, r) => sprite(x, y, r, 2);
  R.sphere = (x, y, r) => sprite(x, y, r, 3);
  // Кольцо; thick — относительная толщина (0..1)
  R.ring = (x, y, r, thick) => sprite(x, y, r, 4 + U_clamp(thick, 0.01, 0.99));
  const U_clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  AK.R = R;
})(window.AK);
