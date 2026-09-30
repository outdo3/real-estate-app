// REALTOR_PRO_MVP_V1 — 고객용 공개 브리핑(로그인 불필요, 서버 컴포넌트). /pro 셸 밖에서 렌더된다.
// · 기능 스위치가 꺼져 있거나 토큰이 없으면 404.
// · 만료·회수·중개사 정지면 내용과 중개사 정보를 전혀 보이지 않는다.
// · 색인 금지, 리퍼러 전송 금지, 광고·분석 스크립트 없음(토큰이 담긴 URL이 외부로 새지 않게).

import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { BRIEFING_PAGE_METADATA, isHumanBriefingView } from '@/lib/pro/briefing-page-policy';
import { Clock, Database } from 'lucide-react';
import BriefingView from '@/components/pro/BriefingView';
import { viewBriefingByToken } from '@/lib/pro/briefing-service';
import { ProStoreUnavailableError } from '@/lib/pro/repo';
import { getProDeps, getProMode } from '@/lib/pro/runtime';
import type { BriefingSnapshot } from '@/lib/pro/types';
import styles from './page.module.css';

// 메타데이터·열람 집계 정책은 briefing-page-policy.ts(테스트 대상). 서드파티 스크립트 경계는 src/lib/privacy/private-routes.ts
// (광고·GA·자체 방문 로그·위치 조회 모두 이 경로에서 꺼짐) + next.config.ts의 /b/* CSP·Referrer-Policy·X-Robots-Tag.
export const metadata: Metadata = BRIEFING_PAGE_METADATA;

export const dynamic = 'force-dynamic';

function Unavailable({ title, text, icon }: { title: string; text?: string; icon: 'clock' | 'db' }) {
  return (
    <main className={styles.page}>
      <div className={styles.state}>
        {icon === 'clock' ? <Clock size={28} aria-hidden="true" /> : <Database size={28} aria-hidden="true" />}
        <p className={styles.title}>{title}</p>
        {text ? <p className={styles.text}>{text}</p> : null}
      </div>
    </main>
  );
}

export default async function PublicBriefingPage({ params }: { params: Promise<{ token: string }> }) {
  const mode = getProMode();
  if (mode === 'OFF') notFound();
  const { token } = await params;

  let result: { access: 'OK' | 'NOT_FOUND' | 'EXPIRED' | 'REVOKED' | 'UNAVAILABLE'; snapshot: BriefingSnapshot | null };
  try {
    const deps = await getProDeps(mode);
    result = await viewBriefingByToken(deps, token, { countView: isHumanBriefingView(await headers()) });
  } catch (e) {
    if (e instanceof ProStoreUnavailableError) {
      return <Unavailable icon="db" title="지금은 브리핑을 볼 수 없습니다" text="잠시 후 다시 열어 주세요." />;
    }
    throw e;
  }

  if (result.access === 'NOT_FOUND') notFound();
  if (result.access !== 'OK' || !result.snapshot) {
    return <Unavailable icon="clock" title="만료되었거나 더 이상 볼 수 없는 브리핑입니다" text="필요하면 안내받은 중개사에게 새 링크를 요청해 주세요." />;
  }

  return (
    <main className={styles.page}>
      <BriefingView snapshot={result.snapshot} />
      <p className={styles.brand}>이집 중개사 Pro 브리핑</p>
    </main>
  );
}
