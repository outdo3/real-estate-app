import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, MapPin, CalendarDays, Building2, GitCompareArrows } from 'lucide-react';
import Header from '@/components/Header';
import BottomNav from '@/components/ui/BottomNav';
import { siteConfig, buildOpenGraph } from '@/config/site';
import { BUSAN_DISTRICTS } from '@/lib/report/region-scope';
import { cityReportHref, dailyReportHref, districtReportHref, REPORT_LABELS } from '@/lib/report/report-links';
import { todayKst } from '@/lib/report/daily-observation';
import styles from './hub.module.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const title = `한장 리포트 - ${siteConfig.name}`;
  const description = '부산 부동산을 한 장으로 정리한 브리핑과 단지 리포트를 확인하세요.';
  return { title, description, openGraph: buildOpenGraph({ title, description }) };
}

/**
 * REPORT-7 §8 — 리포트 허브.
 *
 * 무거운 대시보드가 아니다. 지금까지 "자연스러운 진입 화면이 없던" 두 가지
 * (부산 전체 브리핑 / 일별 새로 확인된 실거래)에 집을 주고, 나머지는 어디서
 * 들어가는지만 알려준다.
 *
 * 지역 목록은 `BUSAN_DISTRICTS`(검증된 16개 코드)에서 그대로 나온다 — 이름으로
 * 지역을 지어내지 않는다(§4).
 */
export default function ReportHubPage() {
  // §6 — 일별 리포트의 날짜는 **KST 관찰일**이다. 단일 helper를 그대로 쓴다.
  const today = todayKst();
  const dailyHref = dailyReportHref(today);

  return (
    <div className={styles.page}>
      <Header />
      <main className="container">
        <header className={styles.intro}>
          <h1 className={styles.title}>한장 리포트</h1>
          <p className={styles.sub}>
            부산 실거래를 한 장으로 정리했습니다. 저장하거나 공유할 수 있어요.
          </p>
        </header>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>바로 보기</h2>
          <Link href={cityReportHref()} className={styles.primaryCard}>
            <FileText size={18} aria-hidden="true" />
            <span className={styles.cardMain}>
              <span className={styles.cardTitle}>{REPORT_LABELS.city}</span>
              <span className={styles.cardDesc}>부산 전체 실거래 흐름 한 장</span>
            </span>
          </Link>
          {dailyHref && (
            <Link href={dailyHref} className={styles.primaryCard}>
              <CalendarDays size={18} aria-hidden="true" />
              <span className={styles.cardMain}>
                <span className={styles.cardTitle}>{REPORT_LABELS.daily}</span>
                {/* §6 — "오늘 계약된 거래"로 읽히지 않게 부제에서 못박는다. */}
                <span className={styles.cardDesc}>
                  이집이 오늘 새로 확인한 거래입니다 · 계약일은 각 거래에 따로 표시됩니다
                </span>
              </span>
            </Link>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>지역 브리핑</h2>
          <div className={styles.districtGrid}>
            {BUSAN_DISTRICTS.map((d) => {
              const href = districtReportHref(d.lawdCd);
              if (!href) return null;
              return (
                <Link key={d.lawdCd} href={href} className={styles.districtChip}>
                  <MapPin size={13} aria-hidden="true" />
                  {d.name}
                </Link>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>단지·비교 리포트는 이렇게 열어요</h2>
          {/* 단지/비교 리포트는 canonical aptSeq가 필요하다. 허브에서 이름으로
              단지를 고르게 하면 이름 기반 식별이 되므로, 진입 화면으로 안내만 한다. */}
          <Link href="/map" className={styles.guideCard}>
            <Building2 size={18} aria-hidden="true" />
            <span className={styles.cardMain}>
              <span className={styles.cardTitle}>단지 한장 리포트</span>
              <span className={styles.cardDesc}>지도나 검색에서 단지를 고른 뒤 상세 화면에서 열 수 있어요</span>
            </span>
          </Link>
          <Link href="/stats/compare" className={styles.guideCard}>
            <GitCompareArrows size={18} aria-hidden="true" />
            <span className={styles.cardMain}>
              <span className={styles.cardTitle}>비교 리포트</span>
              <span className={styles.cardDesc}>단지 두 곳을 비교에 담으면 비교 리포트를 열 수 있어요</span>
            </span>
          </Link>
        </section>

        <p className={styles.note}>
          국토교통부 실거래가 기준 · 취소 거래 제외 · 부산 16개 자치구·군
        </p>
      </main>
      <BottomNav />
    </div>
  );
}
