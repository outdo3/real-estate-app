// REPORT-2 §1 — 스코프 밖 요청에 대한 안전한 화면.
//
// 27110(대구 중구)/11680(서울 강남구) 같은 코드는 **부산 리포트를 만들어서는 안 된다.**
// 조용히 빈 리포트를 보여주면 "부산에 거래가 없다"로 읽히므로, 무엇이 잘못됐는지
// 분명히 말하고 데이터를 지어내지 않는다.

import Link from 'next/link';
import styles from './RegionReportSheet.module.css';

export default function InvalidScope({ reason }: { reason: string }) {
  return (
    <div className={styles.page}>
      <article className={styles.sheet}>
        <div className={styles.invalid}>
          <div className={styles.invalidTitle}>리포트를 만들 수 없는 지역입니다</div>
          <p className={styles.invalidBody}>{reason}</p>
          <p className={styles.invalidBody}>
            이집 지역 리포트는 현재 <strong>부산광역시 16개 자치구·군</strong>만 지원합니다.
          </p>
          <Link href="/report/city/busan" className={styles.invalidLink}>
            부산광역시 브리핑 보기 →
          </Link>
        </div>
      </article>
    </div>
  );
}
