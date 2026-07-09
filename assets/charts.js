/* 차트 빌더 — Chart.js(라인/막대) + 순수 SVG(상자그림). 색은 전부 #036242 그린 팔레트.
 * window.GK 에 노출. */
(function () {
  'use strict';
  var GK = window.GK || (window.GK = {});

  var TIP = { backgroundColor: '#0B2F23', titleColor: '#E6F4EE', bodyColor: '#E6F4EE', cornerRadius: 12, padding: 10, displayColors: false };

  function destroy(el) { if (window.Chart) { var c = window.Chart.getChart(el); if (c) c.destroy(); } }

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
        responsive: true, maintainAspectRatio: false, layout: { padding: 8 },
        plugins: { legend: { display: false }, tooltip: Object.assign({}, TIP, { callbacks: { label: function (c) { return '도달률 ' + c.raw + '%'; } } }) },
        scales: {
          y: { min: 0, max: 100, grid: { color: 'rgba(3,60,42,0.07)' }, border: { display: false }, ticks: { color: '#3C5C4F', font: { size: 11, family: 'Pretendard' }, callback: function (v) { return v + '%'; } } },
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#0B2F23', font: { size: 13, family: 'Pretendard', weight: '700' } } }
        }
      }
    });
  };

  // 미니 진전 스파크라인 (SVG 문자열) — 카드용
  GK.miniProgress = function (labels, data) {
    if (!data.length) return '';
    var w = 100, h = 40, pad = 4;
    var xs = data.map(function (_, i) { return data.length === 1 ? w / 2 : pad + i * (w - 2 * pad) / (data.length - 1); });
    var ys = data.map(function (v) { return h - pad - (v / 100) * (h - 2 * pad); });
    var line = data.length > 1 ? '<polyline points="' + xs.map(function (x, i) { return x + ',' + ys[i]; }).join(' ') + '" fill="none" stroke="#036242" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' : '';
    var dots = xs.map(function (x, i) { return '<circle cx="' + x + '" cy="' + ys[i] + '" r="2.6" fill="#036242"/>'; }).join('');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="40" preserveAspectRatio="none">' + line + dots + '</svg>';
  };

  // 교사 히스토그램 (코호트 분포, 본인 마커 없음)
  GK.histogram = function (el, totals) {
    if (!el || !window.Chart) return null;
    destroy(el);
    var lo = Math.floor(Math.min.apply(null, totals)), hi = Math.ceil(Math.max.apply(null, totals));
    var bins = 18, width = (hi - lo) / bins || 1;
    var counts = new Array(bins).fill(0);
    totals.forEach(function (v) { var b = Math.floor((v - lo) / width); if (b >= bins) b = bins - 1; if (b < 0) b = 0; counts[b]++; });
    var labels = counts.map(function (_, i) { return Math.round(lo + width * (i + 0.5)); });
    var fill = function (c) {
      var ctx = c.chart.ctx, area = c.chart.chartArea;
      if (!area) return '#A9D9C4';
      var g = ctx.createLinearGradient(0, area.bottom, 0, area.top);
      g.addColorStop(0, '#7FC7A6'); g.addColorStop(1, '#D6EFE4');
      return g;
    };
    var clay = { id: 'clay', beforeDatasetDraw: function (ch) { var c = ch.ctx; c.save(); c.shadowColor = 'rgba(3,60,42,0.28)'; c.shadowBlur = 8; c.shadowOffsetX = 2; c.shadowOffsetY = 5; }, afterDatasetDraw: function (ch) { ch.ctx.restore(); } };
    return new window.Chart(el, {
      type: 'bar',
      data: { labels: labels, datasets: [{ data: counts, backgroundColor: fill, borderRadius: { topLeft: 9, topRight: 9 }, borderSkipped: false, categoryPercentage: 0.95, barPercentage: 0.96 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: Object.assign({}, TIP, { callbacks: { title: function (i) { return i[0].label + '점대'; }, label: function (c) { return c.raw + '명'; } } }) },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#3C5C4F', font: { size: 10.5, family: 'Pretendard' }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: { grid: { color: 'rgba(3,60,42,0.07)' }, border: { display: false }, ticks: { color: '#3C5C4F', font: { size: 10.5, family: 'Pretendard' }, precision: 0 }, title: { display: true, text: '학생 수', color: '#7FA895', font: { size: 11, family: 'Pretendard' } } }
        }
      }
    });
  };

  // 교사 5등급 분포 막대
  GK.gradeDist = function (el, counts, colors) {
    if (!el || !window.Chart) return null;
    destroy(el);
    return new window.Chart(el, {
      type: 'bar',
      data: { labels: ['1등급', '2등급', '3등급', '4등급', '5등급'], datasets: [{ data: counts.slice(1), backgroundColor: colors.slice(1), borderRadius: 8, borderSkipped: false, categoryPercentage: 0.7, barPercentage: 0.9 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: Object.assign({}, TIP, { callbacks: { label: function (c) { return c.raw + '명'; } } }) },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: '#0B2F23', font: { size: 12, family: 'Pretendard', weight: '700' } } },
          y: { grid: { color: 'rgba(3,60,42,0.07)' }, border: { display: false }, ticks: { color: '#3C5C4F', font: { size: 10.5, family: 'Pretendard' }, precision: 0 } }
        }
      }
    });
  };

  // 교사 상자그림 (여러 과목 나란히) — 순수 SVG. items: [{name, totals, stats}]
  GK.boxPlotSVG = function (items) {
    var W = 720, H = 300, padL = 34, padR = 12, padT = 14, padB = 34;
    var plotH = H - padT - padB, plotW = W - padL - padR;
    var y = function (v) { return padT + (1 - v / 100) * plotH; };
    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" style="font-family:Pretendard;">'];
    // y 격자 + 라벨
    [0, 25, 50, 75, 100].forEach(function (t) {
      svg.push('<line x1="' + padL + '" y1="' + y(t) + '" x2="' + (W - padR) + '" y2="' + y(t) + '" stroke="rgba(3,60,42,0.08)" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 6) + '" y="' + (y(t) + 3) + '" text-anchor="end" font-size="10" fill="#7FA895">' + t + '</text>');
    });
    var band = plotW / items.length;
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
      // 박스 (q1~q3)
      svg.push('<rect x="' + (cx - bw / 2) + '" y="' + y(s.q3) + '" width="' + bw + '" height="' + (y(s.q1) - y(s.q3)) + '" rx="6" fill="#A9D9C4" stroke="#0A7A54" stroke-width="1.5"/>');
      // 중앙값
      svg.push('<line x1="' + (cx - bw / 2) + '" y1="' + y(s.median) + '" x2="' + (cx + bw / 2) + '" y2="' + y(s.median) + '" stroke="#024C34" stroke-width="2.4"/>');
      // 이상치
      outliers.forEach(function (v) { svg.push('<circle cx="' + cx + '" cy="' + y(v) + '" r="2.6" fill="#12936A" opacity="0.75"/>'); });
      // 라벨
      svg.push('<text x="' + cx + '" y="' + (H - 12) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#0A3D2A">' + it.name + '</text>');
    });
    svg.push('</svg>');
    return svg.join('');
  };
})();
