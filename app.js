/* 韦氏智力测试 · 答题引擎与计分 */
(function () {
  'use strict';

  var TEST = window.WAIS_TEST;
  var SECTIONS = TEST.sections;
  var QUESTIONS = TEST.questions;

  // 分测验主题色（与题库 section 对应）
  var COLORS = { VCI: '#4f46e5', VSI: '#0ea5e9', FRI: '#8b5cf6', WMI: '#10b981', PSI: '#f59e0b' };

  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ---------- 展平题目顺序 ----------
  var FLAT = [];
  SECTIONS.forEach(function (sec) {
    QUESTIONS.filter(function (q) { return q.section === sec.key; })
      .forEach(function (q) { FLAT.push({ q: q, sec: sec }); });
  });
  var SECTION_START = {};   // section.key -> 在 FLAT 中的起始下标
  SECTIONS.forEach(function (sec) {
    SECTION_START[sec.key] = FLAT.findIndex(function (f) { return f.sec.key === sec.key; });
  });
  var TOTAL = FLAT.length;

  // ---------- 运行状态 ----------
  var S = {
    screen: 'home',
    si: 0,            // 当前分测验下标
    qi: 0,            // 当前节内题号
    answers: {},      // flatIndex -> { choice: 0-3|null, timedOut: bool, ms: 毫秒 }
    startedAt: 0,
    qStartedAt: 0,
    selected: null,   // 未计时节的当前选择
    timerInt: null,   // 计时 interval
    memTimer: null,   // 记忆阶段 timer
    result: null,
  };

  // ---------- 存档 ----------
  var LS_STATE = 'wais50_state_v1', LS_RESULT = 'wais50_result_v1';
  function saveState() {
    try {
      localStorage.setItem(LS_STATE, JSON.stringify({
        si: S.si, qi: S.qi, answers: S.answers, startedAt: S.startedAt
      }));
    } catch (e) { /* 隐私模式等场景忽略 */ }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(LS_STATE);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearState() { try { localStorage.removeItem(LS_STATE); } catch (e) {} }
  function saveResult(r) { try { localStorage.setItem(LS_RESULT, JSON.stringify(r)); } catch (e) {} }
  function loadResult() {
    try { return JSON.parse(localStorage.getItem(LS_RESULT) || 'null'); } catch (e) { return null; }
  }

  // ---------- 屏幕切换 ----------
  function show(screen) {
    S.screen = screen;
    ['home', 'intro', 'quiz', 'result'].forEach(function (n) {
      $('screen-' + n).classList.toggle('hidden', n !== screen);
    });
    window.scrollTo(0, 0);
  }

  // ---------- 首页 ----------
  function renderHome() {
    // 五大维度卡片
    $('section-cards').innerHTML = SECTIONS.map(function (sec) {
      var n = QUESTIONS.filter(function (q) { return q.section === sec.key; }).length;
      var meta = sec.timed
        ? '<span class="meta hot">⏱ 每题 ' + sec.perQSeconds + ' 秒</span>'
        : '<span class="meta">⏳ 不限时</span>';
      return '<div class="card">' +
        '<div class="icon">' + sec.icon + '</div>' +
        '<div class="name">' + sec.name + '</div>' +
        '<div class="en">' + sec.en + '</div>' +
        '<div class="tagline">' + esc(sec.tagline) + '</div>' +
        meta + ' <span class="meta">' + n + ' 题</span>' +
        '</div>';
    }).join('');

    // 好友挑战横幅（通过分享链接进入）
    var m = /[#&]iq=(\d+)(?:&p=(\d+))?/.exec(location.hash);
    var banner = $('friend-banner');
    if (m) {
      var iq = +m[1], p = m[2] ? +m[2] : null;
      banner.className = 'banner friend';
      banner.innerHTML = '<span>🏅</span><span class="banner-text">你的好友测出了 <b>' + iq +
        '</b> 分' + (p !== null ? '（超过约 ' + p + '% 的人）' : '') + '，开始测试，看能否超越 TA！</span>';
    } else { banner.className = 'banner friend hidden'; }

    // 断点续测横幅
    var st = loadState();
    var rb = $('resume-banner');
    var done = st ? Object.keys(st.answers || {}).length : 0;
    if (st && done > 0 && done < TOTAL) {
      rb.className = 'banner resume';
      rb.innerHTML = '<span>⏸</span><span class="banner-text">检测到上次未完成的测试（已完成 ' + done + '/' + TOTAL + ' 题）</span>' +
        '<button id="btn-resume" class="btn btn-primary btn-sm">继续测试</button>' +
        '<button id="btn-discard" class="btn btn-ghost btn-sm">放弃</button>';
      $('btn-resume').onclick = function () { restoreState(st); };
      $('btn-discard').onclick = function () { clearState(); renderHome(); };
    } else { rb.className = 'banner resume hidden'; }

    // 上次结果入口
    var last = loadResult();
    var startBtn = $('btn-start');
    startBtn.textContent = (st && done > 0 && done < TOTAL) ? '重新开始测试' : '开始测试';
    if (last && last.fiq) {
      if (!$('btn-view-last')) {
        var b = document.createElement('button');
        b.id = 'btn-view-last';
        b.className = 'btn btn-ghost btn-sm';
        b.style.cssText = 'display:block;margin:14px auto 0;';
        b.textContent = '查看上次成绩（' + last.fiq + ' 分）';
        b.onclick = function () { renderResult(last, true); };
        startBtn.parentNode.appendChild(b);
      }
    } else {
      var b2 = $('btn-view-last'); if (b2) b2.parentNode.removeChild(b2);
    }
  }

  // ---------- 分节引导 ----------
  function renderIntro(si) {
    S.si = si; S.qi = 0;
    var sec = SECTIONS[si];
    var n = QUESTIONS.filter(function (q) { return q.section === sec.key; }).length;
    $('intro-card').innerHTML =
      '<div class="intro-icon">' + sec.icon + '</div>' +
      '<div class="intro-step">第 ' + (si + 1) + ' / ' + SECTIONS.length + ' 节</div>' +
      '<div class="intro-name">' + sec.name + '</div>' +
      '<div class="intro-en">' + sec.en + '</div>' +
      '<div class="intro-tagline">' + esc(sec.tagline) + '</div>' +
      '<div class="intro-count">共 ' + n + ' 题</div>' +
      '<div class="intro-rule">' + esc(sec.intro) + '</div>' +
      '<button id="btn-begin-section" class="btn btn-primary btn-xl">开始本节</button>';
    $('btn-begin-section').onclick = function () { startSection(); };
    show('intro');
  }

  // ---------- 答题 ----------
  function curSection() { return SECTIONS[S.si]; }
  function flatIndexOf() {
    var base = SECTION_START[curSection().key];
    return base + S.qi;
  }

  function startSection() {
    S.qi = 0;
    show('quiz');
    renderQuestion();
  }

  function stopTimers() {
    if (S.timerInt) { clearInterval(S.timerInt); S.timerInt = null; }
    if (S.memTimer) { clearTimeout(S.memTimer); S.memTimer = null; }
  }

  function renderQuestion() {
    stopTimers();
    S.selected = null;
    var sec = curSection();
    var item = FLAT[flatIndexOf()];
    var q = item.q;
    var globalNo = flatIndexOf() + 1;

    // 顶部
    var chip = $('quiz-section-chip');
    chip.textContent = sec.icon + ' ' + sec.name;
    chip.style.background = COLORS[sec.key];
    $('quiz-global-progress').textContent = '第 ' + globalNo + ' / ' + TOTAL + ' 题';
    var answered = Object.keys(S.answers).length;
    $('quiz-progress-fill').style.width = (answered / TOTAL * 100) + '%';
    $('btn-prev').disabled = flatIndexOf() === 0;

    // 计时条
    var tw = $('timer-wrap');
    if (sec.timed) {
      tw.classList.remove('hidden');
      startQTimer(sec.perQSeconds);
    } else { tw.classList.add('hidden'); }

    // 记忆两阶段
    if (q.memSplit) {
      $('question-area').classList.add('hidden');
      renderMemoryPhase(q);
      return;
    }

    $('memory-phase').classList.add('hidden');
    $('question-area').classList.remove('hidden');
    renderQBody(q, null);
    S.qStartedAt = Date.now();
  }

  // 渲染题干 + 选项（memR 非空表示处于记忆题的回忆阶段）
  function renderQBody(q, memR) {
    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<span class="' + (i <= q.difficulty ? '' : 'off') + '">★</span>';
    }
    $('question-stars').innerHTML = stars;
    var taskEl = $('question-task');
    if (memR) {
      // 回忆阶段：绝不回显含记忆内容的原题干
      taskEl.textContent = memR;
      taskEl.classList.remove('hidden');
      $('question-text').textContent = '请凭记忆作答';
    } else if (q.image) {
      taskEl.classList.add('hidden');
      $('question-text').textContent = '观察图形规律，选出问号处最合适的选项：';
    } else {
      taskEl.classList.add('hidden');
      $('question-text').textContent = q.text;
    }

    var imgEl = $('question-image');
    if (q.image) { imgEl.src = q.image; imgEl.classList.remove('hidden'); }
    else { imgEl.removeAttribute('src'); imgEl.classList.add('hidden'); }

    var box = $('options');
    var letters = 'ABCDEF';
    if (q.image) {
      box.className = 'options img-options';
      box.innerHTML = q.options.map(function (src, i) {
        var badge = q.baked ? '' : '<span class="letter">' + letters[i] + '</span>';
        return '<button class="option opt-img" data-i="' + i + '">' + badge +
          '<img src="' + src + '" alt="选项 ' + letters[i] + '"></button>';
      }).join('');
    } else {
      box.className = 'options';
      box.innerHTML = q.options.map(function (opt, i) {
        return '<button class="option" data-i="' + i + '">' +
          '<span class="letter">' + letters[i] + '</span><span>' + esc(opt) + '</span></button>';
      }).join('');
    }
    Array.prototype.forEach.call(box.querySelectorAll('.option'), function (btn) {
      btn.onclick = function () { onPick(+btn.getAttribute('data-i')); };
    });

    var sec = curSection();
    var nextBtn = $('btn-next');
    if (sec.timed) {
      nextBtn.classList.add('hidden');   // 计时节点击即提交
    } else {
      nextBtn.classList.remove('hidden');
      nextBtn.disabled = true;
      // 返回已作答的题目时回显原选择，可直接改选
      var prevAns = S.answers[flatIndexOf()];
      if (prevAns && prevAns.choice !== null) {
        S.selected = prevAns.choice;
        var prevOpt = box.querySelectorAll('.option')[prevAns.choice];
        if (prevOpt) prevOpt.classList.add('selected');
        nextBtn.disabled = false;
      }
    }
  }

  // 记忆题两阶段
  function renderMemoryPhase(q) {
    var mp = $('memory-phase');
    mp.classList.remove('hidden');
    $('memory-content').textContent = q.memSplit.m;
    // 展示时长：按内容长度 2–6 秒（v2 减半）
    var secs = clamp(Math.ceil(q.memSplit.m.length * 0.175), 2, 6);
    var left = secs;
    var cd = $('memory-countdown');
    cd.textContent = left + ' 秒后隐藏';
    S.memTimer = setInterval(function () {
      left--;
      if (left <= 0) {
        clearInterval(S.memTimer); S.memTimer = null;
        mp.classList.add('hidden');
        $('question-area').classList.remove('hidden');
        renderQBody(q, q.memSplit.r);
        S.qStartedAt = Date.now();
      } else {
        cd.textContent = left + ' 秒后隐藏';
      }
    }, 1000);
  }

  // 每题计时
  function startQTimer(seconds) {
    var total = seconds * 1000;
    var endsAt = Date.now() + total;
    var fill = $('timer-fill'), num = $('timer-num');
    fill.classList.remove('urgent'); num.classList.remove('urgent');
    S.qStartedAt = Date.now();
    function tick() {
      var remain = endsAt - Date.now();
      if (remain <= 0) {
        stopTimers();
        fill.style.width = '0%'; num.textContent = '0.0s';
        onTimeout();
        return;
      }
      var frac = remain / total;
      fill.style.width = (frac * 100) + '%';
      num.textContent = (remain / 1000).toFixed(1) + 's';
      var urgent = remain <= Math.max(5000, total * 0.2);
      fill.classList.toggle('urgent', urgent);
      num.classList.toggle('urgent', urgent);
    }
    tick();
    S.timerInt = setInterval(tick, 100);
  }

  function recordAnswer(choice, timedOut) {
    var idx = flatIndexOf();
    S.answers[idx] = {
      choice: choice,
      timedOut: !!timedOut,
      ms: Date.now() - S.qStartedAt,
    };
    S.qi++;
    saveState();
  }

  function advance() {
    var sec = curSection();
    var nInSection = QUESTIONS.filter(function (q) { return q.section === sec.key; }).length;
    if (S.qi >= nInSection) {
      // 本节完成
      if (S.si + 1 < SECTIONS.length) {
        renderIntro(S.si + 1);
      } else {
        finish();
      }
    } else {
      renderQuestion();
    }
  }

  function onPick(i) {
    var q = FLAT[flatIndexOf()].q;
    var sec = curSection();
    if (sec.timed) {
      // 计时节：点击即提交，短暂反馈后进入下一题
      var btns = $('options').querySelectorAll('.option');
      Array.prototype.forEach.call(btns, function (b, k) {
        b.disabled = true;
        if (k === i) b.classList.add('flash');
      });
      stopTimers();
      recordAnswer(i, false);
      setTimeout(advance, 260);
    } else {
      // 非计时节：可反复选择，点“下一题”提交
      S.selected = i;
      var btns2 = $('options').querySelectorAll('.option');
      Array.prototype.forEach.call(btns2, function (b, k) {
        b.classList.toggle('selected', k === i);
      });
      $('btn-next').disabled = false;
    }
  }

  function onNext() {
    if (S.selected === null) return;
    recordAnswer(S.selected, false);
    advance();
  }

  // 返回上一题（可跨分测验）；限时题返回后重新计时
  function goBack() {
    var idx = flatIndexOf();
    if (idx === 0) return;
    var target = FLAT[idx - 1];
    S.si = SECTIONS.findIndex(function (s) { return s.key === target.sec.key; });
    S.qi = idx - 1 - SECTION_START[target.sec.key];
    saveState();
    renderQuestion();
  }

  function onTimeout() {
    var idx = flatIndexOf();
    // 超时后禁用选项，防止延迟跳转窗口内的误点写入下一题
    Array.prototype.forEach.call($('options').querySelectorAll('.option'), function (b) { b.disabled = true; });
    // 已作答的题（返回重做场景）超时不覆盖原答案，直接前进
    if (S.answers[idx]) {
      toast('⏰ 时间到', true);
      setTimeout(advance, 350);
      return;
    }
    recordAnswer(null, true);
    toast('⏰ 时间到', true);
    setTimeout(advance, 350);
  }

  var toastTimer = null;
  function toast(msg, warn) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (warn ? ' warn' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1400);
  }

  // ---------- 断点续测 ----------
  function restoreState(st) {
    S.si = st.si; S.qi = st.qi;
    S.answers = st.answers || {};
    S.startedAt = st.startedAt || Date.now();
    show('quiz');
    renderQuestion();
  }

  // ---------- 计分 ----------
  // 正确率 p = Σ(答对题难度) / Σ(全部题难度)；未答/超时记 0
  function sectionStats(secKey) {
    var num = 0, den = 0, correct = 0, total = 0;
    var base = SECTION_START[secKey];
    var n = QUESTIONS.filter(function (q) { return q.section === secKey; }).length;
    for (var i = base; i < base + n; i++) {
      var q = FLAT[i].q;
      var a = S.answers[i];
      den += q.difficulty;
      total++;
      if (a && a.choice === q.correct) { num += q.difficulty; correct++; }
    }
    return { p: den ? num / den : 0, correct: correct, total: total };
  }

  // 分数曲线（来源算法）：70 + 20p + 58p^1.8 + 3sin(πp)，截断 [55,150]
  function scoreCurve(p) {
    var s = 70 + 20 * p + 58 * Math.pow(p, 1.8) + 3 * Math.sin(Math.PI * p);
    return clamp(Math.round(s), 55, 150);
  }

  // 误差函数（Abramowitz–Stegun 近似）
  function erf(x) {
    var s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  var CLASSIFICATION = [
    { min: 130, label: '极优秀', en: 'Very Superior' },
    { min: 120, label: '优秀', en: 'Superior' },
    { min: 110, label: '高于平均', en: 'High Average' },
    { min: 90, label: '平均', en: 'Average' },
    { min: 80, label: '低于平均', en: 'Low Average' },
    { min: 70, label: '边缘', en: 'Borderline' },
    { min: 0, label: '极低', en: 'Extremely Low' },
  ];
  function classify(fsiq) {
    for (var i = 0; i < CLASSIFICATION.length; i++) {
      if (fsiq >= CLASSIFICATION[i].min) return CLASSIFICATION[i];
    }
    return CLASSIFICATION[CLASSIFICATION.length - 1];
  }

  // 作答有效性检查（温和提示，不作废结果）
  function validityCheck() {
    var answered = Object.keys(S.answers).map(function (k) { return S.answers[k]; });
    var clicked = answered.filter(function (a) { return a.choice !== null; });
    if (clicked.length >= 15) {
      var avg = clicked.reduce(function (s, a) { return s + a.ms; }, 0) / clicked.length;
      if (avg < 2000) return '系统检测到平均作答时间明显过短（' + (avg / 1000).toFixed(1) + ' 秒/题），结果的有效性可能受到影响。';
      var counts = {};
      clicked.forEach(function (a) { counts[a.choice] = (counts[a.choice] || 0) + 1; });
      var maxRatio = Math.max.apply(null, Object.keys(counts).map(function (k) { return counts[k]; })) / clicked.length;
      if (maxRatio > 0.6) return '系统检测到同一选项被连续大量选择，结果的有效性可能受到影响。';
    }
    return null;
  }

  function finish() {
    clearState();
    var scores = {}, stats = {};
    SECTIONS.forEach(function (sec) {
      var st = sectionStats(sec.key);
      stats[sec.key] = st;
      scores[sec.key] = scoreCurve(st.p);
    });
    var fsiq = clamp(Math.round(
      (scores.VCI + scores.VSI + scores.FRI + scores.WMI + scores.PSI) / 5
    ), 70, 158);
    var gai = Math.round((scores.VCI + scores.VSI + scores.FRI) / 3);
    var percentile = clamp(Math.round(phi((fsiq - 100) / 15) * 100), 1, 99);
    var cls = classify(fsiq);
    var correctTotal = Object.keys(stats).reduce(function (s, k) { return s + stats[k].correct; }, 0);
    var elapsed = Math.round((Date.now() - S.startedAt) / 1000);

    S.result = {
      fiq: fsiq, gai: gai, percentile: percentile,
      cls: cls.label, clsEn: cls.en,
      scores: scores, stats: stats,
      correct: correctTotal, total: TOTAL,
      elapsed: elapsed, date: new Date().toISOString(),
      validity: validityCheck(),
    };
    saveResult(S.result);
    renderResult(S.result, false);
  }

  // ---------- 结果页 ----------
  function bellCurveSVG(fsiq) {
    var W = 640, H = 210, x0 = 40, x1 = 160, mid = 100, sd = 15;
    function X(v) { return (v - x0) / (x1 - x0) * (W - 40) + 20; }
    function Y(p) { return H - 34 - p * (H - 70); }
    var pts = [];
    for (var v = x0; v <= x1; v += 1) {
      var z = (v - mid) / sd;
      pts.push([X(v), Y(Math.exp(-z * z / 2))]);
    }
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + X(x1).toFixed(1) + ',' + Y(0) + ' L' + X(x0).toFixed(1) + ',' + Y(0) + ' Z';
    var mq = clamp(fsiq, x0, x1);
    var ticks = [55, 70, 85, 100, 115, 130, 145].map(function (t) {
      return '<text x="' + X(t) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="11" fill="#9aa0b4">' + t + '</text>';
    }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="bell" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#8b8bf0" stop-opacity=".55"/><stop offset="100%" stop-color="#8b8bf0" stop-opacity=".05"/>' +
      '</linearGradient></defs>' +
      '<line x1="20" y1="' + Y(0) + '" x2="' + (W - 20) + '" y2="' + Y(0) + '" stroke="#e5e7f0"/>' +
      '<path d="' + area + '" fill="url(#bell)"/>' +
      '<path d="' + line + '" fill="none" stroke="#5b5bd6" stroke-width="2.5" stroke-linejoin="round"/>' +
      '<line x1="' + X(mq) + '" y1="' + Y(0) + '" x2="' + X(mq) + '" y2="' + (Y(0) - (H - 70) - 8) + '" stroke="#ef4444" stroke-width="2" stroke-dasharray="5 4"/>' +
      '<circle cx="' + X(mq) + '" cy="' + (Y(0) - (H - 70) - 8) + '" r="5" fill="#ef4444"/>' +
      '<text x="' + X(mq) + '" y="' + (Y(0) - (H - 70) - 16) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#ef4444">' + fsiq + '</text>' +
      ticks +
      '</svg>';
  }

  function renderResult(r, fromStorage) {
    show('result');
    // 大数字滚动
    var el = $('result-iq'), target = r.fiq, t0 = null;
    function step(ts) {
      if (!t0) t0 = ts;
      var k = clamp((ts - t0) / 900, 0, 1);
      var ease = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(target * ease);
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);

    $('result-classification').textContent = r.cls + ' · ' + r.clsEn;
    $('result-percentile').textContent =
      '你的成绩超过了约 ' + r.percentile + '% 的受测者' + (fromStorage ? '（上次测试结果）' : '');

    $('bell-curve').innerHTML = bellCurveSVG(r.fiq) +
      '<div class="curve-caption">钟形曲线为正态分布（均值 100，标准差 15），红线为你所在的位置</div>';

    $('index-bars').innerHTML = SECTIONS.map(function (sec) {
      var sc = r.scores[sec.key];
      var w = clamp((sc - 55) / (150 - 55) * 100, 2, 100);
      return '<div class="ibar">' +
        '<div class="ibar-head"><span class="ibar-name">' + sec.icon + ' ' + sec.name +
        '<small>' + sec.en + '</small></span><span class="ibar-score">' + sc + '</span></div>' +
        '<div class="ibar-track"><div class="ibar-fill" data-w="' + w + '"></div></div></div>';
    }).join('');
    setTimeout(function () {
      Array.prototype.forEach.call(document.querySelectorAll('.ibar-fill'), function (f) {
        f.style.width = f.getAttribute('data-w') + '%';
      });
    }, 60);

    $('section-breakdown').innerHTML = SECTIONS.map(function (sec) {
      var st = r.stats[sec.key];
      return '<div class="bd-item"><div class="bd-name">' + sec.icon + ' ' + sec.name + '</div>' +
        '<div class="bd-val">' + st.correct + ' / ' + st.total + '</div></div>';
    }).join('');

    $('result-stats').innerHTML =
      '<div class="stat"><div class="stat-label">答对题数</div><div class="stat-value">' + r.correct + ' / ' + r.total + '</div></div>' +
      '<div class="stat"><div class="stat-label">用时</div><div class="stat-value">' + fmtTime(r.elapsed) + '</div></div>' +
      '<div class="stat"><div class="stat-label">一般能力指数 GAI</div><div class="stat-value">' + r.gai + '</div></div>' +
      '<div class="stat"><div class="stat-label">测试日期</div><div class="stat-value">' + r.date.slice(0, 10) + '</div></div>';

    var vn = $('validity-note');
    if (r.validity) { vn.textContent = '⚠️ ' + r.validity; vn.classList.remove('hidden'); }
    else { vn.classList.add('hidden'); }

    var shareUrl = location.origin + location.pathname + '#iq=' + r.fiq + '&p=' + r.percentile;
    $('btn-copy-link').onclick = function () {
      var text = '我在「韦氏智力测试」测得了 ' + r.fiq + ' 分（' + r.cls + '，超过约 ' + r.percentile + '% 的人）！你也来测测，看能不能超过我 👉 ' + shareUrl;
      copyText(text, '成绩链接已复制，快去分享吧！');
    };
    if (navigator.share) {
      $('btn-native-share').classList.remove('hidden');
      $('btn-native-share').onclick = function () {
        navigator.share({
          title: '韦氏智力测试',
          text: '我在「韦氏智力测试」测得了 ' + r.fiq + ' 分（' + r.cls + '），你也来挑战！',
          url: shareUrl,
        }).catch(function () {});
      };
    }
    shareUrlCache = shareUrl;
  }

  var shareUrlCache = '';
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(okMsg); }
      catch (e) { toast('复制失败，请长按链接手动复制', true); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
      // 页面下方常显可选中链接，便于手动复制
    } else { fallback(); }
    var box = document.querySelector('.share-card');
    var link = box.querySelector('.share-link-box');
    if (!link) {
      link = document.createElement('div');
      link.className = 'share-link-box';
      box.appendChild(link);
    }
    link.textContent = shareUrlCache;
  }

  function restart() {
    if (!confirm('确定要放弃当前进度并重新开始吗？')) return;
    clearState();
    S.si = 0; S.qi = 0; S.answers = {}; S.startedAt = 0; S.result = null;
    renderHome();
    show('home');
  }

  // ---------- 键盘 ----------
  document.addEventListener('keydown', function (e) {
    if (S.screen !== 'quiz') return;
    var sec = curSection();
    if ($('memory-phase') && !$('memory-phase').classList.contains('hidden')) return;
    var k = e.key.toLowerCase();
    var map = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5 };
    if (k in map && !$('question-area').classList.contains('hidden')) {
      var idx = map[k];
      var btns = $('options').querySelectorAll('.option');
      if (btns[idx] && !btns[idx].disabled) btns[idx].click();
    } else if (e.key === 'Enter' && !sec.timed && S.selected !== null) {
      onNext();
    } else if (e.key === 'ArrowLeft' && !$('question-area').classList.contains('hidden')) {
      goBack();
    }
  });

  // ---------- 事件绑定 ----------
  $('btn-start').onclick = function () {
    var st = loadState();
    var done = st ? Object.keys(st.answers || {}).length : 0;
    if (st && done > 0 && done < TOTAL) { clearState(); }
    S.si = 0; S.qi = 0; S.answers = {};
    S.startedAt = Date.now();
    saveState();
    renderIntro(0);
  };
  $('btn-next').onclick = onNext;
  $('btn-prev').onclick = goBack;
  $('btn-retry').onclick = restart;

  // ---------- 启动 ----------
  renderHome();
  show('home');
  // 分享链接仅改变 hash 时浏览器不会重载页面，监听以保持横幅同步
  window.addEventListener('hashchange', function () {
    if (S.screen === 'home') renderHome();
  });
})();
