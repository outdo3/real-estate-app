/**
 * INDEXNOW_V1 §2 — 키 파일 생성.
 *
 *   npx tsx -r dotenv/config scripts/indexnow/write-key-file.ts
 *
 * INDEXNOW_KEY를 읽어 `public/<key>.txt`를 만든다. 파일 내용은 키 한 줄뿐이다.
 *
 * 왜 스크립트로 만드나: 파일 **이름**과 제출 페이로드의 **값**이 같은 키여야 하는데,
 * 사람이 두 곳에 따로 적으면 언젠가 갈라진다. 출처는 환경변수 하나이고 파일은 거기서
 * 파생된다.
 *
 * 만들어진 파일은 **커밋해야 한다.** Vercel이 public/을 정적으로 서빙하므로, 커밋되지
 * 않으면 프로덕션에서 404가 되고 IndexNow가 키를 확인하지 못한다.
 *
 * 키는 공개값이라 파일에 그대로 들어가지만, 콘솔에는 굳이 찍지 않는다(§7).
 */
import { writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_DIR = join(process.cwd(), 'public');
const KEY_FILE_RE = /^[A-Za-z0-9-]{8,128}\.txt$/;

function main() {
  const key = (process.env.INDEXNOW_KEY ?? '').trim();

  if (!key) {
    console.error('INDEXNOW_KEY가 설정되지 않았습니다. .env.local 또는 실행 환경에 넣어주세요.');
    process.exit(1);
  }
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) {
    console.error('INDEXNOW_KEY 형식이 올바르지 않습니다(영숫자·하이픈 8~128자).');
    process.exit(1);
  }

  // 키를 교체한 경우 옛 키 파일이 남아 있으면 어느 쪽이 현행인지 알 수 없다. 루트의
  // 키 파일 형태만 정리한다 — brand/ 등 다른 정적 자산은 건드리지 않는다.
  for (const entry of readdirSync(PUBLIC_DIR, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!KEY_FILE_RE.test(entry.name)) continue;
    if (entry.name === `${key}.txt`) continue;
    unlinkSync(join(PUBLIC_DIR, entry.name));
    console.log(`이전 키 파일 제거: public/${entry.name}`);
  }

  const target = join(PUBLIC_DIR, `${key}.txt`);
  // 내용은 키 한 줄. HTML도 BOM도 붙이지 않는다 — text/plain이어야 한다.
  writeFileSync(target, `${key}\n`, 'utf8');

  console.log(`키 파일을 만들었습니다: public/${key}.txt`);
  console.log('이 파일을 커밋해야 프로덕션에서 200으로 열립니다.');
}

main();
