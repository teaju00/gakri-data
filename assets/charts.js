/* 차트 빌더 — Chart.js(라인/막대) + 순수 SVG(상자그림). 색은 전부 #036242 그린 팔레트.
 * window.GK 에 노출. */
(function () {
  'use strict';
  var GK = window.GK || (window.GK = {});

  var TIP = { backgroundColor: '#0B2F23', titleColor: '#E6F4EE', bodyColor: '#E6F4EE', cornerRadius: 12, padding: 10, displayColors: false };

  function destroy(el) { if (window.Chart) { var c = window.Chart.getChart(el); if (c) c.destroy(); } }

  // hex 색을 흰색 쪽으로 amt(0~1)만큼 섞음 — 클레이 그라디언트 밝은 스탑용.
  function tint(hex, amt) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  // 지각 밝기(0~1) — 그림자 농도를 색상 밝기에 맞춰 조절할 때 사용.
  function luminance(hex) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substr(0, 2), 16) / 255, g = parseInt(h.substr(2, 2), 16) / 255, b = parseInt(h.substr(4, 2), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // SVG 텍스트에 들어가는 문자열 이스케이프 — 과목명 등 외부(관리자 설정) 문자열용.
  function escXml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 기술통계: 평균, 모집단 표준편차, min/q1/median/q3/max (사분위=선형보간 type7).
  // src-tauri/core/src/grade.rs · scripts/grade.mjs 와 동일 알고리즘의 브라우저 포팅.
  function percentile(sorted, p) {
    var n = sorted.length;
    if (n === 1) return sorted[0];
    var idx = p * (n - 1), lo = Math.floor(idx), hi = Math.ceil(idx), frac = idx - lo;
    return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
  }
  GK.summaryStats = function (values) {
    var n = values.length;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var mean = sorted.reduce(function (a, b) { return a + b; }, 0) / n;
    var variance = sorted.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / n;
    return {
      n: n, mean: mean, sd: Math.sqrt(variance), min: sorted[0],
      q1: percentile(sorted, 0.25), median: percentile(sorted, 0.5), q3: percentile(sorted, 0.75),
      max: sorted[n - 1]
    };
  };

  // 세션에 보이는 여러 반의 GroupNode를 하나로 합친다 — "전체 반" 통계용.
  // nodes: [{count, subjects:{sid:{name,totals,gradeCounts}}}, ...] (반 하나가 undefined 여도 무시)
  GK.combineClassNodes = function (nodes) {
    var count = 0;
    var bySubject = {};
    nodes.forEach(function (node) {
      if (!node) return;
      count += node.count || 0;
      Object.keys(node.subjects || {}).forEach(function (sid) {
        var d = node.subjects[sid];
        if (!d) return;
        if (!bySubject[sid]) bySubject[sid] = { name: d.name, totals: [], gradeCounts: [0, 0, 0, 0, 0, 0] };
        var acc = bySubject[sid];
        acc.totals = acc.totals.concat(d.totals);
        for (var i = 0; i < 6; i++) acc.gradeCounts[i] += (d.gradeCounts[i] || 0);
      });
    });
    var subjects = {};
    Object.keys(bySubject).forEach(function (sid) {
      var acc = bySubject[sid];
      if (!acc.totals.length) return;
      subjects[sid] = { name: acc.name, totals: acc.totals, gradeCounts: acc.gradeCounts, stats: GK.summaryStats(acc.totals) };
    });
    return { count: count, subjects: subjects };
  };

  // 고정 색상의 밝은 그라디언트 스탑 — 매 렌더마다 다시 계산할 필요 없어 한 번만 구해둔다.
  var TINT_SLOPE_DOT = tint('#036242', 0.42);
  var TINT_BADGE_POS = tint('#12936A', 0.4);
  var TINT_BADGE_NEG = tint('#6FBE9E', 0.4);
  var TINT_BOX_FILL = tint('#A9D9C4', 0.55);
  var TINT_DOT_FILL = tint('#12936A', 0.45);

  // 위쪽만 둥근 막대 경로(하단은 x축에 붙어 각짐) — 그림자/하이라이트 그리기 공용.
  function topRoundRectPath(ctx, left, y, w, downH, r) {
    ctx.beginPath();
    ctx.moveTo(left, y + downH);
    ctx.lineTo(left, y + r);
    ctx.arcTo(left, y, left + r, y, r);
    ctx.lineTo(left + w - r, y);
    ctx.arcTo(left + w, y, left + w, y + r, r);
    ctx.lineTo(left + w, y + downH);
    ctx.closePath();
  }

  // 막대 차트용 클레이 플러그인 — 외부 그린톤 그림자 + 막대 상단 유리질 하이라이트 밴드.
  // (인셋 그림자는 캔버스에 없어서 상단에 반투명 흰 그라디언트를 덧그려 '볼록' 느낌을 흉내낸다.)
  // opts.shadowAlpha(index): 막대별 그림자 농도. 이미 진한 막대 옆에 짙은 그림자를 겹치면 탁해 보이므로
  // 등급색처럼 막대마다 명도差 큰 경우 밝기에 비례해 낮춰준다(기본은 전부 동일 0.28).
  // opts.cornerRadius: 실제 막대(borderRadius)와 그림자 라운드를 맞추는 값 — 어긋나면 모서리에 그림자가 삐져나온다.
  function clayBarPlugin(opts) {
    var shadowAlpha = (opts && opts.shadowAlpha) || function () { return 0.28; };
    var cornerRadius = (opts && opts.cornerRadius) || 9;
    return {
      id: 'clayBars',
      afterDatasetDraw: function (ch) {
        var meta = ch.getDatasetMeta(0);
        if (!meta || !meta.data || !meta.data.length) return;
        var ctx = ch.ctx;
        // 두 패스(그림자/하이라이트)가 같은 막대 지오메트리를 쓰므로 한 번만 구해 공유한다.
        var bars = meta.data.map(function (bar, i) {
          var p = bar.getProps ? bar.getProps(['x', 'y', 'base', 'width'], true) : bar;
          if (p.y == null || p.base == null) return null;
          var h = p.base - p.y;
          return { i: i, x: p.x, y: p.y, width: p.width, left: p.x - p.width / 2, h: h };
        });

        // 그림자 — 이미 그려진 막대 '뒤'에만 남도록 destination-over로 합성.
        ctx.save();
        ctx.globalCompositeOperation = 'destination-over';
        bars.forEach(function (b) {
          if (!b || b.h <= 1) return;
          var alpha = shadowAlpha(b.i);
          if (alpha <= 0) return;
          var r = Math.min(cornerRadius, b.width / 2, b.h / 2);
          ctx.save();
          // 블러/오프셋을 작게 유지 — 막대 사이 간격이 좁아서 크게 잡으면 옆 막대까지 그림자가 번져
          // 막대 두 개가 겹친 것처럼 보인다(특히 옆 막대가 더 짧을 때 그 위로 그림자가 삐져나옴).
          ctx.shadowColor = 'rgba(3,60,42,' + alpha + ')';
          ctx.shadowBlur = 3; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 2.5;
          ctx.fillStyle = 'rgba(3,60,42,1)';
          topRoundRectPath(ctx, b.left, b.y, b.width, b.h, r);
          ctx.fill();
          ctx.restore();
        });
        ctx.restore();

        // 상단 유리질 하이라이트
        ctx.save();
        bars.forEach(function (b) {
          if (!b || b.h <= 3) return;
          var hh = Math.min(b.h * 0.4, 16), r = Math.min(cornerRadius, b.width / 2, hh);
          var grad = ctx.createLinearGradient(0, b.y, 0, b.y + hh);
          grad.addColorStop(0, 'rgba(255,255,255,0.55)');
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = grad;
          topRoundRectPath(ctx, b.left, b.y, b.width, hh, r);
          ctx.fill();
        });
        ctx.restore();
      }
    };
  }

  // 학생 자기대비 진전 라인: 도달률(%) 수행→중간→기말. 타학생 비교 없음.
  GK.progressLine = function (el, labels, data) {
    if (!el || !window.Chart) return null;
    destroy(el);
    var fill = function (c) {
      var ctx = c.chart.ctx, area = c.chart.chartArea;
      if (!area) return 'rgba(3,98,66,0.12)';
      var g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, 'rgba(3,98,66,0.20)'); g.addColorStop(1, 'rgba(3,98,66,0.02)');
      return g;
    };
    return new window.Chart(el, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          data: data, fill: true, backgroundColor: fill, borderColor: '#036242', borderWidth: 3.5,
          tension: 0.25, pointBackgroundColor: '#036242', pointBorderColor: '#fff', pointBorderWidth: 2.5, pointRadius: 6, pointHoverRadius: 8
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 12, bottom: 6, left: 16, right: 16 } },
        plugins: { legend: { display: false }, tooltip: Object.assign({}, TIP, { callbacks: { label: function (c) { return '도달률 ' + c.raw + '%'; } } }) },
        scales: {
          y: { min: 0, max: 100, grid: { color: 'rgba(3,60,42,0.07)' }, border: { display: false }, ticks: { color: '#3C5C4F', font: { size: 11, family: 'Pretendard' }, stepSize: 20, callback: function (v) { return v + '%'; } } },
          x: { offset: true, grid: { display: false }, border: { display: false }, ticks: { color: '#0B2F23', font: { size: 13, family: 'Pretendard', weight: '700' } } }
        }
      }
    });
  };

  // 미니 진전 스파크라인 (SVG 문자열) — 카드용
  GK.miniProgress = function (labels, data) {
    if (!data.length) return '';
    // 넓은 viewBox + 비율 유지(meet) → 좌우로 안 늘어남(점이 타원 안 됨). height는 폭 비례.
    var w = 240, h = 46, padX = 12, padY = 9;
    var xs = data.map(function (_, i) { return data.length === 1 ? w / 2 : padX + i * (w - 2 * padX) / (data.length - 1); });
    var ys = data.map(function (v) { return h - padY - (v / 100) * (h - 2 * padY); });
    var line = data.length > 1 ? '<polyline points="' + xs.map(function (x, i) { return x + ',' + ys[i]; }).join(' ') + '" fill="none" stroke="#036242" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' : '';
    var dots = xs.map(function (x, i) { return '<circle cx="' + x + '" cy="' + ys[i] + '" r="3.2" fill="#036242"/>'; }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;height:auto;">' + line + dots + '</svg>';
  };

  // 슬로프 차트 (도달률 변화, SVG)
  GK.slopeChart = function (labels, data) {
    if (!labels || labels.length < 2) return '';
    var W = 480, H = 200;
    var n = labels.length;
    var xs = n === 2 ? [140, 340] : [80, 240, 400];
    
    var minVal = Math.min.apply(null, data);
    var maxVal = Math.max.apply(null, data);
    var range = maxVal - minVal;
    var yTop = 70, yBot = 140;
    var getY = function(val) {
      if (range === 0) return (yTop + yBot) / 2;
      return yBot - ((val - minVal) / range) * (yBot - yTop);
    };

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" style="display:block;height:auto;overflow:visible;" xmlns="http://www.w3.org/2000/svg">';
    svg += '<style>text{font-family:Pretendard,sans-serif;}</style>';
    svg += '<defs>' +
      '<filter id="slopeShadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="1.5" dy="2.4" stdDeviation="2" flood-color="#022A1D" flood-opacity="0.32"/></filter>' +
      '<radialGradient id="slopeDot" cx="35%" cy="28%" r="75%"><stop offset="0" stop-color="' + TINT_SLOPE_DOT + '"/><stop offset="65%" stop-color="#036242"/><stop offset="100%" stop-color="#024C34"/></radialGradient>' +
      '<linearGradient id="badgePos" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + TINT_BADGE_POS + '"/><stop offset="1" stop-color="#12936A"/></linearGradient>' +
      '<linearGradient id="badgeNeg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + TINT_BADGE_NEG + '"/><stop offset="1" stop-color="#6FBE9E"/></linearGradient>' +
      '</defs>';

    // 연결선
    var linePts = xs.slice(0, n).map(function (x, i) { return x + ',' + getY(data[i]); }).join(' ');
    svg += '<polyline points="' + linePts + '" fill="none" stroke="#A9D9C4" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';

    // 변화 배지 (선 위에 그려서 가리기) — 볼록 클레이 필: 그라디언트 + 외부 그림자.
    for (var j = 0; j < n - 1; j++) {
      var delta = Math.round((data[j + 1] - data[j]) * 10) / 10;
      var badgeText = delta >= 0 ? '+' + delta + '%p' : delta + '%p';
      var badgeGrad = delta >= 0 ? 'url(#badgePos)' : 'url(#badgeNeg)';
      var mx = (xs[j] + xs[j + 1]) / 2;
      var my = (getY(data[j]) + getY(data[j + 1])) / 2;
      var bw = badgeText.length * 8 + 12;
      svg += '<rect x="' + (mx - bw / 2) + '" y="' + (my - 12) + '" width="' + bw + '" height="24" rx="8" fill="' + badgeGrad + '" stroke="#F0F7F3" stroke-width="3" filter="url(#slopeShadow)"/>';
      svg += '<text x="' + mx + '" y="' + (my + 4) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">' + badgeText + '</text>';
    }

    // 점 + 라벨 + 수치 — 점은 유리질 반사가 있는 볼록 구슬로.
    for (var i = 0; i < n; i++) {
      var x = xs[i];
      var y = getY(data[i]);
      // 라벨
      svg += '<text x="' + x + '" y="' + (y - 35) + '" text-anchor="middle" font-size="13" font-weight="600" fill="#3C5C4F">' + labels[i] + '</text>';
      // 수치
      svg += '<text x="' + x + '" y="' + (y - 12) + '" text-anchor="middle" font-size="28" font-weight="800" fill="#036242">' + Math.round(data[i]) + '%</text>';
      // 원 (볼록 클레이 구슬: 방사형 하이라이트 + 외부 그림자 + 표면색 테두리)
      svg += '<circle cx="' + x + '" cy="' + y + '" r="8" fill="url(#slopeDot)" stroke="#F0F7F3" stroke-width="3" filter="url(#slopeShadow)"/>';
    }

    svg += '</svg>';
    return svg;
  };

  // 교사 히스토그램 (코호트 분포, 본인 마커 없음)
  GK.histogram = function (el, totals) {
    if (!el || !window.Chart) return null;
    destroy(el);
    var bins = 10; // 100점 기준 10점 단위 (0~10 … 90~100)
    var counts = new Array(bins).fill(0);
    totals.forEach(function (v) { var b = Math.floor(v / 10); if (b >= bins) b = bins - 1; if (b < 0) b = 0; counts[b]++; });
    var labels = counts.map(function (_, i) { return i === bins - 1 ? (i * 10) + '~100' : (i * 10) + '~' + (i * 10 + 9); });
    var fill = function (c) {
      var ctx = c.chart.ctx, area = c.chart.chartArea;
      if (!area) return '#A9D9C4';
      var g = ctx.createLinearGradient(0, area.bottom, 0, area.top);
      g.addColorStop(0, '#7FC7A6'); g.addColorStop(1, '#D6EFE4');
      return g;
    };
    return new window.Chart(el, {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: counts, backgroundColor: fill, borderRadius: { topLeft: 9, topRight: 9 }, borderSkipped: false, categoryPercentage: 0.95, barPercentage: 0.96 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: Object.assign({}, TIP, { callbacks: { title: function (i) { return i[0].label + '점'; }, label: function (c) { return c.raw + '명'; } } }) },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#3C5C4F', font: { size: 9.5, family: 'Pretendard' }, maxRotation: 0, autoSkip: false } },
          y: { grid: { color: 'rgba(3,60,42,0.07)' }, border: { display: false }, ticks: { color: '#3C5C4F', font: { size: 10.5, family: 'Pretendard' }, precision: 0 }, title: { display: true, text: '학생 수', color: '#7FA895', font: { size: 11, family: 'Pretendard' } } }
        }
      },
      plugins: [clayBarPlugin()]
    });
  };

  // 교사 5등급 분포 막대 — 등급색 그대로, 위는 밝게 아래는 원색인 클레이 그라디언트.
  GK.gradeDist = function (el, counts, colors) {
    if (!el || !window.Chart) return null;
    destroy(el);
    var palette = colors.slice(1);
    var fill = function (c) {
      var base = palette[c.dataIndex], ctx = c.chart.ctx, area = c.chart.chartArea;
      if (!area || !base) return base;
      var g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, tint(base, 0.4)); g.addColorStop(1, base);
      return g;
    };
    return new window.Chart(el, {
      type: 'bar',
      data: { labels: ['1등급', '2등급', '3등급', '4등급', '5등급'], datasets: [{ data: counts.slice(1), backgroundColor: fill, borderRadius: { topLeft: 8, topRight: 8 }, borderSkipped: false, categoryPercentage: 0.7, barPercentage: 0.9 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: Object.assign({}, TIP, { callbacks: { label: function (c) { return c.raw + '명'; } } }) },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#0B2F23', font: { size: 12, family: 'Pretendard', weight: '700' } } },
          y: { grid: { color: 'rgba(3,60,42,0.07)' }, border: { display: false }, ticks: { color: '#3C5C4F', font: { size: 10.5, family: 'Pretendard' }, precision: 0 } }
        }
      },
      plugins: [clayBarPlugin({ cornerRadius: 8, shadowAlpha: function (i) { return 0.1 + 0.2 * luminance(palette[i]); } })]
    });
  };

  // 교사 상자그림 (여러 과목 나란히) — 순수 SVG. items: [{name, totals, stats}]
  GK.boxPlotSVG = function (items) {
    var W = 720, H = 300, padL = 34, padR = 12, padT = 14, padB = 34;
    var plotH = H - padT - padB, plotW = W - padL - padR;
    var y = function (v) { return padT + (1 - v / 100) * plotH; };
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" style="font-family:Pretendard;overflow:visible;">'];
    svg.push('<defs>' +
      '<filter id="boxShadow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="2" dy="3.5" stdDeviation="2.4" flood-color="#022A1D" flood-opacity="0.26"/></filter>' +
      '<filter id="dotShadow" x="-100%" y="-100%" width="300%" height="300%"><feDropShadow dx="1" dy="1.4" stdDeviation="1.2" flood-color="#022A1D" flood-opacity="0.35"/></filter>' +
      '<linearGradient id="boxFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + TINT_BOX_FILL + '"/><stop offset="1" stop-color="#A9D9C4"/></linearGradient>' +
      '<linearGradient id="boxHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.7"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>' +
      '<radialGradient id="dotFill" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="' + TINT_DOT_FILL + '"/><stop offset="100%" stop-color="#0A7A54"/></radialGradient>' +
      '</defs>');
    var band = plotW / items.length;
    // 현재 선택된 반(it.active) 배경 강조 — 그리드보다 먼저 그려서 그 위에 얹힌다.
    items.forEach(function (it, i) {
      if (!it.active) return;
      var hlcx = padL + band * (i + 0.5);
      svg.push('<rect x="' + (hlcx - band / 2 + 1) + '" y="' + padT + '" width="' + (band - 2) + '" height="' + plotH + '" rx="8" fill="rgba(3,98,66,0.07)"/>');
    });
    // y 격자 + 라벨
    [0, 25, 50, 75, 100].forEach(function (t) {
      svg.push('<line x1="' + padL + '" y1="' + y(t) + '" x2="' + (W - padR) + '" y2="' + y(t) + '" stroke="rgba(3,60,42,0.08)" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 6) + '" y="' + (y(t) + 3) + '" text-anchor="end" font-size="10" fill="#7FA895">' + t + '</text>');
    });
    items.forEach(function (it, i) {
      var cx = padL + band * (i + 0.5), bw = Math.min(band * 0.5, 46);
      var s = it.stats, iqr = s.q3 - s.q1, loF = s.q1 - 1.5 * iqr, hiF = s.q3 + 1.5 * iqr;
      var inRange = it.totals.filter(function (v) { return v >= loF && v <= hiF; });
      var wLo = Math.min.apply(null, inRange), wHi = Math.max.apply(null, inRange);
      var outliers = it.totals.filter(function (v) { return v < loF || v > hiF; });
      // 수염
      svg.push('<line x1="' + cx + '" y1="' + y(wHi) + '" x2="' + cx + '" y2="' + y(wLo) + '" stroke="#0A7A54" stroke-width="1.5"/>');
      svg.push('<line x1="' + (cx - bw / 3) + '" y1="' + y(wHi) + '" x2="' + (cx + bw / 3) + '" y2="' + y(wHi) + '" stroke="#0A7A54" stroke-width="1.5"/>');
      svg.push('<line x1="' + (cx - bw / 3) + '" y1="' + y(wLo) + '" x2="' + (cx + bw / 3) + '" y2="' + y(wLo) + '" stroke="#0A7A54" stroke-width="1.5"/>');
      // 박스 (q1~q3) — 볼록 클레이: 외부 그림자 + 상단 그라디언트 + 유리질 하이라이트 오버레이
      var boxY = y(s.q3), boxH = y(s.q1) - y(s.q3);
      svg.push('<rect x="' + (cx - bw / 2) + '" y="' + boxY + '" width="' + bw + '" height="' + boxH + '" rx="6" fill="url(#boxFill)" stroke="#0A7A54" stroke-width="1.2" filter="url(#boxShadow)"/>');
      if (boxH > 6) {
        svg.push('<rect x="' + (cx - bw / 2 + 2) + '" y="' + (boxY + 2) + '" width="' + (bw - 4) + '" height="' + Math.max(0, Math.min(boxH * 0.45, boxH - 4)) + '" rx="4" fill="url(#boxHi)"/>');
      }
      // 중앙값
      svg.push('<line x1="' + (cx - bw / 2) + '" y1="' + y(s.median) + '" x2="' + (cx + bw / 2) + '" y2="' + y(s.median) + '" stroke="#024C34" stroke-width="2.4"/>');
      // 이상치 — 작은 볼록 구슬
      outliers.forEach(function (v) { svg.push('<circle cx="' + cx + '" cy="' + y(v) + '" r="3" fill="url(#dotFill)" filter="url(#dotShadow)" opacity="0.9"/>'); });
      // 라벨 — 현재 선택된 반은 브랜드색으로 강조.
      svg.push('<text x="' + cx + '" y="' + (H - 12) + '" text-anchor="middle" font-size="12" font-weight="700" fill="' + (it.active ? '#036242' : '#0A3D2A') + '">' + escXml(it.name) + '</text>');
    });
    svg.push('</svg>');
    return svg.join('');
  };
})();
