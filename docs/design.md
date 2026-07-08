# 디자인 스펙 — 학생 성적 분석 사이트

주색 `#036242`(딥 파인그린) 계열. 스타일: **클레이모피즘**. **이모지 전면 금지 → 모든 아이콘·뱃지는 인라인 SVG.**

---

## 1. 색 토큰 (CSS 변수)

`#036242` 기준 명도 단계 팔레트. `:root`에 정의해 전역 사용.

```css
:root {
  /* 브랜드 그린 스케일 (진함 → 연함) */
  --green-900: #024C34; /* 그림자/짙은 텍스트 */
  --green-800: #036242; /* 주색 (brand) */
  --green-700: #0A7A54;
  --green-600: #12936A;
  --green-500: #3FA37E;
  --green-400: #6FBE9E;
  --green-300: #A9D9C4;
  --green-200: #D6EFE4;
  --green-100: #E6F4EE; /* 표면 틴트 */
  --green-050: #F1F8F5; /* 페이지 배경 */

  /* 의미 토큰 */
  --brand:        var(--green-800);
  --brand-strong: var(--green-900);
  --brand-accent: var(--green-600);

  --bg:      var(--green-050);
  --surface: var(--green-100);
  --text:      #0B2F23; /* 니어블랙 그린 */
  --text-soft: #3C5C4F;
  --white:     #FFFFFF;

  /* 클레이 그림자 (그린 톤) */
  --clay-shadow-dark: rgba(3, 60, 42, 0.18);  /* 우하단 짙은 그림자 */
  --clay-highlight:   rgba(255, 255, 255, 0.9); /* 좌상단 하이라이트 */
}
```

### 다크 모드 (선택, `@media (prefers-color-scheme: dark)`)
- `--bg: #0A1F17; --surface: #12291F; --text: #E6F4EE; --text-soft: #A9D9C4;`
- `--clay-shadow-dark: rgba(0,0,0,0.5); --clay-highlight: rgba(63,163,126,0.12);`
- 브랜드 스케일은 유지, 표면만 어둡게.

---

## 2. 클레이모피즘 레시피

핵심: 큰 라운드 + 이중 `box-shadow`(외부 짙은 그림자 + 좌상단 밝은 하이라이트). 표면색은 배경보다 살짝 밝게.

```css
/* 볼록 (raised) — 카드/버튼 기본 */
.clay {
  background: var(--surface);
  border-radius: 24px;
  box-shadow:
     8px  8px 18px var(--clay-shadow-dark),
    -8px -8px 18px var(--clay-highlight);
}

/* 오목 (pressed/inset) — 입력창, 눌림 상태 */
.clay-inset {
  background: var(--surface);
  border-radius: 18px;
  box-shadow:
    inset 6px 6px 12px var(--clay-shadow-dark),
    inset -6px -6px 12px var(--clay-highlight);
}

/* 강조 볼록 — 주색 채운 버튼 */
.clay-brand {
  background: var(--brand);
  color: var(--white);
  border-radius: 20px;
  box-shadow:
     6px  6px 14px var(--clay-shadow-dark),
    -6px -6px 14px rgba(255,255,255,0.25);
}
```

- 라운드 스케일: 카드 `24px`, 서브카드 `18px`, 버튼 `20px`, 뱃지 `pill(999px)` 또는 라운드 사각.
- hover: 그림자 offset/blur 소폭 증가. active: `clay-inset`로 전환(눌림감).
- 테두리(border) 사용 금지 — 깊이는 그림자로만.

---

## 3. 타이포 / 간격

```css
--font-sans: 'Pretendard', 'Noto Sans KR', system-ui, sans-serif;
```
- 스케일: `12 / 14 / 16(본문) / 20 / 24 / 32 / 40`px.
- 무게: 본문 400, 라벨/버튼 600, 숫자·등급 700.
- 간격 스텝(4px 기반): `4 / 8 / 12 / 16 / 24 / 32 / 48`.
- 숫자(점수·등급)는 `font-variant-numeric: tabular-nums`.

---

## 4. 컴포넌트 스펙

### 코드 입력창 (첫 화면)
- 중앙 카드(`.clay`), 안쪽 입력은 `.clay-inset`.
- 라벨 "학생 코드 입력", 확인 버튼 `.clay-brand`.
- 열쇠 SVG 아이콘(§6) 좌측.

### 과목 카드
- `.clay`, 상단: 과목 SVG 아이콘 + 과목명, 우상단: 5등급 뱃지.
- 중앙: 반영 총점(큰 숫자), 하단: 미니 히스토그램(본인 위치 마커).
- 반/번호·석차·백분위 표시 금지.

