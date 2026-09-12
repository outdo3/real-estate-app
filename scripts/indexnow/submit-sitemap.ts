/**
 * INDEXNOW_V1 §4 — 사이트맵 일괄 제출(초기 1회용).
 *
 *   npm run indexnow:submit-sitemap
 *   npx tsx -r dotenv/config scripts/indexnow/submit-sitemap.ts
 *   npx tsx -r dotenv/config scripts/indexnow/submit-sitemap.ts --dry-run
 *
 * 프로덕션 sitemap.xml을 그대로 읽어 그 URL만 제출한다. 색인 범위를 여기서 다시
 * 정의하지 않는다 — 사이트맵이 곧 색인 대상이고, 두 곳에서 정하면 갈라진다.
 *
 * **반복 실행용 cron을 만들지 않는다(§5).** IndexNow는 바뀐 것을 알리는 통지이지
 * 전체 목록을 주기적으로 재전송하는 채널이 아니다. 이 스크립트는 도메인 전환 직후처럼
 * "한 번 전체를 알려야 하는" 상황을 위한 것이다.
 */
import { siteConfig } from '../../src/config/site';
import { submitIndexNow, filterSubmittableUrls } from '../../src/lib/indexnow/submit';
import { indexNowHost, isIndexNowConfigured } from '../../src/lib/indexnow/config';
import { parseSitemapUrls, findOutOfScopeRegionUrls, LAUNCH_SIDO } from '../../src/lib/indexnow/sitemap-urls';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const host = indexNowHost();
  if (!host) {
    console.error('공개 https 오리진이 없습니다. NEXT_PUBLIC_SITE_URL을 확인하세요.');
    process.exit(1);
  }
  if (!DRY_RUN && !isIndexNowConfigured()) {
    console.error('INDEXNOW_KEY가 없거나 형식이 올바르지 않습니다. 먼저 키를 설정하세요.');
    process.exit(1);
  }

  const sitemapUrl = `${siteConfig.url}/sitemap.xml`;
  console.log(`사이트맵 읽는 중: ${sitemapUrl}`);

  const res = await fetch(sitemapUrl, { headers: { Accept: 'application/xml' } });
  if (!res.ok) {
    console.error(`사이트맵을 가져오지 못했습니다: HTTP ${res.status}`);
    process.exit(1);
  }
  const xml = await res.text();

  const urls = parseSitemapUrls(xml);
  console.log(`사이트맵 URL: ${urls.length}개`);

  // §4 — 출시 범위 밖 지역이 섞여 있으면 **제출하지 않고 멈춘다.** 조용히 걸러내면
  // 사이트맵 정책이 바뀐 사실을 아무도 모른 채 통지만 나간다.
  const outOfScope = findOutOfScopeRegionUrls(urls);
  if (outOfScope.length > 0) {
    console.error(`출시 범위(${LAUNCH_SIDO}) 밖 지역 URL이 ${outOfScope.length}개 있습니다. 제출을 중단합니다.`);
    for (const u of outOfScope.slice(0, 10)) console.error(`  ${u}`);
    console.error('전국 확장은 해당 지역이 데이터 신뢰 기준을 통과하고 사이트맵에 들어간 뒤에 엽니다.');
    process.exit(1);
  }

  const { accepted, rejected } = filterSubmittableUrls(urls, host);
  console.log(`제출 대상: ${accepted.length}개 (거부 ${rejected.length}개)`);
  for (const r of rejected.slice(0, 10)) console.log(`  거부: ${r}`);

  if (DRY_RUN) {
    console.log('\n--dry-run — 실제로 제출하지 않았습니다.');
    for (const u of accepted.slice(0, 20)) console.log(`  ${u}`);
    if (accepted.length > 20) console.log(`  ... 외 ${accepted.length - 20}개`);
    return;
  }

  const result = await submitIndexNow(accepted);
  console.log('\n결과:', JSON.stringify({ ...result, rejected: result.rejected?.length ?? 0 }, null, 2));

  if (result.status === 'SUBMITTED') {
    // §6 — 여기서 "색인 완료"라고 말하지 않는다. 우리가 아는 것은 통지가 받아들여졌다는
    // 사실까지이고, 크롤링/색인 여부는 검색엔진의 별도 판단이다.
    console.log(`\n통지 완료: ${result.submitted}개 URL, HTTP ${result.httpStatuses.join(', ')}`);
    console.log('색인되었다는 뜻이 아닙니다 — 검색엔진에 변경 사실을 알린 것입니다.');
  } else {
    console.log('\n제출하지 못했습니다. 위 결과를 확인하세요.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('예기치 못한 오류:', e instanceof Error ? e.message : e);
  process.exit(1);
});
