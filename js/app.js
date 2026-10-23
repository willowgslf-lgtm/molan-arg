/* ==========================================================
   末栏 · ARG 三部曲
   Single-page static ARG. No backend, no frameworks.
   ========================================================== */
(function () {
  'use strict';

  const D = window.MOLAN;
  const app = document.getElementById('app');
  const flashEl = document.getElementById('flash');
  const dimEl = document.getElementById('dim');
  const toastEl = document.getElementById('toast');
  const modalRoot = document.getElementById('modalRoot');
  const clueDock = document.getElementById('clueDock');
  const clueTab = document.getElementById('clueTab');
  const clueBody = document.getElementById('clueBody');
  const clueCount = document.getElementById('clueCount');
  const audioToggle = document.getElementById('audioToggle');
  const audio = window.MolanAudio;

  const SAVE_KEY = 'molan_arg_save_v2';
  const LEGACY_KEY = 'molan_has_completed';
  const VERSION = 2;

  let state = loadState();
  // Every full page load starts a fresh run.
  let route = { scene: 'opening' };
  let historyStack = [];
  let transitioning = false;
  let pendingPatientIntro = false;
  let pendingEngineerIntro = false;
  let pendingReturn = false;
  let pendingRunIntro = false;
  let heartTimer = null;
  let locationBusy = false;
  let termTyping = false;
  let termToken = 0;
  let typingBusy = false;
  let patientCountTimer = null;
  let patientCount = 0;
  let lastRenderedScene = null;

  const SCENES = {};

  // The original DouBao build shows five clue cards, not one card per puzzle.
  // The underlying clue keys stay separate so the story logic is unchanged.
  const CLUE_GROUPS = [
    { id: 'g-d074', name: 'D-074 供体', keys: ['d074', 'witness'], hint: '沈迟的心脏编号，以及张桂兰离开的那 68 秒。' },
    { id: 'g-entry', name: '临渊研究所', keys: ['linyuan', 'repair'], hint: '凯撒密码与数字摩斯解开的两道入口。' },
    { id: 'g-forum', name: '华夏灵异网', keys: ['huaxia', 'floor18'], hint: 'Base64 校验码，以及十八层的代号与印记。' },
    { id: 'g-vessel', name: '黑暗经书', keys: ['vessel'], hint: 'Atbash 首尾互换后得到的那个词。' },
    { id: 'g-city', name: '最终门', keys: ['chengdu'], hint: '三条线交汇的城市。' }
  ];

  /* ---------------------------------------------------------
     state + storage
     --------------------------------------------------------- */
  function defaultState() {
    return {
      version: VERSION,
      started: false,
      gameCompleted: false,
      completedRuns: 0,
      run: 1,
      runRecorded: false,
      lastScene: 'opening',
      currentIdentity: 'chengwei',
      puzzles: {
        oasLogin: false,
        shenchi: false,
        shenbo: false,
        base64: false,
        forum: false,
        hellLogin: false,
        scripture: false,
        finalDoor: false,
        panyangLogin: false,
        patientLogin: false,
        engineerLogin: false,
        recording: false
      },
      clues: {},
      warnings: { shenchi: false, shenbo: false },
      choices: { shenchi: null, shenbo: null },
      endings: [],
      seenReturn: false,
      terminalAsked: [],
      terminalLog: [],
      terminalReady: false,
      finalChoice: null,
      corridorStep: 0,
      endingId: null,
      endingStep: 0,
      endingSpecial: false,
      endingDone: false,
      archiveId: 'shenchi',
      ui: {
        loginRole: 'staff',
        instituteTab: 'home',
        newsArticle: null,
        forumPost: null,
        hellTab: 'scrolls',
        scrollId: null,
        panyangTab: 'home',
        patientTab: 'diary',
        engineerTab: 'orders',
        openDiscussion: null
      }
    };
  }

  function loadState() {
    // The 1:1 handbook requires a full reset on every refresh:
    // no puzzle progress, no endings and no scene resume are persisted.
    // Only the sound on/off preference is kept, by audio.js.
    try {
      window.localStorage.removeItem(SAVE_KEY);
      window.localStorage.removeItem(LEGACY_KEY);
    } catch (e) {}
    return defaultState();
  }

  function saveState() {
    // Keep the in-memory session consistent, but deliberately do not write
    // story progress to localStorage. Refreshing the page therefore restarts.
    state.version = VERSION;
    state.lastScene = route.scene;
  }

  function validScene(scene) {
    return [
      'opening', 'oasLogin', 'oasDashboard', 'archive', 'institute', 'forum',
      'panyangLogin', 'panyang', 'hellLogin', 'hell', 'hellScroll', 'finalDoor',
      'corridor', 'terminal', 'patient', 'engineer', 'ending'
    ].includes(scene);
  }

  /* ---------------------------------------------------------
     small helpers
     --------------------------------------------------------- */
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ESC[ch]);
  }
  function nl2br(value) {
    return esc(value).replace(/\r?\n/g, '<br>');
  }
  function lines(value) {
    return String(value || '').split(/\r?\n/).map((p) => `<p>${esc(p) || '&nbsp;'}</p>`).join('');
  }
  function norm(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  }
  function cityNorm(value) {
    return String(value || '').trim().replace(/[省市自治区特别行政区]/g, '').replace(/\s+/g, '');
  }
  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ''; }
  }
  function byId(id) {
    return document.getElementById(id);
  }
  function findArchive(id) {
    return D.oas.archives.find((a) => a.id === id) || D.oas.archives[0];
  }
  function warningCount() {
    return (state.warnings.shenchi ? 1 : 0) + (state.warnings.shenbo ? 1 : 0);
  }
  function clueTotal() {
    return CLUE_GROUPS.length;
  }
  function clueFoundCount() {
    return CLUE_GROUPS.filter((g) => g.keys.some((k) => !!state.clues[k])).length;
  }
  function endedCount() {
    return D.endings ? Object.keys(D.endings).filter((k) => state.endings.includes(k)).length : state.endings.length;
  }

  function currentIdentityLabel() {
    if (state.currentIdentity === 'shenchi') return 'heart_74 / 沈迟';
    if (state.currentIdentity === 'shenbo') return 'YQSM-68 / 沈搏';
    return 'chengwei / 程未';
  }

  function findClue(id) {
    const def = D.clueDefs.find((c) => c.id === id);
    if (!def) return;
    if (!state.clues[id]) {
      state.clues[id] = nowIso();
      saveState();
      updateClueUI();
      toast('线索已记录：' + def.name);
      audio.unlockChime();
    }
  }

  function setPuzzle(key) {
    if (!state.puzzles[key]) {
      state.puzzles[key] = true;
      saveState();
    }
  }

  /* ---------------------------------------------------------
     UI: toast, modal, flash, clue dock, audio
     --------------------------------------------------------- */
  let toastTimer = null;
  function toast(message, isError) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.toggle('is-error', !!isError);
    toastEl.classList.add('is-on');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('is-on'), 2800);
  }

  let modalOpen = false;
  let modalDismissible = true;
  let lastFocus = null;

  function openModal(options) {
    const opt = options || {};
    lastFocus = document.activeElement;
    modalDismissible = opt.dismissible !== false;
    const tone = opt.tone || 'dark';
    const actions = Array.isArray(opt.actions) ? opt.actions : [];
    const wide = opt.wide ? ' modal--wide' : '';
    const actionHtml = actions.map((a, i) => {
      const classes = ['btn'];
      if (a.tone === 'primary') classes.push('btn--primary');
      else if (a.tone === 'ghost') classes.push('btn--ghost');
      else if (a.tone === 'gold') classes.push('btn--gold');
      const close = a.close === false ? '' : ' data-modal-close="1"';
      const disabled = a.disabled ? ' disabled' : '';
      const action = a.action ? ` data-action="${esc(a.action)}"` : '';
      const data = a.data ? ` data-id="${esc(a.data)}"` : '';
      return `<button type="button" class="${classes.join(' ')}"${action}${data}${close}${disabled} data-modal-index="${i}">${esc(a.label)}</button>`;
    }).join('');
    modalRoot.innerHTML = `
      <div class="modal-backdrop" ${modalDismissible ? 'data-modal-close="1"' : ''}></div>
      <div class="modal modal--${esc(tone)}${wide}" role="document">
        <div class="modal__head">
          <div>
            ${opt.kicker ? `<p class="modal__kicker">${esc(opt.kicker)}</p>` : ''}
            <h2 class="modal__title">${esc(opt.title || '')}</h2>
          </div>
          ${modalDismissible ? '<button class="modal__close" type="button" data-modal-close="1" aria-label="关闭">×</button>' : ''}
        </div>
        <div class="modal__body">${opt.body || ''}</div>
        ${actionHtml ? `<div class="modal__actions">${actionHtml}</div>` : ''}
      </div>`;
    modalRoot.classList.add('is-open');
    modalRoot.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-locked');
    modalOpen = true;
    window.setTimeout(() => {
      const first = modalRoot.querySelector('.modal__actions .btn, .modal__close');
      if (first) first.focus({ preventScroll: true });
    }, 50);
  }

  function closeModal(silent) {
    if (!modalOpen) return;
    modalRoot.classList.remove('is-open');
    modalRoot.setAttribute('aria-hidden', 'true');
    modalRoot.innerHTML = '';
    document.body.classList.remove('is-locked');
    modalOpen = false;
    if (!silent && lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
    }
    lastFocus = null;
  }

  function flashRed() {
    if (!flashEl) return;
    flashEl.classList.remove('is-on');
    void flashEl.offsetWidth;
    flashEl.classList.add('is-on');
    window.setTimeout(() => flashEl.classList.remove('is-on'), 700);
  }

  function dim(text, duration) {
    return new Promise((resolve) => {
      if (!dimEl) { resolve(); return; }
      dimEl.querySelector('.dim__text').textContent = text || '';
      dimEl.classList.add('is-on');
      window.setTimeout(() => {
        resolve();
        window.setTimeout(() => dimEl.classList.remove('is-on'), 420);
      }, duration || 1000);
    });
  }

  function updateClueUI() {
    if (!clueCount || !clueBody) return;
    const countText = `${clueFoundCount()}/${clueTotal()}`;
    clueCount.textContent = countText;
    const panelCount = byId('clueCountPanel');
    if (panelCount) panelCount.textContent = countText;
    clueBody.innerHTML = CLUE_GROUPS.map((g) => {
      const foundKeys = g.keys.filter((k) => !!state.clues[k]);
      const on = foundKeys.length > 0;
      const answers = foundKeys.map((k) => {
        const def = D.clueDefs.find((x) => x.id === k);
        return def ? def.answer : '';
      }).filter(Boolean).join(' / ');
      return `<div class="clue-item ${on ? '' : 'is-locked'}">
        <div class="clue-item__icon">${on ? dbIcon('check') : dbIcon('lock')}</div>
        <div class="clue-item__content">
          <div class="clue-item__top"><span class="clue-item__name">${on ? esc(g.name) : '???'}</span>${on ? '<span class="clue-item__lock">已记录</span>' : ''}</div>
          ${on ? `<p class="clue-item__answer">${esc(answers)}</p><p class="clue-item__hint">${esc(g.hint)}</p>` : '<p class="clue-item__hint">尚未发现此线索...</p>'}
        </div>
      </div>`;
    }).join('');
  }

  function updateAudioUI() {
    if (!audioToggle) return;
    const muted = !!(audio && audio.muted);
    audioToggle.classList.toggle('is-muted', muted);
    audioToggle.setAttribute('aria-pressed', muted ? 'false' : 'true');
    audioToggle.setAttribute('aria-label', muted ? '打开声音' : '关闭声音');
  }

  function openClue() {
    if (!clueDock) return;
    clueDock.classList.add('is-open');
    clueTab.setAttribute('aria-expanded', 'true');
  }
  function closeClue() {
    if (!clueDock) return;
    clueDock.classList.remove('is-open');
    clueTab.setAttribute('aria-expanded', 'false');
  }
  function toggleClue() {
    if (!clueDock) return;
    if (clueDock.classList.contains('is-open')) closeClue();
    else openClue();
  }

  /* ---------------------------------------------------------
     scene chrome
     --------------------------------------------------------- */
  function topbar(title, tone, showBack) {
    const t = tone || 'dark';
    return `<header class="topbar topbar--${t}">
      <div class="topbar__inner">
        <div class="topbar__back-wrap">
          ${showBack === false ? '' : `<button class="topbar__back" type="button" data-action="back" aria-label="返回">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 18l-6-6 6-6"/></svg>
            <span>返回</span>
          </button>`}
          <div class="topbar__title">${esc(title || '')}</div>
        </div>
        <div class="topbar__right"><span class="topbar__dot"></span><span>ARCHIVE ${state.run > 1 ? 'R2' : 'R1'}</span></div>
      </div>
    </header>`;
  }

  function hexagramSVG(className, title) {
    return `<svg class="${className || 'hexagram-svg'}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title || '十八层印记')}">
      <circle class="ring" cx="100" cy="100" r="91"/>
      <circle class="ring" cx="100" cy="100" r="80" stroke-dasharray="1 7"/>
      <g class="spin">
        <path class="tick" d="M100 8v13M100 179v13M8 100h13M179 100h13M31 31l9 9M160 160l9 9M169 31l-9 9M40 160l-9 9"/>
        <path class="tick" d="M100 37a63 63 0 0 1 63 63M100 163a63 63 0 0 1-63-63" stroke-dasharray="2 11"/>
      </g>
      <g class="tri">
        <path d="M100 19 L173 150 H27 Z"/>
        <path d="M100 181 L27 50 H173 Z"/>
      </g>
      <ellipse class="eye" cx="100" cy="100" rx="29" ry="13"/>
      <circle class="pupil" cx="100" cy="100" r="4.7"/>
      <circle class="ring" cx="100" cy="100" r="52" stroke-dasharray="1 4"/>
    </svg>`;
  }

  function ecgSVG(className) {
    return `<svg class="${className || 'ecg'}" viewBox="0 0 900 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path class="ecg-bg" d="M0 52h120l9-19 12 46 16-55 15 28h42l8-10 9 20 12-48 14 45 10-7h98l9-23 12 55 15-64 16 32h49l10-10 11 20 13-42 12 38 11-6h112l9-18 11 41 15-50 14 27h42l9-11 12 22 12-35 12 31 10-7h108" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
      <path class="ecg-dot" d="M0 52h120l9-19 12 46 16-55 15 28h42l8-10 9 20 12-48 14 45 10-7h98l9-23 12 55 15-64 16 32h49l10-10 11 20 13-42 12 38 11-6h112l9-18 11 41 15-50 14 27h42l9-11 12 22 12-35 12 31 10-7h108" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }

  function chinaMapSVG() {
    const points = D.hell.cities.map((city) => {
      const x = 42 + ((city.lon - 73) / (135 - 73)) * 676;
      const y = 34 + ((54 - city.lat) / (54 - 18)) * 446;
      return { ...city, x, y };
    });
    const path = points.filter((c) => !c.main).map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const grid = [];
    for (let i = 1; i < 8; i++) grid.push(`<line class="map-grid" x1="${i * 95}" y1="0" x2="${i * 95}" y2="520"/>`);
    for (let i = 1; i < 6; i++) grid.push(`<line class="map-grid" x1="0" y1="${i * 86}" x2="760" y2="${i * 86}"/>`);
    const nodes = points.map((c) => {
      if (c.main) {
        return `<g class="city-node is-main" transform="translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})">
          <circle class="halo" r="26"/>
          <circle class="halo" r="15" opacity=".5"/>
          <circle class="core" r="5"/>
          <text x="13" y="4">${esc(c.name)} · 74</text>
        </g>`;
      }
      return `<g class="city-node" transform="translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})">
        <circle class="halo" r="8"/>
        <circle class="core" r="2.6"/>
        <text x="7" y="3">${esc(c.name)}</text>
      </g>`;
    }).join('');
    return `<svg class="hell-map__svg" viewBox="0 0 760 520" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="十二城搏印节点地图">
      <defs>
        <radialGradient id="mapGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#8b0000" stop-opacity=".065"/>
          <stop offset="100%" stop-color="#8b0000" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="380" cy="260" r="248" fill="url(#mapGlow)"/>
      <circle cx="380" cy="260" r="206" fill="none" stroke="rgba(139,0,0,.12)" stroke-width="1"/>
      <circle cx="380" cy="260" r="142" fill="none" stroke="rgba(139,0,0,.08)" stroke-width="1" stroke-dasharray="2 9"/>
      <path d="M380 34 L630 450 L130 450 Z" fill="none" stroke="rgba(139,0,0,.09)" stroke-width="1"/>
      <path d="M380 486 L130 70 L630 70 Z" fill="none" stroke="rgba(139,0,0,.09)" stroke-width="1"/>
      ${grid.join('')}
      <polyline points="${path}" fill="none" stroke="rgba(184,134,11,.12)" stroke-width="1" stroke-dasharray="2 8"/>
      ${nodes}
      <text x="30" y="500" fill="rgba(139,0,0,.34)" font-family="monospace" font-size="8">N 34° 17' / E 108° 56'</text>
      <text x="620" y="500" fill="rgba(139,0,0,.25)" font-family="monospace" font-size="8">12 NODES ONLINE</text>
    </svg>`;
  }

  /* ---------------------------------------------------------
     routing
     --------------------------------------------------------- */
  const PARENTS = {
    opening: null,
    oasLogin: 'opening',
    oasDashboard: 'oasLogin',
    archive: 'oasDashboard',
    institute: 'oasDashboard',
    forum: 'institute',
    panyangLogin: 'forum',
    panyang: 'panyangLogin',
    hellLogin: 'forum',
    hell: 'hellLogin',
    hellScroll: 'hell',
    finalDoor: 'hell',
    corridor: 'finalDoor',
    terminal: 'corridor',
    patient: 'oasLogin',
    engineer: 'oasLogin',
    ending: 'opening'
  };

  const SCENE_AUDIO = {
    opening: 'heartbeat',
    oasLogin: 'heartbeat',
    oasDashboard: 'heartbeat',
    archive: 'heartbeat',
    institute: 'ambient',
    forum: 'none',
    panyangLogin: 'ambient',
    panyang: 'ambient',
    hellLogin: 'none',
    hell: 'eerie',
    hellScroll: 'eerie',
    finalDoor: 'eerie',
    corridor: 'eerie',
    terminal: 'tension',
    patient: 'ambient',
    engineer: 'ambient',
    ending: 'tension'
  };

  const SCENE_TITLES = {
    opening: '末栏 · ARG 三部曲',
    oasLogin: 'OAS · 登录',
    oasDashboard: 'OAS · 工作台',
    archive: 'OAS · 异常档案',
    institute: '临渊医学人文研究所',
    forum: '华夏灵异网',
    panyangLogin: '盘阳生物 · 员工端',
    panyang: '盘阳生物 · 内网',
    hellLogin: '十八层 · 印记',
    hell: '十八层',
    hellScroll: '十八层 · 卷轴',
    finalDoor: '十八层 · 最终门',
    corridor: '住院部 · 走廊',
    terminal: 'terminal_v1.0',
    patient: 'heart_74 · 样本端',
    engineer: 'engineer_68 · 工程端',
    ending: '末栏 · 结局'
  };

  function navigate(scene, options) {
    const opt = options || {};
    const nextScene = validScene(scene) ? scene : 'opening';
    if (['oasDashboard','archive','institute','forum','hell','hellScroll','finalDoor','corridor','terminal'].includes(nextScene)) {
      state.currentIdentity = 'chengwei';
    }
    if (!opt.noPush && route.scene && nextScene !== route.scene) {
      historyStack.push(route.scene);
      if (historyStack.length > 40) historyStack.shift();
    }
    if (clueDock && clueDock.classList.contains('is-open') && window.innerWidth < 700) closeClue();
    closeModal(true);
    if (opt.flash === false) {
      route = { scene: nextScene };
      render();
      return;
    }
    if (transitioning) return;
    transitioning = true;
    flashRed();
    app.classList.add('is-dimmed');
    window.setTimeout(() => {
      route = { scene: nextScene };
      render();
      window.requestAnimationFrame(() => {
        app.classList.remove('is-dimmed');
        transitioning = false;
      });
    }, 310);
  }

  function goBack() {
    if (modalOpen) { closeModal(); return; }
    if (route.scene === 'forum' && state.ui.forumPost) {
      state.ui.forumPost = null;
      saveState();
      render();
      return;
    }
    if (route.scene === 'hellScroll') {
      state.ui.scrollId = null;
      navigate('hell', { flash: true });
      return;
    }
    if (route.scene === 'ending') {
      toast('结局不能被撤回。');
      return;
    }
    let target = null;
    if (historyStack.length) target = historyStack.pop();
    if (!target) target = PARENTS[route.scene] || 'opening';
    navigate(target, { flash: true, noPush: true });
  }

  function render(options) {
    const opt = options || {};
    if (!opt.keepModal) closeModal(true);
    const scene = route.scene;
    const sceneChanged = lastRenderedScene !== scene;
    lastRenderedScene = scene;
    if (scene !== 'terminal') { termTyping = false; termToken += 1; }
    if (scene !== 'ending' && heartTimer) { window.clearInterval(heartTimer); heartTimer = null; }
    if (scene !== 'ending' && fakeCountdownTimer) { window.clearInterval(fakeCountdownTimer); fakeCountdownTimer = null; }
    if (scene === 'ending') {
      const s = D.endingScripts[state.endingId];
      const l = s && s[state.endingStep];
      if ((!l || !l.countdown) && fakeCountdownTimer) { window.clearInterval(fakeCountdownTimer); fakeCountdownTimer = null; }
    }
    if (scene !== 'patient' && patientCountTimer) { window.clearInterval(patientCountTimer); patientCountTimer = null; patientCount = 0; }
    const view = SCENES[scene] || SCENES.opening;
    app.innerHTML = view();
    app.dataset.scene = scene;
    document.body.dataset.scene = scene;
    document.title = SCENE_TITLES[scene] || '末栏 · ARG 三部曲';
    state.lastScene = scene;
    saveState();
    updateClueUI();
    updateAudioUI();
    if (audio) {
      audio.setMode(SCENE_AUDIO[scene] || 'none');
    }
    if (!opt.keepScroll) {
      window.scrollTo(0, 0);
    }
    if (sceneChanged) {
      if (window.innerWidth >= 1024 && ['opening', 'oasLogin', 'oasDashboard'].includes(scene)) openClue();
      else if (!['opening', 'oasLogin', 'oasDashboard'].includes(scene)) closeClue();
    }
    afterRender();
  }

  function afterRender() {
    const scene = route.scene;
    if (scene === 'terminal') {
      const term = byId('termBody');
      if (term) term.scrollTop = term.scrollHeight;
      if (!state.terminalReady && state.terminalAsked.length >= D.terminal.questions.length) {
        finishTerminalIfReady();
      }
    }
    if (scene === 'ending') {
      if (!state.endingDone && !state.endingSpecial && state.endingId === 'fake') {
        const script = D.endingScripts.fake;
        const line = script[state.endingStep];
        if (line && line.countdown) startFakeCountdown();
      }
      const isSpecial = state.endingSpecial && !state.endingDone;
      if (isSpecial && state.endingId === 'bad') {
        const holder = byId('badLocation');
        if (holder && !holder.dataset.done) renderBadLocationPrompt(holder);
      }
    }
    if (scene === 'patient' && pendingPatientIntro) {
      pendingPatientIntro = false;
      window.setTimeout(() => openPatientFlash(), 380);
    }
    if (scene === 'engineer' && pendingEngineerIntro) {
      pendingEngineerIntro = false;
      window.setTimeout(() => openEngineerFlash(), 380);
    }
    if (scene === 'hell' && state.gameCompleted && !state.seenReturn) {
      state.seenReturn = true;
      pendingReturn = true;
      saveState();
    }
    if (scene === 'hell' && pendingReturn) {
      pendingReturn = false;
      window.setTimeout(() => openReturnModal(), 480);
    }
    if (scene === 'opening' && pendingRunIntro) {
      pendingRunIntro = false;
      window.setTimeout(() => openRunIntro(), 650);
    }
    if (scene === 'patient') {
      startPatientCount();
      const input = byId('chatInput');
      if (input && state.ui.patientTab === 'messages' && !state.choices.shenchi) {
        // Do not autofocus on mobile; the message choices are buttons.
      }
    }
    if (scene === 'corridor') {
      audio.page();
    }
  }

  /* ---------------------------------------------------------
     dialogs used by multiple scenes
     --------------------------------------------------------- */
  function openPatientFlash() {
    openModal({
      tone: 'blue',
      kicker: 'SAMPLE D-074 / IDENTITY VERIFIED',
      title: '样本身份核验通过',
      body: D.patient.flash.map((t, i) => `<p${i === D.patient.flash.length - 1 ? ' style="color:#8fc7df"' : ''}>${esc(t)}</p>`).join('') +
        '<p class="tiny" style="color:#6b92a5;margin-top:16px">连接已建立 · 监听设备 3 号床 · 74 bpm</p>',
      actions: [{ label: '进入病房', tone: 'primary' }]
    });
    audio.heartbeatNow();
  }

  function openEngineerFlash() {
    openModal({
      tone: 'steel',
      kicker: 'YQSM-68 / MAINTENANCE CLEARANCE',
      title: '工程师账号核验通过',
      body: D.engineer.flash.map((t) => `<p>${esc(t)}</p>`).join('') +
        '<p class="tiny" style="color:#8b9ba3;margin-top:16px">内部维护通道已开放。未关闭工单：1</p>',
      actions: [{ label: '进入维护通道', tone: 'primary' }]
    });
    audio.tick();
  }

  function openReturnModal() {
    openModal({
      tone: 'red',
      kicker: 'RETURN_VISITOR_DETECTED / 74',
      title: '你又来了，程先生',
      body: `
        <p>你不是那些凡夫俗子。</p>
        <p>你又来了，程先生。</p>
        <p>你知道这条路通向哪里。</p>
        <p style="color:#f0d7c2;font-size:16px;letter-spacing:.08em">这一次，你想救谁？</p>
        <p class="tiny" style="color:#9e6f68;margin-top:18px">SAMPLE_D000_REPEATER · 第 ${state.run} 次样本回溯</p>`,
      actions: [{ label: '推门', tone: 'primary' }],
      dismissible: false
    });
    audio.flatline();
  }

  function openRunIntro() {
    openModal({
      tone: 'dark',
      kicker: 'REPLAY / SECOND PASS',
      title: '二周目已开启',
      body: `
        <p>你完成了一次调查。档案没有结束，只是被翻到了背面。</p>
        <p>OAS 登录页现在开放两个新的身份：</p>
        <p><strong>患者样本端</strong>：shenchi_heart / 747474</p>
        <p><strong>设备工程端</strong>：shenbo / 686868</p>
        <p style="color:#b9a58c">去听他们没说完的话。你救下的人，会改变最后一扇门后面的东西。</p>`,
      actions: [{ label: '进入档案', tone: 'primary' }]
    });
  }

  function openGallery() {
    const order = ['bad', 'fake', 'middle', 'true'];
    const cards = order.map((id) => {
      const e = D.endings[id];
      const on = state.endings.includes(id);
      return `<div class="gallery-item ${on ? '' : 'is-locked'}">
        <div class="kicker">${e.no} / ${esc(e.tag)}</div>
        <h3>${on ? esc(e.title) : '？？？'}</h3>
        <p>${on ? esc(e.desc) : '尚未抵达。'}</p>
        <p style="margin-top:7px;color:#554c43">${on ? esc(e.subtitle) : esc(e.hint)}</p>
      </div>`;
    }).join('');
    openModal({
      tone: 'dark',
      kicker: `ENDING ARCHIVE / ${endedCount()} OF 4`,
      title: '结局档案',
      wide: true,
      body: `<div class="gallery-grid">${cards}</div><p class="tiny" style="margin-top:16px;color:#695e52">已经发生的事，不会被清除。你在新一轮里做的选择会覆盖旧的线。</p>`,
      actions: [{ label: '关闭', tone: 'ghost' }]
    });
  }

  function openOasSection(section) {
    let title = '';
    let body = '';
    if (section === 'allocation') {
      title = '本月分配记录';
      body = `<div style="border:1px solid #e2e8ee"><table style="width:100%;border-collapse:collapse;font-size:12px;color:#42586b">
        <thead><tr style="background:#f4f8fb;color:#75889a;text-align:left"><th style="padding:9px">日期</th><th style="padding:9px">器官</th><th style="padding:9px">受者</th><th style="padding:9px">结果</th></tr></thead>
        <tbody>
          <tr><td style="padding:9px;border-top:1px solid #edf1f5">03-15</td><td style="padding:9px;border-top:1px solid #edf1f5">肝脏</td><td style="padding:9px;border-top:1px solid #edf1f5">陈志远</td><td style="padding:9px;border-top:1px solid #edf1f5;color:#3e8062">成功</td></tr>
          <tr><td style="padding:9px;border-top:1px solid #edf1f5">03-14</td><td style="padding:9px;border-top:1px solid #edf1f5">肾脏</td><td style="padding:9px;border-top:1px solid #edf1f5">赵慧敏</td><td style="padding:9px;border-top:1px solid #edf1f5;color:#3e8062">成功</td></tr>
          <tr><td style="padding:9px;border-top:1px solid #edf1f5">03-13</td><td style="padding:9px;border-top:1px solid #edf1f5">心脏</td><td style="padding:9px;border-top:1px solid #edf1f5">周明辉</td><td style="padding:9px;border-top:1px solid #edf1f5;color:#3e8062">成功</td></tr>
        </tbody></table></div><p style="margin-top:12px;font-size:11px;color:#8293a2">仅展示最近 3 条。异常分配记录已被系统隐藏。</p>`;
    } else if (section === 'followup') {
      title = '待随访任务';
      body = `<p><strong>沈迟</strong> · 心脏移植 · 03-18 到期 · <span style="color:#a83a3a">高优先级</span></p>
        <p><strong>陈志远</strong> · 肝脏移植 · 03-20 到期</p>
        <p><strong>赵慧敏</strong> · 肾脏移植 · 03-17 到期 · 进行中</p>
        <p style="color:#8293a2;font-size:11px;margin-top:14px">系统提示：沈迟的随访记录在昨夜 03:47 被重复写入 74 次。</p>`;
    } else if (section === 'alerts') {
      title = '异常访问预警';
      body = D.oas.alerts.map((a) => `<div style="padding:12px 0;border-bottom:1px solid #edf1f5">
        <div style="font-size:10px;color:#a83a3a">${esc(a.time)} · ${esc(a.level)}级 · ${esc(a.title)}</div>
        <p style="margin:5px 0 0;font-size:11px;color:#758798">${esc(a.body)}</p></div>`).join('');
    } else {
      title = '档案管理';
      body = D.oas.archives.map((a) => `<p><strong>${esc(a.title)}</strong><br><span style="font-size:11px;color:#7d8f9f">${esc(a.archiveNo)} · ${esc(a.status)} · ${esc(a.hospital)}</span></p>`).join('');
    }
    openModal({
      tone: 'dark',
      kicker: 'OAS / INTERNAL',
      title,
      body: `<div style="color:#4b5563;font-size:13px;line-height:1.9">${body}</div>`,
      actions: [{ label: '知道了', tone: 'ghost' }]
    });
  }

  /* ---------------------------------------------------------
     flat UI icon helper
     --------------------------------------------------------- */
  const DB_ICONS = {
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z"/>',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"/><path d="M12 9v4M12 17h.01"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/>',
    arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>'
  };
  function dbIcon(name, cls) {
    return `<svg class="db-icon ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DB_ICONS[name] || ''}</svg>`;
  }

  /* ---------------------------------------------------------
     SCENE: opening
     --------------------------------------------------------- */
  SCENES.opening = function () {
    return `<main class="screen screen--opening db-opening" data-action="start-game">
      <button class="db-opening__hit" type="button" data-action="start-game" aria-label="点击进入档案"></button>
      <div class="db-opening__inner">
        <div class="db-opening__glow" aria-hidden="true"></div>
        <p class="db-opening__fiction">${esc(D.meta.disclaimer)}</p>
        <p class="db-opening__hint">点击任意位置继续</p>
        <h1 class="db-opening__title">末栏</h1>
        <p class="db-opening__sub">· ARG 三部曲 ·</p>
      </div>
      <p class="db-opening__version">v2.0 / SIGNAL 03:47</p>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: OAS login
     --------------------------------------------------------- */
  SCENES.oasLogin = function () {
    const role = state.ui.loginRole || 'staff';
    const unlocked = state.gameCompleted;
    const cred = role === 'shenchi' ? D.accounts.shenchi : role === 'shenbo' ? D.accounts.shenbo : D.accounts.oas;
    const prefill = role === 'staff';
    const tab = (id, label, locked) => `<button type="button" class="db-login-tab ${role === id ? 'is-active' : ''} ${locked ? 'is-locked' : ''}" data-action="switch-login" data-id="${id}">
      <span>${label}</span>${locked ? '<span class="db-tab-lock">锁定</span>' : ''}
    </button>`;
    return `<main class="screen db-login">
      <header class="db-oas-top">
        <div class="db-oas-top__inner">
          <div class="db-oas-brand">
            <span class="db-oas-logo">OAS</span>
            <div><div class="db-oas-brand__title">人体器官分配与共享信息平台</div><div class="db-oas-brand__sub">Organ Allocation &amp; Sharing System</div></div>
          </div>
          <div class="db-version">版本 v3.2.1</div>
        </div>
      </header>
      <div class="db-login-main">
        <div class="db-login-card">
          <div class="db-login-tabs">
            ${tab('staff', '管理员登录', false)}
            ${tab('shenchi', '患者端登录', false)}
            ${(unlocked || role === 'shenbo') ? tab('shenbo', '工程端登录', false) : ''}
          </div>
          <form class="db-login-form" data-form="oas-login" novalidate>
            <div class="db-field-group">
              <label for="oas-user">账号</label>
              <div class="db-input-wrap">${dbIcon('user')}<input class="db-input" id="oas-user" name="user" type="text" autocomplete="username" placeholder="请输入账号" value="${prefill ? esc(cred.user) : ''}"></div>
            </div>
            <div class="db-field-group">
              <label for="oas-pass">密码</label>
              <div class="db-input-wrap">${dbIcon('lock')}<input class="db-input" id="oas-pass" name="pass" type="password" autocomplete="current-password" placeholder="请输入密码" value="${prefill ? esc(cred.pass) : ''}"></div>
            </div>
            <div class="db-login-row">
              <label class="db-check"><input type="checkbox" checked> 记住账号</label>
              <button type="button" class="db-text-link" data-action="noop">忘记密码？</button>
            </div>
            <p class="db-form-error" data-error></p>
            <button class="db-btn db-btn--primary db-btn--block" type="submit">登 录</button>
          </form>
          ${role !== 'staff' ? `<p class="db-demo-hint">${role === 'shenchi' ? '患者端账号：shenchi_heart　密码：747474' : '工程端账号：shenbo　密码：686868'}</p>` : ''}
        </div>
        <div class="db-login-foot">
          <div>© 2026 国家器官分配与共享中心 版权所有</div>
          <div>仅限授权人员访问 · 所有操作将被记录</div>
        </div>
      </div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: OAS dashboard
     --------------------------------------------------------- */
  function oasHeader(active) {
    const nav = (id, label) => `<button type="button" class="db-oas-nav__item ${active === id ? 'is-active' : ''}" data-action="${id === 'dashboard' ? 'oas-nav' : 'oas-section'}" data-id="${id}">${label}</button>`;
    return `<header class="db-oas-header">
      <div class="db-oas-top">
        <div class="db-oas-top__inner">
          <div class="db-oas-brand">
            <span class="db-oas-logo">OAS</span>
            <div><div class="db-oas-brand__title">人体器官分配与共享信息平台</div><div class="db-oas-brand__sub">Organ Allocation &amp; Sharing System</div></div>
          </div>
          <div class="db-version">版本 v3.2.1</div>
          <button class="db-mobile-exit" type="button" data-action="back">退出</button>
        </div>
      </div>
      <nav class="db-oas-nav" aria-label="OAS 导航">
        <div class="db-oas-nav__inner">
          <div class="db-oas-nav__links">
            ${nav('dashboard', '工作台')}
            ${nav('archives', '档案管理')}
            ${nav('allocation', '分配记录')}
            ${nav('followup', '随访管理')}
            ${nav('alerts', '预警中心')}
          </div>
          <div class="db-oas-nav__user">
            <span>程未 · 器官协调员</span>
            <button type="button" class="db-nav-exit" data-action="back">${dbIcon('logout')}<span>退出</span></button>
          </div>
        </div>
      </nav>
    </header>`;
  }

  SCENES.oasDashboard = function () {
    const p = state.puzzles;
    const both = p.shenchi && p.shenbo;
    const stats = [
      { label: '本月器官分配数', value: '128', icon: 'activity' },
      { label: '等待移植名单', value: '2,437', icon: 'users' },
      { label: '术后随访中', value: '892', icon: 'heart' },
      { label: '本月完成随访', value: '356', icon: 'clipboard' },
      { label: '待跟进', value: '47', icon: 'users' },
      { label: '异常访问预警', value: '3', icon: 'bell', danger: true }
    ];
    const archiveRow = (a) => {
      const solved = !!p[a.id];
      return `<div class="db-archive-row">
        <div class="db-archive-icon ${solved ? 'is-solved' : ''}">${dbIcon(a.id === 'shenchi' ? 'heart' : 'file')}</div>
        <div class="db-archive-main">
          <div class="db-archive-titleline">
            <strong>${esc(a.name)}</strong>
            <span class="db-tag ${solved ? 'db-tag--green' : 'db-tag--red'}">${solved ? '已复核' : esc(a.status)}</span>
            <span class="db-code">${esc(a.archiveNo)}</span>
          </div>
          <div class="db-archive-meta">${a.age}岁 <i></i> ${esc(a.city)} <i></i> ${esc(a.organ)}</div>
          <p>${esc(a.summary)}</p>
        </div>
        <button type="button" class="db-row-link" data-action="open-archive" data-id="${a.id}">查看详情 →</button>
      </div>`;
    };
    const followups = [
      ['OAS-2026-00187', '王建国', '肝脏移植', '正常', '2026-03-12'],
      ['OAS-2026-00203', '李秀兰', '肾脏移植', '正常', '2026-03-10'],
      ['OAS-2026-00156', '张伟', '心脏移植', '观察中', '2026-03-08']
    ];
    return `<main class="screen db-page db-page--oas">
      ${oasHeader('dashboard')}
      <div class="db-container">
        <div class="db-breadcrumb">当前位置：工作台</div>
        <section class="db-page-head">
          <div><h1>OAS 器官分配与共享工作台</h1><p>欢迎回来，程未（OAS 器官协调员）</p></div>
          <div class="db-date">2026年10月24日 星期六</div>
        </section>

        <div class="db-stat-grid">
          ${stats.map((s) => `<div class="db-stat ${s.danger ? 'is-danger' : ''}">
            <div class="db-stat__icon">${dbIcon(s.icon)}</div>
            <div class="db-stat__label">${s.label}</div>
            <div class="db-stat__value">${s.value}</div>
          </div>`).join('')}
        </div>

        <section class="db-panel">
          <div class="db-panel-head db-panel-head--danger">
            <div>${dbIcon('alert')}<strong>异常档案</strong><span class="db-tag db-tag--red">2 份待处理</span></div>
            <button type="button" class="db-text-link" data-action="oas-section" data-id="archives">查看全部 →</button>
          </div>
          ${D.oas.archives.map(archiveRow).join('')}
        </section>

        <section class="db-panel">
          <div class="db-panel-head db-panel-head--amber">
            <div>${dbIcon('alert')}<strong>异常访问预警</strong><span class="db-badge db-badge--amber">高危 · 3 条</span></div>
            <button type="button" class="db-text-link" data-action="oas-section" data-id="alerts">查看全部</button>
          </div>
          ${D.oas.alerts.map((a) => `<div class="db-alert-row">
            <div class="db-alert-row__icon">${dbIcon('shield')}</div>
            <div><strong>${esc(a.title)}</strong><p>${esc(a.body)}</p><span>${esc(a.time)}</span></div>
            <span class="db-tag db-tag--amber">${esc(a.level)}危</span>
          </div>`).join('')}
          <div class="db-panel-foot">已自动拦截 <strong>1,247</strong> 次非法请求</div>
        </section>

        <section class="db-panel">
          <div class="db-panel-head"><div>${dbIcon('clipboard')}<strong>近期随访记录</strong></div><button type="button" class="db-text-link" data-action="oas-section" data-id="followup">全部随访 →</button></div>
          <div class="db-table-wrap"><table class="db-table">
            <thead><tr><th>档案编号</th><th>姓名</th><th>类型</th><th>状态</th><th>最近随访</th></tr></thead>
            <tbody>${followups.map((r) => `<tr><td class="db-code">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td><span class="db-dot ${r[3] === '正常' ? 'is-green' : 'is-amber'}"></span>${r[3]}</td><td>${r[4]}</td></tr>`).join('')}</tbody>
          </table></div>
        </section>

        ${(both || p.base64 || p.hellLogin) ? `<section class="db-panel db-entry-panel">
          <div class="db-panel-head"><div>${dbIcon('search')}<strong>调查入口</strong></div><span class="db-muted">已解锁</span></div>
          <div class="db-entry-links">
            ${both ? `<button type="button" class="db-entry" data-action="go" data-id="institute">${dbIcon('file')}<span>临渊研究所官网</span><em>已解锁</em></button>` : ''}
            ${p.base64 ? `<button type="button" class="db-entry" data-action="go" data-id="forum">${dbIcon('search')}<span>华夏灵异网</span><em>已解锁</em></button>` : ''}
            ${p.hellLogin ? `<button type="button" class="db-entry" data-action="go" data-id="hell">${dbIcon('alert')}<span>十八层</span><em>已进入</em></button>` : ''}
          </div>
        </section>` : ''}

        <div class="db-oas-footer"><span>OAS-XA / build 2026.10.24 / 所有操作写入审计日志</span><span>当前身份：${esc(currentIdentityLabel())}</span></div>
      </div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: archive detail
     --------------------------------------------------------- */
  SCENES.archive = function () {
    const a = findArchive(state.archiveId);
    const solved = !!state.puzzles[a.id];
    const isShenbo = a.id === 'shenbo';
    const puzzle = a.puzzle;
    return `<main class="screen db-page db-page--oas">
      ${oasHeader('archives')}
      <div class="db-container">
        <div class="db-breadcrumb">当前位置：档案管理 / 异常档案 / ${esc(a.archiveNo)}</div>
        <div class="db-page-head db-page-head--flat">
          <div><h1>${esc(a.tag)}</h1><p>${esc(a.hospital)} · 最近更新 2026-10-24 03:47</p></div>
          <button type="button" class="db-btn db-btn--ghost" data-action="back">← 返回工作台</button>
        </div>

        <section class="db-profile-card">
          <div class="db-profile-top">
            <div class="db-avatar db-avatar--lg">${esc(a.name.slice(0, 1))}</div>
            <div class="db-profile-name"><h2>${esc(a.name)} <span>${esc(a.sex)} / ${a.age}岁</span></h2><p>${esc(a.job)} · ${esc(a.city)}</p></div>
            <span class="db-tag ${solved ? 'db-tag--green' : 'db-tag--red'}">${solved ? '已复核' : '待复核'}</span>
          </div>
          <div class="db-profile-grid">
            <div><span>档案编号</span><strong>${esc(a.archiveNo)}</strong></div>
            <div><span>${isShenbo ? '设备编号' : '移植类型'}</span><strong>${esc(a.organ)}</strong></div>
            <div><span>${isShenbo ? '负责区域' : '血型'}</span><strong>${esc(isShenbo ? a.city : a.blood)}</strong></div>
            <div><span>${isShenbo ? '最近工单' : '手术日期'}</span><strong>${esc(a.date)}</strong></div>
          </div>
        </section>

        <div class="db-archive-layout">
          <div class="db-stack">
            <section class="db-panel">
              <div class="db-panel-head"><div>${dbIcon('clipboard')}<strong>病历与随访记录</strong></div><span class="db-muted">${a.records.length} 条记录</span></div>
              <div class="db-record-list">
                ${a.records.map((r) => `<div class="db-record">
                  <div class="db-record__meta"><span class="db-record__type">${esc(r.type)}</span><span>${esc(r.date)}</span><span>${esc(r.doctor)}</span></div>
                  <p>${esc(r.text)}</p>
                </div>`).join('')}
              </div>
            </section>

            <section class="db-panel">
              <div class="db-panel-head"><div>${dbIcon('file')}<strong>档案摘要</strong></div><span class="db-muted">AUTO SUMMARY</span></div>
              <div class="db-panel-body">
                <p class="db-summary">${esc(a.summary)}</p>
                <div class="db-callout ${isShenbo ? 'db-callout--amber' : 'db-callout--blue'}">
                  ${dbIcon('alert')}<span>${isShenbo ? '该档案关联 2019 年旧工单。张桂兰，女，63 岁，2026-08-24 03:47 于心内科 3 号床去世。' : '供体 D-074 的原始身份信息已被完整匿名化。调阅记录显示，程遥曾于 2021 年查阅过该档案。'}</span>
                </div>
              </div>
            </section>
          </div>

          <aside class="db-stack">
            <section class="db-panel db-puzzle-card">
              <div class="db-panel-head"><div>${dbIcon(isShenbo ? 'monitor' : 'lock')}<strong>${isShenbo ? '异常波形 · 附件 68' : '附件 074 · 乱码文本'}</strong></div><span class="db-tag">${solved ? '已解密' : esc(puzzle.type)}</span></div>
              <div class="db-panel-body">
                ${solved ? `<div class="db-success-box">
                  <span class="db-success-answer">${esc(puzzle.answer)}</span>
                  <strong>${esc(puzzle.successTitle)}</strong>
                  <p>${esc(puzzle.successText)}</p>
                  <button class="db-btn db-btn--primary db-btn--sm" type="button" data-action="go-puzzle-next" data-id="${a.id}">查看已解锁入口</button>
                </div>` : `
                  ${isShenbo ? `<div class="db-cipher">${['.----', '....-', '--...', '....-'].map((code) => `<span>${code}</span>`).join('')}</div>` : `<div class="db-cipher">${puzzle.cipher.split('').map((c) => `<span>${esc(c)}</span>`).join('')}</div>`}
                  <p class="db-hint">${esc(puzzle.hint)}</p>
                  ${isShenbo ? `<button class="db-btn db-btn--ghost db-btn--sm db-btn--block" type="button" data-action="play-morse" style="margin-bottom:12px">▶ 播放信号节奏</button>` : ''}
                  <form data-form="archive-puzzle" data-id="${a.id}">
                    <label class="db-label" for="archive-answer">${isShenbo ? '输入解出的数字' : '输入解密结果（英文）'}</label>
                    <input class="db-input" id="archive-answer" name="answer" type="text" inputmode="${isShenbo ? 'numeric' : 'text'}" autocomplete="off" placeholder="${isShenbo ? '四位数字' : '拼音或英文'}">
                    <p class="db-form-error" data-error></p>
                    <button class="db-btn db-btn--primary db-btn--block" type="submit">提交校验</button>
                  </form>
                  <p class="db-tip">若忘记规则，线索栏会保留已发现的方法。</p>`}
              </div>
            </section>

            <section class="db-panel">
              <div class="db-panel-head"><div>${dbIcon('file')}<strong>关联入口</strong></div></div>
              <div class="db-kv-list">
                <div><span>临渊研究所</span><strong>${bothSolved() ? '已解锁' : '待复核'}</strong></div>
                <div><span>医院报修系统</span><strong>${state.puzzles.shenbo ? '已解锁' : '待复核'}</strong></div>
                <div><span>调查视角</span><strong>${esc(currentIdentityLabel())}</strong></div>
              </div>
            </section>
          </aside>
        </div>

        <div class="db-bottom-cta">
          <div><strong>${bothSolved() ? '两份异常档案已完成复核' : '还需要复核另一份异常档案'}</strong><p>${bothSolved() ? '临渊医学人文研究所官网入口已开放。' : '两份档案都解密后，系统会开放外部研究机构入口。'}</p></div>
          ${bothSolved() ? '<button class="db-btn db-btn--primary" type="button" data-action="go" data-id="institute">进入临渊研究所</button>' : '<button class="db-btn db-btn--ghost" type="button" data-action="back">返回工作台</button>'}
        </div>
        <div class="db-oas-footer"><span>${esc(a.archiveNo)} / 审计编号 AX-2026-0314</span><span>请勿截图、外传或向患者本人展示本页</span></div>
      </div>
    </main>`;
  };

  function bothSolved() {
    return !!(state.puzzles.shenchi && state.puzzles.shenbo);
  }

  /* ---------------------------------------------------------
     SCENE: institute
     --------------------------------------------------------- */
  function instHeader(active) {
    return `<header class="inst-header">
      <div class="inst-header__top">
        <div class="inst-brand">
          <div class="mark">渊</div>
          <div><div class="name">临渊医学人文研究所</div><div class="en">ABYSS INSTITUTE OF MEDICAL HUMANITIES</div></div>
        </div>
        <div class="inst-header__meta-wrap">
          <button class="inst-back" type="button" data-action="back">← 返回</button>
          <div class="inst-header__meta">CHENGDU · CHINA<br>EST. 2016 / INTERNAL ARCHIVE</div>
        </div>
      </div>
      <nav class="inst-nav" aria-label="研究所导航">
        <div class="inst-nav__inner">
          ${D.institute.nav.map((n) => `<button type="button" class="${active === n.id ? 'is-active' : ''}" data-action="institute-tab" data-id="${n.id}">${esc(n.label)}</button>`).join('')}
        </div>
      </nav>
    </header>`;
  }

  function instituteFooter() {
    return `<footer class="institute-footer">
      <div>临渊医学人文研究所 · 成都锦江区春熙路 74 号<br>蜀 ICP 备 2026-0074 号（虚构）</div>
      <div style="text-align:right">ARCHIVE TEMP 18°C / RH 45%<br>© 2026 ABYSS INSTITUTE. ALL MEMORIES RESERVED.</div>
    </footer>`;
  }

  function newsRow(n) {
    return `<button class="news-row" type="button" data-action="open-news" data-id="${n.id}">
      <span class="date">${esc(n.date)}</span>
      <span><h3>${esc(n.title)}</h3><p>${esc(n.summary)}</p></span>
      <span class="cat">${esc(n.category)}</span>
    </button>`;
  }

  function newsArticleView() {
    const n = D.institute.news.find((x) => x.id === state.ui.newsArticle);
    if (!n) return '';
    const extra = {
      n2: [
        '项目组今日公布第二阶段采集结果。本轮采集覆盖成都、重庆、西安等 12 个城市，共 17 台 YQSM 系列设备。',
        '研究负责人表示，所有数据均已脱敏，仅用于心脏节律个体差异研究。项目组同时强调，采集过程中未发现任何“非设备来源”的声音。',
        '当记者追问设备在凌晨 03:47 自动启动的传闻时，负责人未予置评。'
      ],
      n3: [
        '根据新规，D 系列供体档案的调阅需同时获得所长、伦理委员会及捐赠者家属三方书面同意。',
        '此前，任何拥有 LEVEL 3 权限的 OAS 协调员均可调阅匿名供体摘要。新规生效后，相关入口将从内部系统下线。',
        '本规定自 2026 年 7 月 1 日起施行。'
      ],
      n4: [
        '盘阳生物科技今日向临渊医学人文研究所捐赠 12 台 YQSM-2026 多参数监护仪，用于术后睡眠结构研究。',
        '首批设备已安装于心脏移植中心 3 号床。设备工程部表示，所有设备均通过出厂自检。',
        '捐赠仪式上，盘阳生物 CEO 鲍达人未到场。'
      ]
    };
    const body = n.body || extra[n.id] || [n.summary];
    const cipherBlock = n.id === 'n1' ? `<div class="news-cipher">
      <div class="news-cipher__head">附件校验 / download_key.txt</div>
      <div class="news-cipher__body">
        <code>${esc(n.cipher)}</code>
        <p>${esc(n.cipherHint)}</p>
        ${state.puzzles.base64 ? `<div class="puzzle-success" style="margin-top:12px">
          <h3>校验通过</h3>
          <p>${esc(n.unlockText)}</p>
          <button class="btn btn--sm btn--primary" type="button" data-action="go" data-id="forum">进入华夏灵异网</button>
        </div>` : `<form data-form="news-cipher" style="margin-top:12px">
          <label class="field-label" for="news-answer">输入解码结果</label>
          <div class="input-row"><input class="field" id="news-answer" name="answer" type="text" inputmode="numeric" autocomplete="off" placeholder="5 位数字"><button class="btn btn--primary" type="submit">校验</button></div>
          <p class="form-error" data-error></p>
        </form>`}
      </div>
    </div>` : '';
    return `<div class="forum-crumbs" style="margin:18px 0 0"><button type="button" data-action="close-news">← 返回新闻列表</button></div>
      <article class="news-article">
        <div class="news-article__head">
          <p class="eyebrow" style="color:#77998f">${esc(n.category)} / ${esc(n.date)}</p>
          <h2>${esc(n.title)}</h2>
          <div class="news-article__meta"><span>临渊通讯</span><span>记者 林录</span><span>成都院区</span><span>阅读 74</span></div>
        </div>
        <div class="news-article__body">
          ${body.map((p) => `<p>${esc(p)}</p>`).join('')}
        </div>
        <div class="news-article__foot">${cipherBlock}</div>
      </article>`;
  }

  SCENES.institute = function () {
    const tab = state.ui.instituteTab || 'home';
    let content = '';
    if (tab === 'home') {
      content = `
        <section class="inst-hero">
          <div class="inst-hero__text">
            <p class="eyebrow">${esc(D.institute.hero.kicker)}</p>
            <h1>${esc(D.institute.hero.title)}</h1>
            <p>${esc(D.institute.hero.text)}</p>
          </div>
          <div class="inst-hero__badge">CHENGDU · 30.67°N / 104.07°E</div>
        </section>

        <section class="inst-section">
          <div class="inst-section__head"><h2>我们在做什么</h2><p>RESEARCH / CARE / MEMORY</p></div>
          <div class="inst-cards">
            <div class="inst-card"><div class="num">01 / CARE</div><h3>术后心理随访</h3><p>我们相信，器官移植不是终点，而是另一个人生问题的开始。中心为每一位受者提供长期、匿名的心理支持。</p></div>
            <div class="inst-card"><div class="num">02 / MEMORY</div><h3>生命档案保存</h3><p>从 1967 年第一例心脏移植开始，我们保存每一份可被允许保存的病例、剪报与声音。</p></div>
            <div class="inst-card"><div class="num">03 / PULSE</div><h3>搏印研究</h3><p>与盘阳生物科技合作，研究心脏节律中的个体差异。我们试图确认：一颗心，是否记得它原来的主人。</p></div>
          </div>
        </section>

        <section class="inst-section inst-split">
          <div class="inst-photo"><div class="inst-photo__caption">心脏移植中心 / 3 号床 / 03:47</div></div>
          <div class="inst-quote">
            <blockquote>“我们记录的不是死亡。是死亡发生之后，仍然留在房间里的那部分人。”</blockquote>
            <cite>—— 张建新，所长</cite>
          </div>
        </section>

        <section class="inst-section">
          <div class="inst-section__head"><h2>新闻动态</h2><p>NEWSROOM</p></div>
          <div class="news-list">${D.institute.news.slice(0, 3).map(newsRow).join('')}</div>
        </section>
        ${instituteFooter()}`;
    } else if (tab === 'about') {
      content = `<div class="inst-text">
        <p class="eyebrow">ABOUT / 01</p>
        <h1>${esc(D.institute.about.title)}</h1>
        <p class="lead">${esc(D.institute.about.lead)}</p>
        ${D.institute.about.paras.map((p) => `<p>${esc(p)}</p>`).join('')}
        <div class="fact-grid">${D.institute.about.facts.map(([k, v]) => `<div class="fact-item"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div>
        <h2 style="font-family:var(--serif);font-weight:500;color:#244c3f;margin:34px 0 0">研究所成员</h2>
        <div class="people-grid">${D.institute.about.people.map((p) => `<div class="person-card"><div class="avatar">${esc(p.name.slice(0, 1))}</div><h3>${esc(p.name)}</h3><div class="role">${esc(p.role)}</div><p>${esc(p.note)}</p></div>`).join('')}</div>
      </div>
      ${instituteFooter()}`;
    } else if (tab === 'news') {
      content = state.ui.newsArticle ? newsArticleView() : `<div class="inst-text" style="margin-bottom:22px">
          <p class="eyebrow">NEWSROOM / 2026 Q3</p>
          <h1>新闻动态</h1>
          <p class="lead">研究所公开信息、临床观察与项目进展。</p>
        </div>
        <div class="news-list">${D.institute.news.map(newsRow).join('')}</div>
        ${instituteFooter()}`;
    } else if (tab === 'archive') {
      content = `<div class="inst-text">
        <p class="eyebrow">ARCHIVE / LEVEL 3</p>
        <h1>${esc(D.institute.archive.title)}</h1>
        <p class="lead">${esc(D.institute.archive.intro)}</p>
        <div class="inst-cards" style="grid-template-columns:1fr 1fr">${D.institute.archive.items.map((i) => `<div class="inst-card">
          <div class="num">${esc(i.code)} · ${esc(i.type)} · ${esc(i.date)}</div>
          <h3>${esc(i.title)}</h3>
          <p>${esc(i.body)}</p>
        </div>`).join('')}</div>
        <p style="margin-top:18px;color:#98a49d;font-size:10px">${esc(D.institute.archive.footer)}</p>
      </div>
      ${instituteFooter()}`;
    } else if (tab === 'heart') {
      content = `<div class="inst-text">
        <p class="eyebrow">CENTER / HEART TRANSPLANT</p>
        <h1>${esc(D.institute.heart.title)}</h1>
        <p class="lead">${esc(D.institute.heart.lead)}</p>
        ${D.institute.heart.paras.map((p) => `<p>${esc(p)}</p>`).join('')}
        <div class="fact-grid">${D.institute.heart.stat.map(([k, v]) => `<div class="fact-item"><div class="k">${esc(v)}</div><div class="v">${esc(k)}</div></div>`).join('')}</div>
        <div class="notice notice--red">${esc(D.institute.heart.notice)}</div>
      </div>
      <section class="inst-section inst-split">
        <div class="inst-photo" style="background-image:url('./assets/heart-center.jpg')"><div class="inst-photo__caption">心脏医学研究中心 / 夜间外景</div></div>
        <div class="inst-quote"><blockquote>“监护仪不会说谎。说谎的是看见数字的人。”</blockquote><cite>—— 设备工程部内部培训材料</cite></div>
      </section>
      ${instituteFooter()}`;
    } else if (tab === 'equipment') {
      content = `<div class="inst-text">
        <p class="eyebrow">DEPARTMENT / BIOMEDICAL ENGINEERING</p>
        <h1>${esc(D.institute.equipment.title)}</h1>
        <p class="lead">${esc(D.institute.equipment.lead)}</p>
        ${D.institute.equipment.paras.map((p) => `<p>${esc(p)}</p>`).join('')}
        <div class="fact-grid">${D.institute.equipment.stats.map(([k, v]) => `<div class="fact-item"><div class="k">${esc(v)}</div><div class="v">${esc(k)}</div></div>`).join('')}</div>
        <div class="notice notice--red">${esc(D.institute.equipment.warning)}</div>
        <p style="margin-top:22px"><button class="btn btn--sm btn--gold" type="button" data-action="go-portal" data-id="shenbo">前往设备工程端 →</button></p>
      </div>
      <section class="inst-section inst-split">
        <div class="inst-photo" style="background-image:url('./assets/equipment-lab.jpg')"><div class="inst-photo__caption">中心实验室 / YQSM-2026 采集节点</div></div>
        <div class="inst-quote"><blockquote>“YQSM = 仪器声明。它在声明：我来过。”</blockquote><cite>—— 沈搏，维修记录 2026-03-18</cite></div>
      </section>
      ${instituteFooter()}`;
    } else {
      content = `<div class="inst-text">
        <p class="eyebrow">CONTACT / B1</p>
        <h1>${esc(D.institute.contact.title)}</h1>
        <p class="lead">如果你有一份无法归档的记忆，欢迎来找我们。</p>
      </div>
      <div class="contact-grid" style="margin-top:26px">
        <div class="contact-card"><h3>研究所地址</h3><dl>
          <dt>地址</dt><dd>${esc(D.institute.contact.address)}</dd>
          <dt>电话</dt><dd>${esc(D.institute.contact.phone)}</dd>
          <dt>邮箱</dt><dd>${esc(D.institute.contact.email)}</dd>
          <dt>时间</dt><dd>${esc(D.institute.contact.hours)}</dd>
        </dl><p class="tiny" style="color:#9a7b72;margin-top:18px;line-height:1.8">${esc(D.institute.contact.note)}</p></div>
        <div class="contact-card" style="padding:0;overflow:hidden"><div class="contact-map"></div></div>
      </div>
      <p style="margin-top:16px;color:#98a49d;font-size:9px">地图为虚构示意图。请勿根据本页内容前往任何真实地点。</p>
      ${instituteFooter()}`;
    }
    return `<main class="screen screen--institute">
      ${instHeader(tab)}
      <div class="inst-main">${content}</div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: huaxia forum
     --------------------------------------------------------- */
  function forumHeader() {
    return `<header class="forum-head">
      <div class="forum-head__top">
        <div class="forum-brand"><span class="name">华夏灵异网</span><span class="sub">HUAXIA PARANORMAL FORUM / SINCE 2003</span></div>
        <div class="forum-head__meta-wrap">
          <span class="forum-head__meta">游客浏览 · 今日在线 74 · 帖子 13,338</span>
          <button class="forum-back" type="button" data-action="back">← 返回</button>
        </div>
      </div>
      <nav class="forum-nav" aria-label="论坛导航">
        <button class="is-active" type="button" data-action="forum-stub" data-id="discuss">异闻讨论区</button>
        <button type="button" data-action="forum-stub" data-id="archive">旧帖归档</button>
        <button type="button" data-action="forum-stub" data-id="notice">站务公告</button>
        <button type="button" data-action="forum-stub" data-id="login">登录 / 注册</button>
      </nav>
    </header>`;
  }

  function forumList() {
    return `<div class="forum-notice">${esc(D.forum.notice)}</div>
      <div class="forum-toolbar"><h1>异闻讨论区</h1><div class="crumbs">首页 / 异闻 / 全部主题</div></div>
      <div class="post-table">
        ${D.forum.posts.map((p) => `<button class="post-row" type="button" data-action="open-post" data-id="${p.id}">
          <span class="post-row__icon">${p.id === 'p1' ? '异' : p.id === 'p2' ? '心' : '层'}</span>
          <span class="post-row__main"><h2>${esc(p.title)}</h2><p>${esc(p.excerpt)}</p></span>
          <span class="post-row__author"><strong>${esc(p.author)}</strong>${esc(p.time)}</span>
          <span class="post-row__stats"><span>${esc(p.views)} 浏览</span><span class="${p.hot ? 'hot' : ''}">${p.replies} 回复</span></span>
        </button>`).join('')}
      </div>
      <div class="forum-pager"><span class="is-active">1</span><span>2</span><span>3</span><span>…</span><span>74</span></div>
      <div class="forum-foot">华夏灵异网 · 所有故事均来自网友投稿，真实性无法核实。<br>请勿在深夜独自阅读。</div>`;
  }

  function forumThread() {
    const p = D.forum.posts.find((x) => x.id === state.ui.forumPost);
    if (!p) return forumList();
    const isP1 = p.id === 'p1';
    const accountBlock = p.hiddenAccount ? `<div class="account-scrap">站内信残页 · 已损坏<br><strong>${esc(p.hiddenAccount.text)}</strong></div>` : '';
    const staffBlock = p.hiddenStaff ? `<div class="account-scrap">残留表单 · 未提交<br><strong>${esc(p.hiddenStaff.text)}</strong><br><button class="hidden-link" type="button" data-action="go" data-id="panyangLogin" style="min-height:34px;font-size:11px">打开员工内网 →</button></div>` : '';
    return `<div class="forum-crumbs"><button type="button" data-action="forum-list">异闻讨论区</button> / 帖子归档 / ${esc(p.id.toUpperCase())}</div>
      <article class="thread">
        <div class="thread__head"><h1>${esc(p.title)}</h1><div class="thread__meta"><span>楼主：${esc(p.author)}</span><span>${esc(p.time)}</span><span>${esc(p.views)} 浏览</span><span>${p.replies} 回复</span></div></div>
        <div class="thread__body">${p.body.map((t) => `<p>${esc(t)}</p>`).join('')}</div>
        <div class="floor-list">${p.replyList.map((r) => `<div class="floor">
          <div class="floor__side"><strong>${esc(r.user)}</strong>${esc(r.floor)}</div>
          <div class="floor__body">${esc(r.text)}<span class="sig">—— 发布于 ${isP1 && r.floor === '17楼' ? '03:47' : '未知时间'}</span></div>
        </div>`).join('')}</div>
        ${isP1 ? `<div class="hidden-reveal">
          <span class="whisper">—— 你翻到了帖子最底部。有一行字像是后来才出现的。</span>
          <button class="hidden-link" type="button" data-action="go-hell-login"><span>${esc(p.hidden.text)}</span><span class="arrow">↗</span></button>
        </div>` : `<div class="hidden-reveal"><span class="whisper">—— 帖子底部只剩一段被删除的签名档。</span>${accountBlock}${staffBlock}</div>`}
      </article>
      <div class="forum-foot">本帖最后由 匿名 于 03:47 编辑。<br>如果这行字在你刷新后消失，请不要害怕。</div>`;
  }

  SCENES.forum = function () {
    return `<main class="screen screen--forum">
      ${forumHeader()}
      <div class="forum-main">${state.ui.forumPost ? forumThread() : forumList()}</div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: panyang
     --------------------------------------------------------- */
  SCENES.panyangLogin = function () {
    return `<main class="screen db-panyang-login">
      <header class="db-py-header">
        <div class="db-py-header__inner">
          <div class="db-py-brand"><span class="mark">PY</span><div><strong>盘阳生物科技</strong><small>PANYANG BIOSCIENCE / CHENGDU</small></div></div>
          <div class="db-version">员工内网 / INTERNAL</div>
        </div>
      </header>
      <div class="db-py-main">
        <div class="db-login-card">
          <div class="db-py-card-head">
            <p class="db-eyebrow">EMPLOYEE PORTAL</p>
            <h1>员工内网</h1>
            <p>仅限盘阳生物及合作机构员工使用。所有操作将被记录在“搏印”审计系统。</p>
          </div>
          <form class="db-login-form" data-form="panyang-login" novalidate>
            <div class="db-field-group"><label for="py-user">员工编号</label><div class="db-input-wrap">${dbIcon('user')}<input class="db-input" id="py-user" name="user" type="text" autocomplete="username" placeholder="例如：PY068"></div></div>
            <div class="db-field-group"><label for="py-pass">密码</label><div class="db-input-wrap">${dbIcon('lock')}<input class="db-input" id="py-pass" name="pass" type="password" autocomplete="current-password" placeholder="请输入密码"></div></div>
            <p class="db-form-error" data-error></p>
            <button class="db-btn db-btn--block db-btn--teal" type="submit">登 录</button>
          </form>
          <p class="db-demo-hint">员工编号：PY068　密码：686868<br>凭据来自华夏灵异网旧帖的残留表单。</p>
          <div class="db-py-foot"><button class="db-text-link" type="button" data-action="back">← 返回华夏灵异网</button></div>
        </div>
      </div>
    </main>`;
  };

  function panyangMapSVG() {
    const pts = D.hell.cities.map((c) => {
      const x = 40 + ((c.lon - 73) / 62) * 690;
      const y = 30 + ((54 - c.lat) / 36) * 420;
      return { ...c, x, y };
    });
    return `<svg viewBox="0 0 760 480" xmlns="http://www.w3.org/2000/svg" aria-label="十二城设备节点">
      ${[1, 2, 3, 4, 5, 6].map((i) => `<line class="grid" x1="${i * 108}" y1="0" x2="${i * 108}" y2="480"/>`).join('')}
      ${[1, 2, 3, 4].map((i) => `<line class="grid" x1="0" y1="${i * 96}" x2="760" y2="${i * 96}"/>`).join('')}
      <path d="M100 300 Q190 210 300 250 T520 210 T690 310" fill="none" stroke="#c9dae2" stroke-width="1.2" stroke-dasharray="4 7"/>
      ${pts.map((c) => `<g><circle class="node ${c.main ? 'main' : ''}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${c.main ? 5 : 3.3}"/><text class="label ${c.main ? 'main' : ''}" x="${(c.x + 8).toFixed(1)}" y="${(c.y + 3).toFixed(1)}">${esc(c.name)}</text></g>`).join('')}
    </svg>`;
  }

  SCENES.panyang = function () {
    const tab = state.ui.panyangTab || 'home';
    const tabs = [
      ['home', '首页'], ['notices', '内部公告'], ['mail', '内部邮件'], ['records', '巡检记录'], ['map', '十二城节点']
    ];
    let body = '';
    if (tab === 'home') {
      body = `<div class="panyang-banner"><div><p class="eyebrow" style="color:#8ed1cf">WELCOME BACK / PY068</p><h1>设备工程部 · 沈搏</h1><p>西南片区 · 今日待处理 2 项 · 最近同步 03:47</p></div></div>
        <div class="panyang-grid">
          <section class="panyang-panel"><div class="panyang-panel__head"><h2>重点公告</h2><span class="chip chip--green">2 条</span></div><div class="panyang-panel__body">
            ${D.panyang.announcements.map((a) => `<div class="announcement"><div class="meta"><span>${esc(a.date)}</span><span>${esc(a.from)}</span></div><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p></div>`).join('')}
          </div></section>
          <aside class="panyang-panel"><div class="panyang-panel__head"><h2>节点状态</h2></div><div class="panyang-panel__body">
            <div style="font-family:var(--mono);font-size:38px;color:#206b72;line-height:1">12<span style="font-size:10px;color:#8b9ba7;margin-left:7px">/ 12 ONLINE</span></div>
            <div style="height:6px;background:#e7eef2;margin:14px 0 18px"><div style="width:100%;height:100%;background:#2e8a90"></div></div>
            <div class="side-list"><div><span>成都主节点</span><strong>在线</strong></div><div><span>西安节点</span><strong>在线</strong></div><div><span>异常波形</span><strong style="color:#a83a3a">68s</strong></div><div><span>下一轮同步</span><strong>03:47</strong></div></div>
          </div></aside>
        </div>`;
    } else if (tab === 'notices') {
      body = `<section class="panyang-panel"><div class="panyang-panel__head"><h2>内部公告 / ${esc(D.panyang.name)}</h2><span class="tiny muted">仅内部</span></div><div class="panyang-panel__body">
        ${D.panyang.announcements.map((a) => `<div class="announcement"><div class="meta"><span>${esc(a.date)}</span><span>${esc(a.from)}</span></div><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p></div>`).join('')}
      </div></section>`;
    } else if (tab === 'mail') {
      body = `<section class="panyang-panel"><div class="panyang-panel__head"><h2>内部邮件</h2><span class="tiny muted">2 封未读</span></div><div class="panyang-panel__body">
        ${D.panyang.emails.map((m) => `<div class="mail-row"><div class="from">${esc(m.from)} · ${esc(m.date)}</div><h3>${esc(m.subject)}</h3><p>${nl2br(m.body)}</p></div>`).join('')}
      </div></section>`;
    } else if (tab === 'records') {
      body = `<section class="panyang-panel"><div class="panyang-panel__head"><h2>巡检记录 · 沈搏</h2><span class="tiny muted">近 30 天</span></div><div class="panyang-panel__body">
        ${D.panyang.records.map((r) => `<div class="mail-row"><div class="from">${esc(r.date)}</div><p style="color:#566b79;font-size:11px;line-height:1.9">${esc(r.text)}</p></div>`).join('')}
        <button class="btn btn--sm btn--gold" type="button" data-action="go-portal" data-id="shenbo" style="margin-top:14px">打开设备工程端 →</button>
      </div></section>`;
    } else {
      body = `<section class="panyang-panel"><div class="panyang-panel__head"><h2>十二城 · 搏印节点</h2><span class="tiny muted">全国布局</span></div><div class="panyang-panel__body" style="padding:0"><div class="panyang-map">${panyangMapSVG()}</div></div></section>
        <div class="notice notice--red" style="margin-top:14px">节点数据每日 03:47 自动回传。任何异常波形不得删除、复制或外传。</div>`;
    }
    return `<main class="screen screen--panyang">
      <header class="panyang-header">
        <div class="panyang-header__inner">
          <div class="panyang-logo"><span class="mark">PY</span><span>盘阳生物 · 员工内网</span></div>
          <div class="panyang-user"><span>${esc(D.panyang.staff)}</span><strong>${esc(D.panyang.ceo)} · CEO</strong><button class="text-link" type="button" data-action="forum-list">← 退出</button></div>
        </div>
        <nav class="panyang-nav" aria-label="盘阳内网">
          ${tabs.map(([id, label]) => `<button type="button" class="${tab === id ? 'is-active' : ''}" data-action="panyang-tab" data-id="${id}">${label}</button>`).join('')}
        </nav>
      </header>
      <div class="panyang-main">${body}
        <p style="margin-top:18px;color:#95a6b1;font-size:9px">盘阳生物科技 · 内部系统 · 未授权访问将被记录</p>
      </div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: 18th floor login
     --------------------------------------------------------- */
  SCENES.hellLogin = function () {
    return `<main class="screen screen--hell-login">
      <div class="hell-login-return"><button type="button" data-action="back">← 离开</button></div>
      <div class="hell-login-box">
        <div class="hexagram-wrap">
          <div class="hexagram-halo" aria-hidden="true"></div>
          ${hexagramSVG('hexagram-svg', '十八层六芒星印记')}
        </div>
        <h1 class="hell-login-title">十八层</h1>
        <p class="hell-login-en">THE EIGHTEENTH FLOOR</p>
        <p class="hell-login-sub">地下八块，合天上十块。<br>门在下面。</p>
        <form class="hell-form" data-form="hell-login" novalidate>
          <input class="field" name="user" type="text" inputmode="numeric" autocomplete="off" placeholder="代号" aria-label="代号">
          <input class="field" name="pass" type="password" inputmode="numeric" autocomplete="off" placeholder="印记" aria-label="印记">
          <p class="form-error" data-error style="text-align:center"></p>
          <button class="btn" type="submit">进 入</button>
        </form>
        <p class="hell-quote">${esc(D.hell.quote)}</p>
        <p class="hell-hint">“想找的人自然能找到。”<br>代号与印记相同。两位数字。与 74 有关。</p>
      </div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: 18th floor forum
     --------------------------------------------------------- */
  function hellHeader() {
    return `<header class="hell-header">
      <div class="hell-header__inner">
        <div class="hell-brand">
          ${hexagramSVG('sigil')}
          <div><div class="name">十八层</div><div class="en">THE EIGHTEENTH FLOOR / SESSION 74</div></div>
        </div>
        <div class="hell-header__right">
          <button class="hell-back" type="button" data-action="back">← 返回</button>
          <div class="hell-user"><span class="dot"></span>${esc(currentIdentityLabel())} · 已入内 · 03:47</div>
        </div>
      </div>
    </header>`;
  }

  function hellTabs() {
    const items = [
      ['scrolls', '卷轴'], ['map', '圣地图'], ['discussions', '讨论区'], ['vault', '内殿']
    ];
    return `<nav class="hell-nav" aria-label="十八层导航">
      ${items.map(([id, label]) => `<button type="button" class="${state.ui.hellTab === id ? 'is-active' : ''}" data-action="hell-tab" data-id="${id}">${label}${id === 'vault' && state.gameCompleted && warningCount() < 2 ? '<span style="color:#a31414"> ·</span>' : ''}</button>`).join('')}
    </nav>`;
  }

  function scrollCards() {
    const scripture = state.puzzles.scripture;
    const cards = [
      { id: 'doctrine', num: 'SCROLL 01', title: '教义总纲', desc: '我们供奉的不是神。它在沉睡。', status: '公开 · 已阅读' },
      { id: 'scripture', num: 'SCROLL 02', title: '黑暗经书', desc: '密文：EVHHVO。器皿的名字被藏在对面的字母里。', status: scripture ? '已解密 · VESSEL' : '加密 · 等待解读' },
      { id: 'leader', num: 'SCROLL 03', title: '教主手记', desc: '前 73 次实验都失败了。第 74 次，心脏活下来了。', status: '公开 · 已阅读' },
      { id: 'hidden', num: 'SCROLL 04', title: '隐藏手记', desc: scripture ? '灯芯、十二城、值班本、永恒之地。' : '这一页被经书压住了。', status: scripture ? '已解锁' : '锁定 · 需解经书' }
    ];
    return `<div class="scroll-grid">
      ${cards.map((c) => `<button class="scroll-card ${c.id === 'hidden' && !scripture ? 'is-locked' : ''} ${c.id === 'scripture' && scripture ? 'is-done' : ''}" type="button" data-action="open-scroll" data-id="${c.id}">
        <span class="scroll-card__num">${c.num}</span>
        <h2>${c.title}</h2>
        <p>${c.desc}</p>
        <span class="scroll-card__status">${c.status}　→</span>
      </button>`).join('')}
      <div class="scroll-card scroll-card--final">
        <span class="scroll-card__num">SCROLL 05 · THE LAST DOOR</span>
        <div class="final-row">
          <div><h2>最终门</h2><p>三条线索已汇集。输入那座城市的名字。</p></div>
          <button class="btn btn--primary" type="button" data-action="open-final-door">走向门 →</button>
        </div>
      </div>
    </div>`;
  }

  function hellMapView() {
    return `<div class="map-wrap">
      <div class="hell-map">${chinaMapSVG()}</div>
      <aside class="map-side">
        <div class="side-block"><h3>十二城 · 搏印节点</h3><p>鲍达人用二十年铺设的网络。每座城市有一台“耳朵”，每晚 03:47 把波形回传到成都。</p><div class="map-counter">12<span>NODES</span></div></div>
        <div class="side-block"><h3>成都 · 主节点</h3><p>春熙路 74 号，盘阳大厦 27F。地下还有八层。地图上不会有标记。</p><p style="color:#b06a5d">这里不是它的所在地。这里只是离它最近的地方。</p></div>
        <div class="side-block"><h3>坐标</h3><p style="font-family:var(--mono);font-size:9px;line-height:2">30.6570° N<br>104.0657° E<br>DEPTH: -18</p></div>
      </aside>
    </div>`;
  }

  function hellDiscussions() {
    return `<div class="discussion-list">
      ${D.hell.discussions.map((d, i) => {
        const open = state.ui.openDiscussion === String(i);
        return `<div class="discussion-item ${open ? 'is-open' : ''}">
          <button class="discussion-item__head" type="button" data-action="toggle-discussion" data-id="${i}">
            <span class="discussion-item__user">${esc(d.user)}</span>
            <span class="discussion-item__title">${esc(d.title)}</span>
            <span class="discussion-item__reply">${d.replies} 回复</span>
          </button>
          <div class="discussion-item__body"><p>${esc(d.body)}</p></div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function vaultView() {
    if (!state.gameCompleted) {
      return `<div class="vault-grid">
        <div class="vault-card is-locked"><h2>私信 · heart_74</h2><p>这个板块只在二周目开放。完成一次调查后，再回到这里。</p><span class="chip">二周目解锁</span></div>
        <div class="vault-card is-locked"><h2>设备维护 · engineer_68</h2><p>沈搏的维修记录、最后一通电话，以及那段 68 秒录音。</p><span class="chip">二周目解锁</span></div>
      </div><p class="vault-note">“你不是那些凡夫俗子。你又来了，程先生。”</p>`;
    }
    const shenchiDone = !!state.choices.shenchi;
    const shenboDone = !!state.choices.shenbo;
    return `<div class="vault-grid">
      <section class="vault-card">
        <h2>私信 · heart_74</h2>
        <p>${shenchiDone ? '沈迟的最后一条消息停留在 03:47。' : '沈迟在论坛上找到了你。他还没有睡。'}</p>
        ${shenchiDone ? `<div class="message-bubble is-mine"><span class="from">你 / 程未</span>${state.choices.shenchi === 'warn' ? '别停药，好好养着。' : '别想这些，回家吧。'}</div>
          <div class="message-bubble"><span class="from">heart_74</span>${state.choices.shenchi === 'warn' ? '好，我听你的。我不吃别的药了。' : '……好。那我回家了。'}</div>
          <p class="tiny" style="color:${state.warnings.shenchi ? '#74b58d' : '#7e6258'}">${state.warnings.shenchi ? '一条线已被改写。' : '这条线没有改变。'}</p>`
        : `<div class="scroll-cipher" style="margin-top:0"><p class="tiny" style="color:#7f6659">要回复他，需要进入患者样本端。</p><button class="btn btn--sm btn--primary" type="button" data-action="go-portal" data-id="shenchi">登录患者样本端 →</button></div>`}
      </section>
      <section class="vault-card">
        <h2>设备维护 · engineer_68</h2>
        <p>${shenboDone ? '工单已被关闭。录音没有被播放。' : '沈搏留了一条未完成的工单。录音还在。'}</p>
        ${shenboDone ? `<div class="message-bubble is-mine"><span class="from">你 / 程未</span>${state.choices.shenbo === 'warn' ? '别点开录音，直接提交报修。' : '点开听听。'}</div>
          <div class="message-bubble"><span class="from">engineer_68</span>${state.choices.shenbo === 'warn' ? '好，我不听了。我下班回家。' : '……里面是我妈在数数。她数到 68 就停了。'}</div>
          <p class="tiny" style="color:${state.warnings.shenbo ? '#74b58d' : '#7e6258'}">${state.warnings.shenbo ? '一条线已被改写。' : '这条线没有改变。'}</p>`
        : `<div style="border:1px solid rgba(139,0,0,.25);padding:15px;margin-top:12px"><div class="kicker" style="color:#8c5d54">UNFINISHED / YQSM-68</div>
          <p style="color:#a98e76;font-size:11px;margin:6px 0 12px">凌晨 03:47，走廊监护仪，有 68 秒录音。要不要点开？</p>
          <button class="btn btn--sm btn--primary" type="button" data-action="go-portal" data-id="shenbo">登录设备工程端 →</button></div>`}
        ${state.puzzles.recording ? '<p class="tiny" style="color:#6d554c;margin-top:12px">录音文件状态：已封存 / 不可再播放</p>' : ''}
      </section>
    </div>
    <div class="vault-card" style="margin-top:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
        <div><h2 style="margin-bottom:4px">二周目 · 两条被改写的线</h2><p style="margin:0">已劝阻：${state.warnings.shenchi ? '沈迟' : '—'} / ${state.warnings.shenbo ? '沈搏' : '—'}。${warningCount() === 2 ? '最终门后的东西已经不一样了。' : '还有一条线在等你。'}</p></div>
        <span class="chip ${warningCount() === 2 ? 'chip--green' : 'chip--red'}">${warningCount()} / 2</span>
      </div>
    </div>`;
  }

  SCENES.hell = function () {
    const tab = state.ui.hellTab || 'scrolls';
    let content = '';
    if (tab === 'scrolls') content = scrollCards();
    else if (tab === 'map') content = hellMapView();
    else if (tab === 'discussions') content = hellDiscussions();
    else content = vaultView();
    const titles = { scrolls: ['卷轴', '五页经卷。最后一页不是纸。'], map: ['圣地图', '十二座城市。十二只耳朵。'], discussions: ['讨论区', '他们都在等同一个东西。'], vault: ['内殿', '只给回来过的人。'] };
    return `<main class="screen screen--hell">
      <div class="hell-arch" aria-hidden="true"></div>
      ${hellHeader()}
      <p class="hell-verse">${esc(D.hell.verse)}</p>
      ${hellTabs()}
      <div class="hell-main">
        <div class="hell-intro"><div><p class="eyebrow" style="color:#7c574d">${tab === 'vault' ? 'INNER SANCTUM' : 'THE EIGHTEENTH FLOOR'}</p><h1>${esc(titles[tab][0])}</h1><p>${esc(titles[tab][1])}</p></div><div class="count">已记录线索 <strong>${clueFoundCount()}</strong> / ${clueTotal()}</div></div>
        ${content}
        ${tab === 'scrolls' ? `<p class="tiny" style="color:#5e453e;margin-top:22px;line-height:1.9">“它自己都不知道，这缕意识落在了哪颗心脏里。”<br>—— 教义总纲 · 第一条</p>` : ''}
      </div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: scroll detail
     --------------------------------------------------------- */
  SCENES.hellScroll = function () {
    const id = state.ui.scrollId || 'doctrine';
    if (id === 'hidden' && !state.puzzles.scripture) {
      return `<main class="screen screen--hell">${hellHeader()}<div class="hell-detail"><div class="hell-detail__back"><button type="button" data-action="back">← 返回卷轴</button></div><div class="scroll-sheet"><h1>隐藏手记</h1><p class="sub">SEALED / SCROLL 04</p><div class="scroll-body"><p>这一页被经书压住了。</p><p class="red">先去黑暗经书，把那个名字解出来。</p></div></div></div></main>`;
    }
    let title = '';
    let sub = '';
    let body = '';
    if (id === 'doctrine') {
      title = '教义总纲';
      sub = 'SCROLL 01 / PUBLIC';
      body = `<div class="scroll-body">${D.hell.doctrine.map((l, i) => `<p${i === D.hell.doctrine.length - 1 ? ' style="color:#8b5d4d;text-align:right"' : ''}>${esc(l)}</p>`).join('')}</div>`;
    } else if (id === 'leader') {
      title = '教主手记';
      sub = 'SCROLL 03 / LEADER';
      body = `<div class="scroll-body">${D.hell.leaderNote.map((l, i) => `<p${i === D.hell.leaderNote.length - 1 ? ' style="color:#8b5d4d;text-align:right"' : ''}>${esc(l)}</p>`).join('')}</div>`;
    } else if (id === 'scripture') {
      title = '黑暗经书';
      sub = 'SCROLL 02 / CIPHER';
      body = state.puzzles.scripture
        ? `<div class="revealed-scripture"><div class="seal">VESSEL / DECRYPTED / 74</div>${D.hell.scripture.revealed.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
           <div class="hidden-sections">${D.hell.hidden.map((h) => `<details class="hidden-note"><summary>${esc(h.title)}</summary><div class="hidden-note__body">${esc(h.text)}</div></details>`).join('')}</div>`
        : `<div class="scroll-cipher">
            <div class="cipher">${D.hell.scripture.cipher.split('').map((c) => `<span>${esc(c)}</span>`).join('')}</div>
            <p class="puzzle-note">${esc(D.hell.scripture.hint)}</p>
            <form data-form="scripture">
              <label class="field-label" for="scripture-answer">输入解出的单词</label>
              <input class="field" id="scripture-answer" name="answer" type="text" autocomplete="off" placeholder="6 个英文字母">
              <p class="form-error" data-error style="text-align:center"></p>
              <button class="btn btn--block" type="submit">翻开这一页</button>
            </form>
          </div>`;
    } else {
      title = '隐藏手记';
      sub = 'SCROLL 04 / UNSEALED';
      body = `<div class="hidden-sections">${D.hell.hidden.map((h) => `<details class="hidden-note" open><summary>${esc(h.title)}</summary><div class="hidden-note__body">${esc(h.text)}</div></details>`).join('')}</div>`;
    }
    return `<main class="screen screen--hell">
      ${hellHeader()}
      <div class="hell-detail">
        <div class="hell-detail__back"><button type="button" data-action="back">← 返回卷轴</button></div>
        <article class="scroll-sheet">
          <h1>${esc(title)}</h1>
          <p class="sub">${esc(sub)}</p>
          ${body}
        </article>
        <p class="tiny" style="color:#5a413b;margin-top:18px;text-align:center">十八层 · 内部卷轴 · 不要抄写</p>
      </div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: final door
     --------------------------------------------------------- */
  SCENES.finalDoor = function () {
    const ready = state.puzzles.scripture;
    return `<main class="screen screen--finaldoor">
      <div class="topbar topbar--dark">
        <div class="topbar__inner">
          <button class="topbar__back" type="button" data-action="back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 18l-6-6 6-6"/></svg><span>返回卷轴</span></button>
          <div class="topbar__right"><span class="topbar__dot"></span><span>THE LAST DOOR</span></div>
        </div>
      </div>
      <div class="finaldoor-main">
        <div>
          <div class="door-wrap"><div class="door"><div class="door-sigil">${hexagramSVG('', '门上的印记')}</div></div></div>
          <p class="eyebrow" style="color:#7e554d">SCROLL 05 / FINAL</p>
          <h1 class="finaldoor-title">最终门</h1>
          <p class="finaldoor-sub">“你记得哪座城市？”</p>
          <div class="finaldoor-clues">
            <span class="clue-seal ${state.puzzles.scripture ? '' : 'is-missing'}">经书 · ${state.puzzles.scripture ? 'VESSEL' : '未解'}</span>
            <span class="clue-seal ${state.puzzles.hellLogin ? '' : 'is-missing'}">入口 · ${state.puzzles.hellLogin ? '74/74' : '未入'}</span>
            <span class="clue-seal">城市 · ${state.puzzles.finalDoor ? '成都' : '未定'}</span>
          </div>
          ${ready ? `<form class="finaldoor-form" data-form="final-door">
            <label class="field-label" for="city-answer" style="text-align:center">输入城市名</label>
            <input class="field" id="city-answer" name="city" type="text" autocomplete="off" placeholder="你记得哪座城市？">
            <p class="form-error" data-error style="text-align:center"></p>
            <button class="btn btn--primary" type="submit">推 门</button>
          </form>` : `<div class="notice notice--red" style="max-width:420px;margin:0 auto;text-align:left">门没有回应。黑暗经书还缺一页。<br><button class="text-link" type="button" data-action="open-scroll" data-id="scripture" style="margin-top:8px">→ 去解读黑暗经书</button></div>`}
          <p class="finaldoor-note">三条线交汇之处。<br>不是地狱。是地址。</p>
        </div>
      </div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: patient portal (second pass)
     --------------------------------------------------------- */
  SCENES.patient = function () {
    const tab = state.ui.patientTab || 'diary';
    const tabs = [['diary', '术后日记'], ['messages', '私信'], ['reports', '随访记录'], ['about', '样本档案']];
    let body = '';
    if (tab === 'diary') {
      body = `<div class="portal-section-head"><h2>术后日记</h2><p>heart_74 / PRIVATE / 5 ENTRIES</p></div>
        <div class="diary-list">
          ${D.patient.diary.map((d, i) => `<details class="diary-entry" ${i === D.patient.diary.length - 1 ? 'open' : ''}>
            <summary>
              <span class="diary-entry__date">${esc(d.day)}<br>${esc(d.date)}</span>
              <strong>${esc(d.title)}</strong>
              <span class="diary-entry__mark">${d.morse ? 'MORSE / 68s' : 'READ'}</span>
            </summary>
            <div class="diary-entry__body">
              ${lines(d.text)}
              ${d.morse ? `<div class="morse-strip"><span>它在听</span><button class="btn btn--sm btn--ghost" type="button" data-action="play-heart">▶ 播放心跳录音</button></div>` : ''}
            </div>
          </details>`).join('')}
        </div>`;
    } else if (tab === 'messages') {
      const messages = D.hell.vip[0];
      const done = !!state.choices.shenchi;
      body = `<div class="portal-section-head"><h2>私信</h2><p>ENCRYPTED / heart_74 → chengwei</p></div>
        <div class="chat-window">
          <div class="chat-window__head"><span class="live-dot"></span>heart_74 <span>在线 · 03:47</span></div>
          <div class="chat-window__body">
            ${messages.body.map((m) => `<div class="chat-bubble"><span class="who">heart_74</span>${esc(m.text)}</div>`).join('')}
            ${done ? `<div class="chat-bubble is-mine"><span class="who">chengwei / 你</span>${state.choices.shenchi === 'warn' ? '别停药，好好养着。' : '别想这些，回家吧。'}</div>
              <div class="chat-bubble"><span class="who">heart_74</span>${state.choices.shenchi === 'warn' ? '好，我听你的。我不吃别的药了。' : '……好。那我回家了。'}</div>
              <div class="chat-status ${state.warnings.shenchi ? 'is-good' : 'is-cold'}">${state.warnings.shenchi ? '这条线已被改写。他答应继续服药。' : '这条线没有改变。他退出了对话。'}</div>`
              : `<div class="chat-choice">
                <p>回复沈迟：</p>
                <button type="button" class="btn btn--sm btn--primary" data-action="choose-shenchi" data-id="warn">别停药，好好养着。</button>
                <button type="button" class="btn btn--sm btn--ghost" data-action="choose-shenchi" data-id="dismiss">别想这些，回家吧。</button>
                <span>回复后不可撤回。你只能选一次。</span>
              </div>`}
          </div>
        </div>
        ${done ? '<button class="btn btn--ghost" type="button" data-action="go-dashboard" style="margin-top:16px">返回 OAS 工作台</button>' : ''}`;
    } else if (tab === 'reports') {
      body = `<div class="portal-section-head"><h2>随访记录</h2><p>OAS / POST-TRANSPLANT FOLLOW-UP</p></div>
        <div class="report-list">
          ${D.patient.reports.map((r) => `<article class="report-card">
            <div class="report-card__head"><h3>${esc(r.title)}</h3><span>${esc(r.date)}</span></div>
            <div class="report-card__body">${lines(r.text)}</div>
            <div class="report-card__reply"><strong>程未 回复</strong>${lines(r.reply)}</div>
          </article>`).join('')}
        </div>`;
    } else {
      body = `<div class="portal-section-head"><h2>样本档案</h2><p>SAMPLE D-074 / CONFIDENTIAL</p></div>
        <div class="patient-card">
          <div class="patient-card__top"><div class="patient-avatar">迟</div><div><h3>${esc(D.patient.info.name)}</h3><p>${esc(D.patient.info.age)} 岁 · ${esc(D.patient.info.bed)}</p></div><span class="chip chip--green">LIVE</span></div>
          <div class="info-grid">
            <div><span>样本编号</span><strong>D-074</strong></div>
            <div><span>移植日期</span><strong>${esc(D.patient.info.surgery)}</strong></div>
            <div><span>当前心率</span><strong>${esc(D.patient.info.rhythm)}</strong></div>
            <div><span>供体</span><strong>匿名 / D 系列</strong></div>
            <div><span>主刀</span><strong>张建新 主任医师</strong></div>
            <div><span>随访协调员</span><strong>程未</strong></div>
          </div>
          <div class="patient-note">“样本 D-074 术后第 74 天，出现无法归类的听觉事件。患者拒绝停止免疫抑制治疗。建议：继续观察，不要告诉他供体的名字。”</div>
        </div>`;
    }
    return `<main class="screen screen--patient">
      <header class="portal-head portal-head--patient">
        <div class="portal-head__inner">
          <div class="portal-brand"><span class="mark">74</span><div><strong>heart_74</strong><span>患者样本端 / D-074</span></div></div>
          <div class="portal-live"><span class="live-dot"></span>LIVE 74 BPM</div>
          <button class="portal-exit" type="button" data-action="go-dashboard">返回 OAS 工作台</button>
        </div>
        <nav class="portal-tabs">${tabs.map(([id, label]) => `<button type="button" class="${tab === id ? 'is-active' : ''}" data-action="patient-tab" data-id="${id}">${label}</button>`).join('')}</nav>
      </header>
      <div class="portal-wrap">
        <section class="portal-vitals">
          <div class="portal-vitals__copy"><p class="eyebrow">SAMPLE D-074 / REAL-TIME</p><h1>沈迟</h1><p>术后第 60 天 · 心内科 3 号床 · 睡眠监测中</p></div>
          <div class="ecg-wrap">${ecgSVG('ecg')}<div class="ecg-meta"><span>74 BPM</span><span>SpO₂ 98%</span><span>03:47</span><span class="ecg-count">监听 <b id="countWhisper">01</b></span></div></div>
        </section>
        ${body}
        <p class="portal-foot">本页面仅对样本 D-074 开放。所有输入将同步至盘阳生物搏印项目组。<br>若你听见它说话，请不要回答。</p>
      </div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: engineer portal (second pass)
     --------------------------------------------------------- */
  SCENES.engineer = function () {
    const tab = state.ui.engineerTab || 'orders';
    const tabs = [['orders', '维修工单'], ['recording', '68 秒录音'], ['duty', '值班本'], ['about', '工程师档案']];
    let body = '';
    if (tab === 'orders') {
      body = `<div class="eng-section-head"><h2>我的工单</h2><p>YQSM / 5 OPEN RECORDS / 西南片区</p></div>
        <div class="order-list">
          ${D.engineer.orders.map((o) => `<details class="order-card ${o.final ? 'is-final' : ''}">
            <summary>
              <span class="order-id">${esc(o.id)}</span>
              <span class="order-title">${esc(o.title)}<small>${esc(o.dept)} · ${esc(o.date)}</small></span>
              <span class="order-status ${o.status === '处理中' ? 'is-active' : ''}">${esc(o.status)}</span>
            </summary>
            <div class="order-card__body">
              <p>${esc(o.body)}</p>
              <div class="order-log">${o.log.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
              ${o.morse ? `<div class="order-morse"><span>波形备注</span><code>${esc(o.morse)}</code><button class="btn btn--sm btn--ghost" type="button" data-action="play-morse">▶ 播放</button></div>` : ''}
              ${o.final ? `<button class="btn btn--sm btn--primary" type="button" data-action="open-recording">打开最后一条录音 →</button>` : ''}
            </div>
          </details>`).join('')}
        </div>`;
    } else if (tab === 'recording') {
      const done = !!state.choices.shenbo;
      const r = D.engineer.recording;
      body = `<div class="eng-section-head"><h2>${esc(r.title)}</h2><p>YQSM-68 / UNFINISHED / PRIORITY HIGH</p></div>
        <div class="audio-file">
          <div class="audio-file__head"><span class="recdot"></span>AUDIO_2025-11-04_03-47-00.wav <span>68.0s</span></div>
          <div class="waveform" aria-hidden="true">${Array.from({ length: 64 }, (_, i) => `<span style="height:${10 + ((i * 37) % 42)}%"></span>`).join('')}</div>
          <div class="audio-file__meta"><span>FILE SIZE 68 KB</span><span>CREATED 2025-11-04 03:47:00</span><span>SOURCE: 3号床 监护仪</span></div>
        </div>
        <div class="recording-copy">
          <p>${esc(r.text)}</p>
          <p class="mono" style="color:#a9b1b5">${esc(r.detail)}</p>
          ${done ? `<div class="eng-result ${state.warnings.shenbo ? 'is-good' : 'is-bad'}">
            <h3>${state.warnings.shenbo ? '录音已封存' : '录音已播放'}</h3>
            <p>${state.choices.shenbo === 'warn' ? '好，我不听了。我下班回家。' : '……里面是我妈在数数。她数到 68 就停了。'}</p>
            <p class="small">${state.warnings.shenbo ? '你把工单状态改成“已关闭”。屏幕右下角，一段 68 秒的波形慢慢变平。' : '录音里的女人没有喊他的名字。她只是在数：一、二、三……六十八。然后是一声很轻的叹息。'}</p>
            <button class="btn btn--sm btn--ghost" type="button" data-action="go-dashboard">返回 OAS 工作台</button>
          </div>` : `<div class="eng-choice">
            <p class="eng-choice__prompt">${esc(r.prompt)}</p>
            <button class="btn btn--primary" type="button" data-action="choose-recording" data-id="warn">别点开，直接提交报修。</button>
            <button class="btn btn--ghost" type="button" data-action="choose-recording" data-id="listen">点开录音听。</button>
            <span>这是一个不可撤回的选择。</span>
          </div>`}
        </div>`;
    } else if (tab === 'duty') {
      body = `<div class="eng-section-head"><h2>张桂兰的值班本</h2><p>RECOVERED / HANDWRITTEN / 18 PAGES</p></div>
        <div class="dutybook">
          <div class="dutybook__head"><span>住院部夜班记录</span><span>03:47</span></div>
          ${D.engineer.dutyBook.map((l) => `<p${l.indexOf('最后一页') === 0 ? ' class="last"' : ''}>${esc(l)}</p>`).join('')}
          <button class="btn btn--sm btn--gold" type="button" data-action="show-dutybook">合上值班本</button>
        </div>`;
    } else {
      body = `<div class="eng-section-head"><h2>工程师档案</h2><p>EMPLOYEE PY068 / CLEARANCE 4</p></div>
        <div class="eng-profile">
          <div class="eng-avatar">搏</div>
          <div><h3>${esc(D.engineer.info.name)}</h3><p>${esc(D.engineer.info.age)} 岁 · ${esc(D.engineer.info.job)} · ${esc(D.engineer.info.area)}</p></div>
          <span class="chip chip--red">YQSM-68</span>
        </div>
        <div class="info-grid">
          <div><span>员工编号</span><strong>PY068</strong></div>
          <div><span>负责区域</span><strong>西南 / 全国巡检</strong></div>
          <div><span>母亲</span><strong>张桂兰（已故）</strong></div>
          <div><span>最后通话</span><strong>68 秒</strong></div>
          <div><span>经手设备</span><strong>2,416 台</strong></div>
          <div><span>未关闭工单</span><strong>1</strong></div>
        </div>
        <div class="eng-note">入职推荐人：空白。<br>系统备注：无人推荐，自动入职。<br>人事部批注：不要把 3 号床分给他。</div>`;
    }
    return `<main class="screen screen--engineer">
      <header class="portal-head portal-head--engineer">
        <div class="portal-head__inner">
          <div class="portal-brand"><span class="mark">68</span><div><strong>engineer_68</strong><span>设备工程端 / YQSM</span></div></div>
          <div class="portal-live"><span class="live-dot"></span>LINK STABLE</div>
          <button class="portal-exit" type="button" data-action="go-dashboard">返回 OAS 工作台</button>
        </div>
        <nav class="portal-tabs">${tabs.map(([id, label]) => `<button type="button" class="${tab === id ? 'is-active' : ''}" data-action="engineer-tab" data-id="${id}">${label}</button>`).join('')}</nav>
      </header>
      <div class="portal-wrap portal-wrap--engineer">
        <section class="eng-hero">
          <div><p class="eyebrow">MAINTENANCE CHANNEL / YQSM-68</p><h1>设备维护通道</h1><p>沈搏 · 高级维修工程师 · 西南片区 · 上次登录 03:47</p></div>
          <div class="eng-meter"><span>68</span><small>SECONDS</small></div>
        </section>
        ${body}
        <p class="portal-foot">本页面仅对工程师 YQSM-68 开放。任何录音文件不得下载、转存或播放。<br>若你听见你认识的声音，请立即停止检修。</p>
      </div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: corridor
     --------------------------------------------------------- */
  const CORRIDOR_LINES = [
    { who: '旁白', text: '走廊很长。灯每两秒灭一次。' },
    { who: '旁白', text: '你听见自己的脚步声，也听见另一个人的。' },
    { who: '张桂兰', text: '我在这值班二十年了。' },
    { who: '张桂兰', text: '一个一个名字，我都记下来。' },
    { who: '张桂兰', text: '3床，4床，12床，7床……' },
    { who: '张桂兰', text: '我儿子叫沈搏。' },
    { who: '张桂兰', text: '他好久没来看我了。' },
    { who: '张桂兰', text: '我在这等他。他下班就会回来。' },
    { who: '旁白', text: '她翻开最后一页。上面写着：我儿子回来了。' },
    { who: '旁白', text: '走廊尽头的门开着。门后面没有光，只有一台亮着的终端。' }
  ];

  SCENES.corridor = function () {
    const step = Math.min(Math.max(0, state.corridorStep || 0), CORRIDOR_LINES.length - 1);
    const line = CORRIDOR_LINES[step];
    const atEnd = step >= CORRIDOR_LINES.length - 1;
    const leftClear = state.warnings.shenchi ? ' is-clear' : '';
    const rightClear = state.warnings.shenbo ? ' is-clear' : '';
    return `<main class="screen screen--corridor">
      <div class="corridor-scene" aria-hidden="true">
        <div class="corridor-ceiling"></div>
        <div class="corridor-floor"></div>
        <div class="corridor-wall corridor-wall--left"></div>
        <div class="corridor-wall corridor-wall--right"></div>
        <div class="corridor-light"></div><div class="corridor-light"></div><div class="corridor-light"></div>
        <div class="corridor-doors">
          <div class="corridor-door corridor-door--left"><span class="number">03</span><div class="corridor-figure corridor-figure--left${leftClear}"></div></div>
          <div class="corridor-door corridor-door--right"><span class="number">12</span><div class="corridor-figure corridor-figure--right${rightClear}"></div></div>
        </div>
        <div class="corridor-nurse"></div>
        <div class="corridor-mist"></div>
      </div>
      <div class="corridor-hud"><span class="rec"></span>REC · 住院部 B1 · 03:47:12</div>
      <div class="corridor-hud corridor-hud--right">SIGNAL 74%<br>NO EXIT</div>
      <div class="corridor-ui">
        <div class="corridor-dialogue" aria-live="polite">
          <div class="who">${esc(line.who)} <span style="opacity:.5">/ ${String(step + 1).padStart(2, '0')}</span></div>
          <p class="line">${esc(line.text)}</p>
        </div>
        <div class="corridor-controls">
          <div class="corridor-step">${state.warnings.shenchi ? '左门后的影子很清晰。' : '左门后有一团模糊的影子。'} ${state.warnings.shenbo ? '右门后的影子也很清晰。' : '右门后有一团模糊的影子。'}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn--sm btn--ghost" type="button" data-action="show-dutybook">翻开值班本</button>
            ${atEnd ? `<button class="btn btn--sm btn--primary" type="button" data-action="enter-terminal">推开尽头的门 →</button>` : `<button class="btn btn--sm btn--primary" type="button" data-action="corridor-next">继续走 →</button>`}
          </div>
        </div>
      </div>
    </main>`;
  };

  /* ---------------------------------------------------------
     SCENE: terminal
     --------------------------------------------------------- */
  function termLineClass(entry) {
    if (entry.type === 'user') return 'is-user';
    if (entry.type === 'system') return 'is-system';
    if (entry.type === 'warning') return 'is-warning';
    if (entry.type === 'blood') return 'is-blood';
    return 'is-it';
  }

  function termPrefix(entry) {
    if (entry.type === 'user') return '程未 &gt;';
    if (entry.type === 'system') return 'SYS &gt;';
    if (entry.type === 'warning') return '!! &gt;';
    return '它 &gt;';
  }

  function termLineHTML(entry) {
    return `<div class="term-line ${termLineClass(entry)}"><span class="prefix">${termPrefix(entry)}</span>${nl2br(entry.text)}</div>`;
  }

  function terminalChoicesHTML() {
    if (!state.terminalReady) return '';
    const warns = warningCount();
    const stayDisabled = warns === 0;
    return `<div class="term-choices" id="termChoices">
      <div class="term-choices__title">最终选择 / 走廊尽头</div>
      <div style="color:#4e9067;font-size:9px;margin-bottom:4px">已劝阻：${state.warnings.shenchi ? '沈迟' : '—'} / ${state.warnings.shenbo ? '沈搏' : '—'} · ${warns}/2</div>
      ${D.terminal.choices.map((c, i) => {
        const disabled = c.id === 'stay' && stayDisabled;
        return `<button class="term-choice ${c.id === 'morgue' ? 'is-danger' : ''}" type="button" data-action="final-choice" data-id="${c.id}" ${disabled ? 'disabled' : ''}>
          <span class="key">[${i + 1}]</span>
          <span><span class="label">${esc(c.label)}</span><span class="sub">${esc(disabled ? '你还没有改变任何一条线。先去二周目的样本端与工程端。' : c.sub)}</span></span>
        </button>`;
      }).join('')}
      <p style="color:#356446;font-size:8px;line-height:1.7;margin-top:4px">选择之后，本次调查将不可撤回。结局会写入档案。</p>
    </div>`;
  }

  SCENES.terminal = function () {
    const count = state.terminalAsked.length;
    const ready = state.terminalReady;
    return `<main class="screen screen--terminal scanlines">
      <header class="term-head">
        <div class="term-head__left"><span class="prompt">&gt;_</span><span>terminal_v1.0 — 加密通道</span></div>
        <div class="term-head__right">已揭露 <strong id="truthCount">${count}</strong>/${D.terminal.questions.length} 个真相　·　SESSION 74</div>
      </header>
      <div class="term-wrap">
        <div class="term-body" id="termBody" aria-live="polite">
          <div class="term-intro">CONNECTION ESTABLISHED · 03:47:00<br><span class="live">[它] 你来了。<br>[它] 我等你很久了，程未。</span></div>
          ${state.terminalLog.map(termLineHTML).join('')}
          ${terminalChoicesHTML()}
        </div>
        <div class="term-footer">
          ${ready ? `<div class="term-hint"><span>所有问题已问完。屏幕在等你。</span><span class="blink">█</span></div>` : `
            <div class="term-chips">
              ${D.terminal.questions.map((q) => `<button class="term-chip ${state.terminalAsked.includes(q.id) ? 'is-done' : ''}" type="button" data-action="terminal-ask" data-id="${q.id}" ${state.terminalAsked.includes(q.id) ? 'disabled' : ''}>${esc(q.label)}</button>`).join('')}
            </div>
            <form class="term-input-row" data-form="terminal-input">
              <input class="field" name="q" id="terminalInput" type="text" autocomplete="off" placeholder="输入你想问的问题..." aria-label="输入你想问的问题">
              <button class="btn term-send" type="submit">发送</button>
            </form>
            <div class="term-hint"><span>不要问它不想回答的问题。</span><span class="blink">█</span></div>`}
        </div>
      </div>
    </main>`;
  };

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function scrollTermBottom() {
    const body = byId('termBody');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function appendTermLine(entry) {
    const body = byId('termBody');
    if (!body) return;
    const div = document.createElement('div');
    div.innerHTML = termLineHTML(entry);
    const node = div.firstElementChild;
    if (node) body.appendChild(node);
    scrollTermBottom();
  }

  async function askQuestion(id) {
    if (state.terminalReady) { toast('它已经不再回答问题了。'); return; }
    if (termTyping) { toast('它还在说。'); return; }
    const q = D.terminal.questions.find((x) => x.id === id);
    if (!q) return;
    if (state.terminalAsked.includes(id)) { toast('这个问题已经问过了。'); return; }
    const token = ++termToken;
    termTyping = true;
    state.terminalAsked.push(id);
    const userEntry = { type: 'user', text: q.label };
    state.terminalLog.push(userEntry);
    q.lines.forEach((line) => state.terminalLog.push({ type: 'it', text: line }));
    saveState();
    appendTermLine(userEntry);
    const countEl = byId('truthCount');
    if (countEl) countEl.textContent = String(state.terminalAsked.length);
    audio.unlockChime();
    for (let i = 0; i < q.lines.length; i++) {
      await sleep(170);
      if (token !== termToken || route.scene !== 'terminal') return;
      appendTermLine({ type: 'it', text: q.lines[i] });
      if (i % 3 === 0) audio.tick();
      scrollTermBottom();
    }
    if (token !== termToken || route.scene !== 'terminal') return;
    termTyping = false;
    if (state.terminalAsked.length >= D.terminal.questions.length) {
      await sleep(450);
      if (token !== termToken || route.scene !== 'terminal') return;
      finishTerminalIfReady();
    }
  }

  function finishTerminalIfReady() {
    if (state.terminalReady) return;
    if (state.terminalAsked.length < D.terminal.questions.length) return;
    state.terminalReady = true;
    D.terminal.preChoice.forEach((line) => state.terminalLog.push({ type: 'it', text: line }));
    state.terminalLog.push({ type: 'system', text: '所有问题已结束。最终门在你身后。' });
    saveState();
    audio.flatline();
    if (route.scene === 'terminal') {
      render();
      window.setTimeout(scrollTermBottom, 80);
    }
  }

  function handleTerminalInput(value) {
    if (state.terminalReady) { toast('它已经不再回答问题了。'); return; }
    if (termTyping) { toast('它还在说。'); return; }
    const text = String(value || '').trim();
    if (!text) return;
    const key = text.replace(/\s+/g, '').toLowerCase();
    const found = D.terminal.questions.find((q) => q.keys.some((k) => key.includes(k.toLowerCase())));
    if (found) {
      askQuestion(found.id);
    } else {
      const entry = { type: 'system', text: '它没有回答。走廊里有什么东西在数数：一、二、三……' };
      state.terminalLog.push(entry);
      saveState();
      appendTermLine(entry);
      audio.error();
    }
    const input = byId('terminalInput');
    if (input) input.value = '';
  }

  /* ---------------------------------------------------------
     SCENE: ending
     --------------------------------------------------------- */
  function endingBg(id) {
    return id === 'bad' ? 'ending-bg--bad' : id === 'fake' ? 'ending-bg--fake' : id === 'middle' ? 'ending-bg--middle' : 'ending-bg--true';
  }
  function endingVeil(id) {
    if (id === 'bad') return 'ending-veil--red';
    if (id === 'fake') return 'ending-veil--blue';
    return '';
  }

  function endingDoneCard() {
    const e = D.endings[state.endingId];
    if (!e) return '';
    const total = endedCount();
    return `<div class="ending-card">
      <div class="ending-card__no">ENDING ${e.no} / 04</div>
      <h1>${esc(e.title)}</h1>
      <p class="ending-card__sub">${esc(e.subtitle)}</p>
      <div class="ending-card__tag ${e.id === 'true' ? 'ending-card__tag--green' : ''}">${esc(e.tag)}</div>
      <p class="ending-card__desc">${esc(e.desc)}</p>
      <div class="ending-card__actions">
        <button class="btn btn--primary" type="button" data-action="new-run">进入二周目 / 回到标题</button>
        <button class="btn btn--ghost" type="button" data-action="open-gallery">结局档案</button>
      </div>
      <div class="ending-card__collection">已收集结局 <strong>${total}/4</strong>　·　第 ${state.run} 周目　·　劝阻 ${warningCount()}/2</div>
      <p class="tiny" style="color:#554b41;margin-top:18px">档案不会因为重来而消失。<br>但你可以让它多出几种可能。</p>
    </div>`;
  }

  function badSpecial() {
    return `<div class="ending-line ending-line--small"><span class="who">它</span><span class="text">你想让我看看你在哪里。</span></div>
      <div id="badLocation"></div>`;
  }

  function fakeSpecial() {
    return `<div class="ending-line ending-line--small"><span class="who">它</span><span class="text">把手放在胸口。数一数。</span></div>
      <div class="heart-count">
        <div class="heart-orb" id="heartNumber">0</div>
        <p style="color:#8c7b6c;font-size:12px;text-align:center;max-width:430px;line-height:1.9">数完的时候，你会发现它正好数了 74 下。<br>它不是你的心跳。</div>
        <button class="btn btn--sm btn--primary" type="button" data-action="start-heart-count" id="startHeart">把手放在胸口</button>
        <button class="btn btn--sm btn--ghost" type="button" data-action="ending-finish" id="finishHeart" style="display:none">继续</button>
      </div>`;
  }

  SCENES.ending = function () {
    const id = state.endingId;
    if (!id || !D.endings[id]) {
      return `<main class="screen screen--ending"><div class="ending-card"><h1>档案为空</h1><p class="ending-card__desc">这个结局还没有被写下来。</p><button class="btn btn--ghost" type="button" data-action="go" data-id="opening">回到标题</button></div></main>`;
    }
    const script = D.endingScripts[id];
    const done = state.endingDone;
    const special = state.endingSpecial && !done;
    const step = Math.min(state.endingStep, Math.max(0, script.length - 1));
    const line = script[step] || script[0];
    const lineClass = [line.blood ? 'ending-line--blood' : '', line.green ? 'ending-line--green' : '', line.badge ? 'ending-line--badge' : '', line.small ? 'ending-line--small' : ''].filter(Boolean).join(' ');
    return `<main class="screen screen--ending ending--${id} ${id === 'true' ? 'is-true' : ''}">
      <div class="ending-bg ${endingBg(id)}" aria-hidden="true"></div>
      <div class="ending-veil ${endingVeil(id)}" aria-hidden="true"></div>
      <div class="ending-top"><span>RECOVERED FILE / ${esc(id.toUpperCase())}</span><span class="rec">● REC ${esc(D.endings[id].no)} / 04</span></div>
      ${done ? endingDoneCard() : special ? `
        <div class="ending-stage">
          <div class="ending-chapter" style="display:flex;align-items:center;justify-content:space-between;gap:16px">
            <span><strong>${esc(D.endings[id].title)}</strong> / SPECIAL</span>
            <button class="ending-skip" type="button" data-action="ending-finish" style="margin:0">跳过</button>
          </div>
          ${id === 'bad' ? badSpecial() : fakeSpecial()}
        </div>` : `
        <div class="ending-stage">
          <div class="ending-chapter"><strong>${esc(D.endings[id].title)}</strong> / ${esc(D.endings[id].subtitle)}</div>
          <p class="ending-line ${lineClass}"><span class="who">${esc(line.who)}</span><span class="text">${esc(line.text)}</span></p>
          ${line.countdown ? `<div class="countdown" id="fakeCountdown">10</div>` : ''}
          <div class="ending-caption">— ${esc(D.endings[id].tag)} —</div>
          <div class="ending-progress">${script.map((_, i) => `<span class="${i <= step ? 'is-on' : ''}"></span>`).join('')}</div>
          <div class="ending-actions">
            <button class="btn btn--primary" type="button" data-action="ending-next">${step >= script.length - 1 ? '继续' : '下一句 →'}</button>
            <button class="btn btn--ghost" type="button" data-action="ending-skip">跳过这段</button>
          </div>
        </div>`}
      ${done ? '' : `<div class="cine-controls"><span class="hint"><span class="key">↵</span>点击继续 · 结局不可撤回</span><span class="hint">03:47:00</span></div>`}
    </main>`;
  };

  /* ---------------------------------------------------------
     ending logic + location
     --------------------------------------------------------- */
  function startEnding(id) {
    if (!D.endings[id]) return;
    const wasRecorded = state.runRecorded;
    state.endingId = id;
    state.endingStep = 0;
    state.endingSpecial = false;
    state.endingDone = false;
    if (!state.endings.includes(id)) state.endings.push(id);
    state.gameCompleted = true;
    state.runRecorded = true;
    if (!wasRecorded) state.completedRuns += 1;
    state.finalChoice = id;
    saveState();
    historyStack = [];
    closeModal(true);
    navigate('ending', { flash: true, noPush: true });
    if (id === 'bad') audio.flatline();
    else if (id === 'fake') audio.sigh();
    else audio.unlockChime();
  }

  function advanceEnding() {
    const id = state.endingId;
    const script = D.endingScripts[id];
    if (!script) return;
    if (state.endingStep < script.length - 1) {
      state.endingStep += 1;
      saveState();
      render({ keepScroll: true });
      return;
    }
    if ((id === 'bad' || id === 'fake') && !state.endingSpecial && !state.endingDone) {
      state.endingSpecial = true;
      saveState();
      render();
      return;
    }
    state.endingDone = true;
    saveState();
    render();
  }

  let fakeCountdownTimer = null;
  function startFakeCountdown() {
    if (fakeCountdownTimer) window.clearInterval(fakeCountdownTimer);
    const el = byId('fakeCountdown');
    if (!el) return;
    let n = 10;
    el.textContent = String(n);
    fakeCountdownTimer = window.setInterval(() => {
      n -= 1;
      const target = byId('fakeCountdown');
      if (target) target.textContent = n > 0 ? String(n) : '0';
      if (n <= 0) {
        window.clearInterval(fakeCountdownTimer);
        fakeCountdownTimer = null;
        audio.flatline();
      }
    }, 650);
  }

  function finishHeartCount() {
    if (heartTimer) {
      window.clearInterval(heartTimer);
      heartTimer = null;
    }
    const finish = byId('finishHeart');
    if (finish) finish.style.display = '';
    const orb = byId('heartNumber');
    if (orb) orb.textContent = '74';
  }

  function startHeartCount() {
    if (heartTimer) return;
    const orb = byId('heartNumber');
    const start = byId('startHeart');
    if (!orb) return;
    if (start) start.style.display = 'none';
    let n = 0;
    heartTimer = window.setInterval(() => {
      n += 1;
      orb.textContent = String(n);
      if (n % 9 === 0 || n === 1) {
        audio.heartbeatNow();
        if (navigator.vibrate) { try { navigator.vibrate(22); } catch (e) {} }
      }
      if (n >= 74) finishHeartCount();
    }, 190);
  }

  const CITY_ALIASES = {
    beijing: '北京', shanghai: '上海', guangzhou: '广州', shenzhen: '深圳', chengdu: '成都',
    xian: '西安', "xi'an": '西安', chongqing: '重庆', wuhan: '武汉', nanjing: '南京',
    hangzhou: '杭州', tianjin: '天津', zhengzhou: '郑州', jinan: '济南', guiyang: '贵阳',
    kunming: '昆明', changsha: '长沙', shenyang: '沈阳', harbin: '哈尔滨', changchun: '长春',
    fuzhou: '福州', xiamen: '厦门', hefei: '合肥', nanchang: '南昌', taiyuan: '太原',
    shijiazhuang: '石家庄', nanning: '南宁', haikou: '海口', lanzhou: '兰州',
    urumqi: '乌鲁木齐', lhasa: '拉萨', hohhot: '呼和浩特', yinchuan: '银川', xining: '西宁'
  };

  function mapCityName(raw) {
    if (!raw) return '';
    const direct = cityNorm(String(raw));
    if (CITY_ALIASES[String(raw).toLowerCase()]) return CITY_ALIASES[String(raw).toLowerCase()];
    if (CITY_ALIASES[direct.toLowerCase()]) return CITY_ALIASES[direct.toLowerCase()];
    const keys = Object.keys(D.funeralHomes);
    return keys.find((k) => direct.includes(k) || k.includes(direct)) || direct;
  }

  async function fetchIpCity() {
    const timeout = (ms) => {
      const c = new AbortController();
      window.setTimeout(() => c.abort(), ms);
      return c.signal;
    };
    try {
      const res = await fetch('https://ipwho.is/', { signal: timeout(5000), headers: { Accept: 'application/json' } });
      if (res.ok) {
        const j = await res.json();
        if (j && j.success !== false && j.city) return { city: j.city, region: j.region || '', country: j.country || '' };
      }
    } catch (e) {}
    try {
      const res = await fetch('https://ipapi.co/json/', { signal: timeout(4500), headers: { Accept: 'application/json' } });
      if (res.ok) {
        const j = await res.json();
        if (j && j.city) return { city: j.city, region: j.region || '', country: j.country_name || '' };
      }
    } catch (e) {}
    return null;
  }

  function locationHTML(city, mode) {
    const name = mapCityName(city);
    const home = D.funeralHomes[name];
    const known = !!home;
    const shown = known ? name : (name || city || '你所在的城市');
    const address = known ? home.address : '地址未收录在档案中';
    return `<div class="location-panel">
      <div class="status">LOCATION ACQUIRED / ${known ? 'CITY MATCHED' : 'PARTIAL MATCH'}</div>
      <div class="city">${esc(shown)}</div>
      <div class="address">${known ? esc(home.name) + ' · ' + esc(address) : '它没有找到对应的殡仪馆。'}</div>
      <div class="disclaimer">公开殡葬设施信息仅用于虚构叙事，可能存在变更。你所在的位置只用于生成这段文字，不会上传到本游戏服务器。</div>
      ${mode === 'resolved' ? '<button class="btn btn--sm btn--primary" type="button" data-action="ending-finish" id="badContinue">继续</button>' : ''}
      ${!known ? `<form data-form="manual-city" style="margin-top:12px"><label class="field-label">如果你愿意，可以告诉它一个城市</label><div class="input-row"><input class="field" name="city" placeholder="例如：成都"><button class="btn btn--sm" type="submit">确认</button></div></form>` : ''}
    </div>`;
  }

  function renderBadLocationPrompt(holder) {
    if (!holder) return;
    holder.dataset.done = '1';
    holder.innerHTML = `<div class="location-panel">
      <div class="status">POSITION REQUEST / OPTIONAL</div>
      <div class="city">它想知道你在哪。</div>
      <div class="address">允许的话，它会读取你的网络出口城市，显示当地殡仪馆。拒绝也可以。</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button class="btn btn--sm btn--primary" type="button" data-action="allow-location">允许它找到你</button>
        <button class="btn btn--sm btn--ghost" type="button" data-action="refuse-location">拒绝</button>
      </div>
      <div class="disclaimer">不会获取精确位置，也不会保存你的城市。仅用于本地生成一段虚构文字。</div>
    </div>`;
  }

  async function locatePlayer() {
    const holder = byId('badLocation');
    if (!holder || locationBusy) return;
    locationBusy = true;
    holder.innerHTML = `<div class="location-panel"><div class="status">LOCATING...</div><div class="city">正在读取你的影子。</div><div class="address">如果你的网络在墙后面，它可能找不到你。</div></div>`;
    const loc = await fetchIpCity();
    locationBusy = false;
    if (!loc) {
      holder.innerHTML = `<div class="location-panel">
        <div class="status">LOCATION FAILED / 0 RESULTS</div>
        <div class="city">我找不到你们的殡仪馆。</div>
        <div class="address">那我就在你家楼下等你吧。</div>
        <form data-form="manual-city" style="margin-top:12px"><label class="field-label">或者，你可以自己告诉我</label><div class="input-row"><input class="field" name="city" placeholder="输入城市"><button class="btn btn--sm" type="submit">确认</button></div></form>
        <button class="btn btn--sm btn--ghost" type="button" data-action="ending-finish" style="margin-top:10px">继续</button>
      </div>`;
      return;
    }
    holder.innerHTML = locationHTML(loc.city, 'resolved');
  }

  function resolveManualCity(city) {
    const holder = byId('badLocation');
    if (!holder) return;
    const clean = String(city || '').trim();
    if (!clean) return;
    holder.innerHTML = locationHTML(clean, 'resolved');
    audio.flatline();
  }

  /* ---------------------------------------------------------
     actions
     --------------------------------------------------------- */
  function showFormError(form, message) {
    const el = form.querySelector('[data-error]');
    if (el) {
      el.textContent = message;
      el.classList.remove('is-shaking');
      void el.offsetWidth;
      el.classList.add('is-shaking');
    }
    audio.error();
    const input = form.querySelector('input');
    if (input) input.focus({ preventScroll: true });
  }

  function handleOasLogin(form) {
    const role = state.ui.loginRole || 'staff';
    const user = (form.querySelector('[name="user"]') || {}).value || '';
    const pass = (form.querySelector('[name="pass"]') || {}).value || '';
    const expected = D.accounts[role] || D.accounts.oas;
    if (role !== 'staff' && !state.gameCompleted) {
      showFormError(form, '该身份通道尚未开放。完成一次调查后才会出现。');
      return;
    }
    if (user.trim().toLowerCase() !== expected.user.toLowerCase() || pass !== expected.pass) {
      showFormError(form, '工号或密码错误。系统已记录本次尝试。');
      return;
    }
    state.started = true;
    state.puzzles.oasLogin = true;
    audio.unlockChime();
    if (role === 'staff') {
      state.currentIdentity = 'chengwei';
      saveState();
      navigate('oasDashboard');
    } else if (role === 'shenchi') {
      state.currentIdentity = 'shenchi';
      state.puzzles.patientLogin = true;
      state.ui.patientTab = 'diary';
      findClue('d074');
      pendingPatientIntro = true;
      saveState();
      navigate('patient');
    } else {
      state.currentIdentity = 'shenbo';
      state.puzzles.engineerLogin = true;
      state.ui.engineerTab = 'orders';
      pendingEngineerIntro = true;
      saveState();
      navigate('engineer');
    }
  }

  function handleArchivePuzzle(form) {
    const id = form.dataset.id;
    const a = findArchive(id);
    const input = form.querySelector('[name="answer"]');
    const value = norm(input ? input.value : '');
    const answer = norm(a.puzzle.answer);
    if (value !== answer && !(id === 'shenchi' && value === '临渊')) {
      showFormError(form, '密文没有回应。再试一次。');
      return;
    }
    setPuzzle(id);
    findClue(id === 'shenchi' ? 'linyuan' : 'repair');
    saveState();
    const both = bothSolved();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    openModal({
      tone: 'success',
      kicker: `ARCHIVE DECRYPTED / ${a.archiveNo}`,
      title: a.puzzle.successTitle,
      body: `<p>${esc(a.puzzle.successText)}</p>${both ? '<p style="color:#d8b979;margin-top:14px">两份异常档案均已完成复核。临渊研究所入口已开放。</p>' : '<p style="color:#8d8173;margin-top:14px">还有一份异常档案在等你。</p>'}`,
      actions: [{ label: both ? '前往临渊研究所' : '继续复核', tone: 'primary', action: both ? 'go' : 'go-dashboard', data: both ? 'institute' : '' }]
    });
    audio.unlockChime();
  }

  function handleNewsCipher(form) {
    const input = form.querySelector('[name="answer"]');
    const value = norm(input ? input.value : '');
    if (!['74347', 'N Z Q Z N D C =', 'NZQZNDC='].includes(value) && value !== '74347') {
      showFormError(form, '校验码错误。附件没有打开。');
      return;
    }
    setPuzzle('base64');
    findClue('huaxia');
    saveState();
    render();
    openModal({
      tone: 'success',
      kicker: 'DOWNLOAD KEY ACCEPTED',
      title: '镜像站点已恢复',
      body: '<p>校验通过。一个名为“华夏灵异网”的旧论坛从缓存里浮出来。首页最新回复时间是 03:47。</p><p style="color:#d8b979">入口：华夏灵异网 / 异闻讨论区。找到那条关于“十八层”的老帖。</p>',
      actions: [{ label: '进入华夏灵异网', tone: 'primary', action: 'go', data: 'forum' }]
    });
    audio.unlockChime();
  }

  function handleHellLogin(form) {
    const user = ((form.querySelector('[name="user"]') || {}).value || '').trim();
    const pass = ((form.querySelector('[name="pass"]') || {}).value || '').trim();
    if (user !== D.accounts.hell.user || pass !== D.accounts.hell.pass) {
      showFormError(form, '印记不对。门没有开。');
      return;
    }
    state.currentIdentity = 'chengwei';
    state.puzzles.hellLogin = true;
    state.ui.hellTab = 'scrolls';
    findClue('floor18');
    audio.flatline();
    if (state.gameCompleted && !state.seenReturn) {
      state.seenReturn = true;
      pendingReturn = true;
    }
    saveState();
    navigate('hell');
  }

  function handlePanyangLogin(form) {
    const user = ((form.querySelector('[name="user"]') || {}).value || '').trim();
    const pass = ((form.querySelector('[name="pass"]') || {}).value || '').trim();
    if (user.toUpperCase() !== D.accounts.panyang.user.toUpperCase() || pass !== D.accounts.panyang.pass) {
      showFormError(form, '员工编号或密码错误。审计系统已记录。');
      return;
    }
    state.puzzles.panyangLogin = true;
    state.currentIdentity = 'shenbo';
    saveState();
    audio.unlockChime();
    navigate('panyang');
  }

  function handleScripture(form) {
    const input = form.querySelector('[name="answer"]');
    const value = norm(input ? input.value : '');
    if (!['VESSEL', '器皿'].includes(value)) {
      showFormError(form, '字母没有翻转。再试一次。');
      return;
    }
    setPuzzle('scripture');
    findClue('vessel');
    audio.unlockChime();
    saveState();
    render();
    openModal({
      tone: 'success',
      kicker: 'CIPHER BROKEN / ATBASH',
      title: 'VESSEL / 器皿',
      body: `<p>${esc(D.hell.scripture.successText)}</p><p style="color:#d8b979;margin-top:14px">隐藏手记已解锁。最终门不再只是一个词。</p>`,
      actions: [
        { label: '阅读经文', tone: 'primary', action: 'open-scroll', data: 'scripture' },
        { label: '打开隐藏手记', tone: 'ghost', action: 'open-scroll', data: 'hidden' }
      ]
    });
  }

  function handleFinalDoor(form) {
    if (!state.puzzles.scripture) {
      showFormError(form, '门没有回应。');
      return;
    }
    const input = form.querySelector('[name="city"]');
    const value = cityNorm(input ? input.value : '');
    if (value !== '成都' && value.toUpperCase() !== 'CHENGDU') {
      showFormError(form, '门上的字没有亮。不是这座城市。');
      return;
    }
    setPuzzle('finalDoor');
    findClue('chengdu');
    state.corridorStep = 0;
    saveState();
    closeModal(true);
    dim('门开了。', 1050).then(() => {
      navigate('corridor', { flash: true, noPush: true });
    });
  }

  function handleManualCity(form) {
    const input = form.querySelector('[name="city"]');
    resolveManualCity(input ? input.value : '');
  }

  function handleForm(form) {
    const type = form.dataset.form;
    if (type === 'oas-login') handleOasLogin(form);
    else if (type === 'archive-puzzle') handleArchivePuzzle(form);
    else if (type === 'news-cipher') handleNewsCipher(form);
    else if (type === 'hell-login') handleHellLogin(form);
    else if (type === 'panyang-login') handlePanyangLogin(form);
    else if (type === 'scripture') handleScripture(form);
    else if (type === 'final-door') handleFinalDoor(form);
    else if (type === 'terminal-input') handleTerminalInput((form.querySelector('[name="q"]') || {}).value);
    else if (type === 'manual-city') handleManualCity(form);
  }

  function handleAction(action, el) {
    const id = el && el.dataset ? (el.dataset.id || '') : '';
    audio.unlock();
    if (action !== 'audio') audio.click();
    switch (action) {
      case 'back':
        goBack();
        break;
      case 'start-game':
        state.started = true;
        state.ui.loginRole = 'staff';
        state.currentIdentity = 'chengwei';
        saveState();
        navigate('oasLogin');
        break;
      case 'continue-game': {
        if (!state.started) { handleAction('start-game', el); return; }
        let scene = state.lastScene;
        if (!validScene(scene) || scene === 'opening') scene = 'oasLogin';
        if ((scene === 'patient' || scene === 'engineer') && !state.gameCompleted) scene = 'oasLogin';
        if (scene === 'hell' && !state.puzzles.hellLogin) scene = 'hellLogin';
        if (scene === 'hellScroll' && !state.ui.scrollId) scene = 'hell';
        if (scene === 'ending' && !state.endingId) scene = 'opening';
        route = { scene };
        historyStack = [];
        render();
        break;
      }
      case 'request-reset':
        openModal({
          tone: 'red',
          kicker: 'WARNING / ERASE',
          title: '清除所有记录？',
          body: '<p>所有线索、谜题进度、二周目选择与已收集结局都会被删除。这个操作无法撤回。</p>',
          actions: [
            { label: '确认清除', tone: 'primary', action: 'confirm-reset' },
            { label: '保留记录', tone: 'ghost' }
          ],
          dismissible: true
        });
        break;
      case 'confirm-reset': {
        closeModal(true);
        try {
          window.localStorage.removeItem(SAVE_KEY);
          window.localStorage.removeItem(LEGACY_KEY);
        } catch (e) {}
        state = defaultState();
        route = { scene: 'opening' };
        historyStack = [];
        render();
        toast('所有记录已清除。');
        break;
      }
      case 'new-run':
        startNewRun();
        break;
      case 'open-gallery':
        openGallery();
        break;
      case 'switch-login':
        if (id !== 'staff' && !state.gameCompleted) {
          openModal({
            tone: 'dark',
            kicker: 'ACCESS DENIED / 0 RECORDS',
            title: '这个身份还没有醒来',
            body: '<p>样本端与工程端只在完成一次调查后开放。先走完一周目，再回到这里。</p>',
            actions: [{ label: '知道了', tone: 'ghost' }]
          });
          return;
        }
        state.ui.loginRole = id;
        saveState();
        render();
        break;
      case 'open-archive':
        state.archiveId = id;
        if (id === 'shenchi') findClue('d074');
        saveState();
        navigate('archive');
        break;
      case 'oas-nav':
        if (id === 'dashboard') {
          if (route.scene !== 'oasDashboard') navigate('oasDashboard');
        } else {
          openOasSection('archives');
        }
        break;
      case 'oas-section':
        openOasSection(id);
        break;
      case 'go-puzzle-next':
        if (bothSolved()) navigate('institute');
        else navigate('oasDashboard');
        break;
      case 'institute-tab':
        state.ui.instituteTab = id;
        if (id === 'news') state.ui.newsArticle = null;
        saveState();
        render();
        window.scrollTo(0, 0);
        break;
      case 'open-news':
        state.ui.newsArticle = id;
        saveState();
        render();
        window.scrollTo(0, 0);
        break;
      case 'close-news':
        state.ui.newsArticle = null;
        saveState();
        render();
        break;
      case 'forum-list':
        state.ui.forumPost = null;
        state.currentIdentity = 'chengwei';
        saveState();
        render();
        window.scrollTo(0, 0);
        break;
      case 'open-post':
        state.ui.forumPost = id;
        state.puzzles.forum = true;
        saveState();
        render();
        window.scrollTo(0, 0);
        break;
      case 'forum-stub':
        toast('这个板块的旧数据已经损坏。只有异闻讨论区还能打开。');
        break;
      case 'go-hell-login':
        navigate('hellLogin');
        break;
      case 'panyang-tab':
        state.ui.panyangTab = id;
        saveState();
        render();
        break;
      case 'hell-tab':
        state.ui.hellTab = id;
        saveState();
        render();
        window.scrollTo(0, 0);
        break;
      case 'open-scroll':
        if (id === 'hidden' && !state.puzzles.scripture) {
          openModal({
            tone: 'dark',
            kicker: 'SCROLL SEALED',
            title: '这一页被压住了',
            body: '<p>先去黑暗经书，把那个名字解出来。隐藏手记只对读懂经书的人开放。</p>',
            actions: [{ label: '去黑暗经书', tone: 'primary', action: 'open-scroll', data: 'scripture' }]
          });
          return;
        }
        state.ui.scrollId = id;
        saveState();
        navigate('hellScroll');
        break;
      case 'toggle-discussion':
        state.ui.openDiscussion = state.ui.openDiscussion === id ? null : id;
        saveState();
        render({ keepScroll: true });
        break;
      case 'open-final-door':
        if (!state.puzzles.scripture) {
          openModal({
            tone: 'red',
            kicker: 'THE DOOR DOES NOT ANSWER',
            title: '经书还缺一页',
            body: '<p>最终门只认三个东西：一个名字、一个入口、一座城市。你还没有解出黑暗经书。</p>',
            actions: [{ label: '去解读黑暗经书', tone: 'primary', action: 'open-scroll', data: 'scripture' }]
          });
          return;
        }
        navigate('finalDoor');
        break;
      case 'play-morse':
        playMorse();
        break;
      case 'play-heart':
        playHeartbeatSequence();
        break;
      case 'show-dutybook':
        findClue('witness');
        openModal({
          tone: 'paper',
          kicker: 'RECOVERED / HANDWRITTEN',
          title: '张桂兰的值班本',
          wide: true,
          body: `<div style="font-family:var(--kai);font-size:16px;line-height:2.1;color:#443b2e">${D.engineer.dutyBook.map((l) => `<p>${esc(l)}</p>`).join('')}</div><p style="font-size:11px;color:#8b7c67;margin-top:16px">纸页边缘有反复摩挲的痕迹。最后一页的铅笔字被描了很多遍。</p>`,
          actions: [{ label: '合上值班本', tone: 'ghost' }]
        });
        audio.page();
        break;
      case 'choose-shenchi': {
        if (state.choices.shenchi) { toast('你已经回复过他了。'); return; }
        const warn = id === 'warn';
        state.choices.shenchi = warn ? 'warn' : 'dismiss';
        state.warnings.shenchi = warn;
        saveState();
        const y = window.scrollY;
        render();
        window.scrollTo(0, y);
        openModal({
          tone: 'blue',
          kicker: 'MESSAGE SENT / heart_74',
          title: warn ? '好，我听你的' : '对话已结束',
          body: `<p>${warn ? '好，我听你的。我不吃别的药了。' : '……好。那我回家了。'}</p><p style="color:${warn ? '#8fd6b2' : '#7c9aad'};margin-top:14px">${warn ? '沈迟的用药记录已被保留。一条线被你改写了。' : '沈迟退出了对话。监护仪上的心率恢复为 74。'}</p>`,
          actions: [{ label: '知道了', tone: 'primary' }]
        });
        if (warn) audio.heartbeatNow();
        break;
      }
      case 'open-recording':
        state.ui.engineerTab = 'recording';
        saveState();
        render();
        break;
      case 'choose-recording': {
        if (state.choices.shenbo) { toast('这条工单已经关闭了。'); return; }
        const warn = id === 'warn';
        state.choices.shenbo = warn ? 'warn' : 'listen';
        state.warnings.shenbo = warn;
        state.puzzles.recording = true;
        saveState();
        const y = window.scrollY;
        render();
        window.scrollTo(0, y);
        openModal({
          tone: 'steel',
          kicker: 'WORK ORDER CLOSED / YQSM-68',
          title: warn ? '工单已关闭' : '录音已播放',
          body: `<p>${warn ? '好，我不听了。我下班回家。' : '……里面是我妈在数数。她数到 68 就停了。'}</p><p style="color:${warn ? '#8fd6b2' : '#d2a089'};margin-top:14px">${warn ? '你没有点开录音。走廊尽头的灯熄灭了一盏。' : '录音里的女人没有喊他的名字。她只是在数：一、二、三……六十八。'}</p>`,
          actions: [{ label: '知道了', tone: 'primary' }]
        });
        if (warn) audio.page();
        else { audio.staticNoise(1.5, 0.045); audio.breathe(); }
        break;
      }
      case 'go-dashboard':
        state.currentIdentity = 'chengwei';
        saveState();
        navigate('oasDashboard');
        break;
      case 'go-portal':
        if (!state.gameCompleted) {
          openModal({
            tone: 'dark',
            kicker: 'CHANNEL LOCKED',
            title: '二周目通道尚未开启',
            body: '<p>完成任意一个结局后，OAS 会开放患者样本端和设备工程端。</p>',
            actions: [{ label: '知道了', tone: 'ghost' }]
          });
          return;
        }
        state.ui.loginRole = id;
        state.currentIdentity = id;
        saveState();
        navigate('oasLogin');
        break;
      case 'patient-tab':
        state.ui.patientTab = id;
        saveState();
        render();
        window.scrollTo(0, 0);
        break;
      case 'engineer-tab':
        state.ui.engineerTab = id;
        saveState();
        render();
        window.scrollTo(0, 0);
        break;
      case 'corridor-next':
        if (state.corridorStep < CORRIDOR_LINES.length - 1) {
          state.corridorStep += 1;
          saveState();
          audio.page();
          render({ keepScroll: true });
        }
        break;
      case 'enter-terminal':
        state.terminalLog = [];
        state.terminalAsked = [];
        state.terminalReady = false;
        saveState();
        navigate('terminal');
        break;
      case 'terminal-ask':
        askQuestion(id);
        break;
      case 'final-choice':
        if (id === 'stay' && warningCount() === 0) {
          toast('你还没有改变任何一条线。', true);
          return;
        }
        openModal({
          tone: 'red',
          kicker: 'FINAL DECISION',
          title: '这一步不能回头',
          body: `<p>${id === 'morgue' ? '去殡仪馆。看看那扇门后面到底有什么。' : id === 'photo' ? '随手拍下来。把这一切留在手机里，然后离开。' : '不去，就这样活下去。天亮以后，回到正常的生活。'}</p><p style="color:#b98f83">结局会写入档案。你已经收集了 ${endedCount()} / 4 个结局。</p>`,
          actions: [
            { label: '确认', tone: 'primary', action: 'confirm-ending', data: id },
            { label: '再想想', tone: 'ghost' }
          ],
          dismissible: true
        });
        break;
      case 'confirm-ending':
        closeModal(true);
        if (id === 'stay') {
          const warns = warningCount();
          startEnding(warns >= 2 ? 'true' : warns === 1 ? 'middle' : 'fake');
        } else {
          startEnding(id === 'morgue' ? 'bad' : 'fake');
        }
        break;
      case 'ending-next':
        advanceEnding();
        break;
      case 'ending-skip':
        if (fakeCountdownTimer) { window.clearInterval(fakeCountdownTimer); fakeCountdownTimer = null; }
        finishHeartCount();
        state.endingSpecial = false;
        state.endingDone = true;
        saveState();
        render();
        break;
      case 'ending-finish':
        finishHeartCount();
        state.endingSpecial = false;
        state.endingDone = true;
        saveState();
        render();
        break;
      case 'allow-location':
        locatePlayer();
        break;
      case 'refuse-location': {
        const holder = byId('badLocation');
        if (holder) {
          holder.innerHTML = `<div class="location-panel"><div class="status">LOCATION REFUSED</div><div class="city">我找不到你们的殡仪馆。</div><div class="address">那我就在你家楼下等你吧。</div><button class="btn btn--sm btn--primary" type="button" data-action="ending-finish" style="margin-top:14px">继续</button></div>`;
        }
        break;
      }
      case 'start-heart-count':
        startHeartCount();
        break;
      case 'go':
        if (id === 'opening') {
          route = { scene: 'opening' };
          historyStack = [];
          render();
        } else {
          navigate(id);
        }
        break;
      case 'close':
        closeModal();
        break;
      case 'noop':
        break;
      default:
        break;
    }
  }

  function startPatientCount() {
    if (patientCountTimer) return;
    const tick = () => {
      patientCount += 1;
      if (patientCount > 74) {
        window.clearInterval(patientCountTimer);
        patientCountTimer = null;
        return;
      }
      const el = byId('countWhisper');
      if (el) el.textContent = String(patientCount).padStart(2, '0');
      if (patientCount % 2 === 0) audio.countWhisper();
    };
    patientCountTimer = window.setInterval(tick, 3000);
  }

  function startNewRun() {
    state.run += 1;
    state.started = true;
    state.currentIdentity = 'chengwei';
    state.runRecorded = false;
    state.warnings = { shenchi: false, shenbo: false };
    state.choices = { shenchi: null, shenbo: null };
    state.terminalAsked = [];
    state.terminalLog = [];
    state.terminalReady = false;
    state.finalChoice = null;
    state.corridorStep = 0;
    state.endingId = null;
    state.endingStep = 0;
    state.endingSpecial = false;
    state.endingDone = false;
    state.seenReturn = false;
    state.ui.loginRole = 'staff';
    state.ui.patientTab = 'diary';
    state.ui.engineerTab = 'orders';
    state.ui.hellTab = 'scrolls';
    state.ui.scrollId = null;
    state.ui.forumPost = null;
    state.lastScene = 'opening';
    historyStack = [];
    saveState();
    pendingRunIntro = true;
    navigate('opening', { flash: true, noPush: true });
  }

  function playMorse() {
    const seq = [
      { pattern: '.----', gap: 480 },
      { pattern: '....-', gap: 480 },
      { pattern: '--...', gap: 480 },
      { pattern: '....-', gap: 800 }
    ];
    let t = 0;
    seq.forEach((group) => {
      group.pattern.split('').forEach((ch) => {
        window.setTimeout(() => {
          if (ch === '.') audio.beep();
          else audio.beepLong();
        }, t);
        t += ch === '.' ? 130 : 330;
      });
      t += group.gap;
    });
  }

  function playHeartbeatSequence() {
    let n = 0;
    const timer = window.setInterval(() => {
      audio.heartbeatNow();
      n += 1;
      if (n >= 8) window.clearInterval(timer);
    }, 1200);
  }

  /* ---------------------------------------------------------
     events + init
     --------------------------------------------------------- */
  document.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (actionEl) {
      if (actionEl.tagName === 'A') event.preventDefault();
      if (actionEl.disabled) return;
      try { if (navigator.vibrate && window.matchMedia('(pointer: coarse)').matches) navigator.vibrate(6); } catch (e) {}
      handleAction(actionEl.dataset.action, actionEl);
      if (actionEl.hasAttribute('data-modal-close')) closeModal();
      return;
    }
    const closeEl = event.target.closest('[data-modal-close]');
    if (closeEl) { closeModal(); return; }
    if (clueDock && clueDock.classList.contains('is-open') && !event.target.closest('#clueDock')) closeClue();
  });

  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    handleForm(form);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (modalOpen && modalDismissible) closeModal();
      else if (!modalOpen && clueDock && clueDock.classList.contains('is-open')) closeClue();
    }
    if (event.key === 'Enter' && route.scene === 'ending' && !modalOpen) {
      const target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON')) return;
      if (!state.endingDone) advanceEnding();
    }
  });

  clueTab.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleClue();
    audio.click();
  });
  byId('clueClose').addEventListener('click', (event) => {
    event.stopPropagation();
    closeClue();
  });
  audioToggle.addEventListener('click', () => {
    audio.unlock();
    const muted = audio.toggleMuted();
    updateAudioUI();
    if (!muted) audio.setMode(SCENE_AUDIO[route.scene] || 'none');
    toast(muted ? '声音已关闭。' : '声音已开启。');
  });

  document.addEventListener('pointerdown', function unlockAudioOnce() {
    audio.unlock();
    document.removeEventListener('pointerdown', unlockAudioOnce);
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      document.title = '别走。';
    } else {
      document.title = SCENE_TITLES[route.scene] || '末栏 · ARG 三部曲';
    }
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      window.location.reload();
    }
  });

  window.addEventListener('popstate', () => {
    // The game uses an internal stack; browser back should not destroy progress.
    if (historyStack.length) goBack();
  });

  // debug / QA hook (harmless in production)
  window.Molan = {
    get state() { return state; },
    get scene() { return route.scene; },
    go(scene) {
      route = { scene: validScene(scene) ? scene : 'opening' };
      render();
    },
    navigate,
    render,
    save: saveState,
    reset() {
      try { window.localStorage.removeItem(SAVE_KEY); window.localStorage.removeItem(LEGACY_KEY); } catch (e) {}
      state = defaultState();
      route = { scene: 'opening' };
      historyStack = [];
      render();
    }
  };

  updateClueUI();
  updateAudioUI();
  audio.pendingMode = 'heartbeat';
  render();
  console.log('%c末栏 · ARG 三部曲', 'color:#8b0000;font-size:18px;font-family:serif');
  console.log('%c它一直在看。', 'color:#b8860b;font-size:11px');
})();
