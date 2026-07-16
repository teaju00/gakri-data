// Tauri 번들에 넣을 프론트 셸을 dist/ 로 모은다.
//
// frontendDist 를 저장소 루트로 두면 node_modules, data/*.xlsx, public/data/*(실제 점수),
// code-map.csv 까지 설치 파일에 딸려 들어간다. 그래서 필요한 것만 추린다.
// Tauri 모드의 데이터는 전부 앱 데이터 폴더에서 오므로 public/ 은 넣지 않는다.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

cpSync(path.join(root, 'index.html'), path.join(dist, 'index.html'));
cpSync(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true });

console.log('셸 준비 완료 → dist/ (index.html, assets/)');
