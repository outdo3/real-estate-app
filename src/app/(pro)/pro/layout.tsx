// REALTOR_PRO_MVP_V1 — 중개사 Pro 셸(서버 컴포넌트). 기능 스위치가 꺼져 있으면 "준비 중"만 보인다(notFound 아님).
// 색인·리퍼러 차단: Pro 화면은 검색 노출 대상이 아니며, 외부 링크로 이동할 때 경로를 넘기지 않는다.

import Link from 'next/link';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import Header from '@/components/Header';
import ProTabs from '@/components/pro/ProTabs';
import { getProMode } from '@/lib/pro/runtime';
import styles from '@/components/pro/ProShell.module.css';

export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
  title: '이집 중개사 Pro',
};

// 스위치(env)는 요청 시점에 읽는다 — 빌드 시점 값으로 굳지 않게.
export const dynamic = 'force-dynamic';

export default function ProLayout({ children }: { children: React.ReactNode }) {
  const mode = getProMode();

  return (
    <div className={styles.shell}>
      <Header pageTitle="중개사 Pro" />
      <div className={styles.inner}>
        <div className={styles.topBar}>
          <p className={styles.brand}>
            이집 중개사 <span className={styles.proMark}>Pro</span>
          </p>
          <Link href="/" className={styles.back}>
            <ArrowLeft size={16} aria-hidden="true" />
            이집으로 돌아가기
          </Link>
        </div>
        {mode === 'OFF' ? (
          <div className={styles.off}>
            <p className={styles.offTitle}>준비 중인 기능입니다</p>
            <p>중개사 Pro는 아직 공개되지 않았습니다.</p>
          </div>
        ) : (
          <>
            {mode === 'DEMO' ? (
              <p className={styles.demo} role="status">
                <FlaskConical size={16} aria-hidden="true" />
                로컬 데모 모드 — 합성 데이터, 저장되지 않음
              </p>
            ) : null}
            <ProTabs />
            <div>{children}</div>
          </>
        )}
      </div>
    </div>
  );
}