### 5등급 뱃지
- 라운드 사각 SVG 컨테이너 + 숫자. 배경색 = 등급 색(§5), 텍스트 흰색(1~3등급)·`--text`(4~5등급).
- "N등급" 텍스트 병기.

### 버튼
- 기본 `.clay-brand`(주색). 보조 `.clay`(표면색 + `--brand` 텍스트).

### 탭 토글 (교사 / 학생)
- `.clay-inset` 트랙 안에 볼록 슬라이더(활성 탭 = `.clay-brand`).
- 각 탭 좌측 SVG 아이콘(§6: `teacher`, `student`). 이모지 금지.

### 교사 탭 비밀번호 게이트
- 중앙 카드(`.clay`) + `.clay-inset` 암호 입력 + `key` SVG(§6).
- 실패 시 흔들림 애니메이션(비난 색 아님, 중립). 통과 후 `cohort.json` 로드.

### 진전 카드 (학생)
- `.clay`, 과목 SVG 아이콘 + 과목명, 우상단 5등급 뱃지(참고).
- 본문: 도달률 진전 라인/스파크라인. 중간+기말 과목은 변화량 뱃지(방향 화살표 SVG).
- **하강 변화도 붉은 경고색 금지** — 중립 그린 톤. 전체 분포·위치 표시 금지.

---

## 5. 등급 색 매핑

1(최상)→5로 갈수록 진한 그린→연한 그린. 브랜드 계열 유지.

| 등급 | 색 | 텍스트 |
|---|---|---|
| 1등급 | `--green-800` `#036242` | 흰색 |
| 2등급 | `--green-700` `#0A7A54` | 흰색 |
| 3등급 | `--green-500` `#3FA37E` | 흰색 |
| 4등급 | `--green-300` `#A9D9C4` | `--text` |
| 5등급 | `--green-200` `#D6EFE4` | `--text` |

---

## 6. SVG 아이콘 세트 (이모지 대체)

- 공통 규격: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.75"`, `stroke-linecap/linejoin="round"`.
- `currentColor` 상속 → 색 토큰으로 제어. **이모지 문자 절대 사용 안 함.**
- `src/icons/`에 개별 파일 또는 JS 문자열 상수로 보관.

필요 아이콘:
- 탭: `teacher`(칠판/사람), `student`(사람/성장).
- UI: `key`(코드·비밀번호), `search`, `chart-bar`(히스토그램), `box`(상자그림), `trend`(진전 라인), `arrow-up`/`arrow-down`(변화 방향), `chevron`, `close`, `info`.
- 과목: `book`(국어/영어), `function`/`sigma`(수학), `flask`(과학), `run`(체육), `note`(음악), `palette`(미술), `globe`(사회) 등 — 라인 스타일 통일.
- 등급 뱃지: 라운드 사각/헥사 배경 `<rect rx>` + 중앙 숫자 `<text>`.

---

## 7. 차트 색 매핑 (Chart.js)

전부 그린 팔레트. **프레이밍 규칙**: 학생 차트는 자기 대비 진전만, 서열/타학생 비교 금지. 하강·저점도 붉은 경고색 쓰지 않음(중립 그린).

### 진전 라인 — 학생 (메인)
- 라인/포인트: `--brand` `#036242`, 두께 3px, 포인트 반경 4.
- 채움(area): `rgba(3, 98, 66, 0.14)`.
- 시간축: 수행 → 중간 → 기말 (도달률 %, y 0~100).
- 중간→기말 변화 뱃지: 상승 `--green-600`, **하강 `--green-400`(중립, 경고색 아님)** + 방향 화살표 SVG.
- 타학생 데이터·분포 절대 표시 안 함.

### 히스토그램 — 교사
- 막대 기본: `--green-300` `#A9D9C4`, 강조 구간 `--green-600` `#12936A`.
- 기준선(`chartjs-plugin-annotation`): `--green-900` `#024C34`.
- 축·격자: `--text-soft`, 격자 `rgba(3,60,42,0.08)`.

### 상자그림 (box plot) — 교사
- `@sgratzl/chartjs-chart-boxplot`. 박스 채움 `--green-200`, 테두리 `--green-700`.
- 중앙값 선 `--green-900`, 수염 `--text-soft`, 이상치 점 `--green-600`.

### 레이더 (선택) — 학생 자기 과목 프로필
- 자기 과목 도달률/등급 프로필만(타인 비교 아님). 선 `--brand`, 채움 `rgba(3,98,66,0.22)`.

### 공통
- 캔버스 배경 투명(카드 표면 위). 폰트 `--font-sans`, 색 `--text`.
- 툴팁: 표면색 배경 + 소프트 그림자. 반/번호 등 식별정보·타학생 값 노출 금지.
