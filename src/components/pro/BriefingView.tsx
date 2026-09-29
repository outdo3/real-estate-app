// REALTOR_PRO_MVP_V1 — 고객 브리핑 렌더러(서버·클라이언트 공용, 훅 없음). 저장된 스냅샷 값만 그린다.
// 스냅샷에는 소유자·호수·비공개 메모·고객 예산 원문이 들어 있지 않다(briefing.ts 가드). 평형 환산 없음.

import { Building2, Check, CircleHelp, Phone, TriangleAlert } from 'lucide-react';
import { DEAL_TYPE_LABELS, FLOOR_BAND_LABELS, type DealType, type FloorBand } from '@/lib/pro/rules';
import type { BriefingSnapshot } from '@/lib/pro/types';
import type { Wire } from './api';
import styles from './BriefingView.module.css';

type Snap = BriefingSnapshot | Wire<BriefingSnapshot>;

function manwon(v: number | null): string {
  if (v == null) return '-';
  const eok = Math.floor(v / 10000);
  const rest = v % 10000;
  if (eok > 0 && rest > 0) return `${eok.toLocaleString('ko-KR')}억 ${rest.toLocaleString('ko-KR')}만원`;
  if (eok > 0) return `${eok.toLocaleString('ko-KR')}억원`;
  return `${rest.toLocaleString('ko-KR')}만원`;
}

function m2(v: number | null): string {
  if (v == null) return '-';
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}㎡`;
}

function ymd(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+09:00` : iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });
}

function priceLine(l: NonNullable<Snap['listing']>): string {
  if (l.dealType === 'SALE') return manwon(l.askingPriceManwon);
  if (l.dealType === 'JEONSE') return manwon(l.depositManwon);
  return `${manwon(l.depositManwon)} / 월 ${manwon(l.monthlyRentManwon)}`;
}

export default function BriefingView({ snapshot }: { snapshot: Snap }) {
  const { apartment, listing, publicData, fit, realtor } = snapshot;
  const dataAsOf = typeof snapshot.dataAsOf === 'string' ? snapshot.dataAsOf : String(snapshot.dataAsOf);
  const phoneHref = realtor.officePhone ? `tel:${realtor.officePhone.replace(/[^\d+]/g, '')}` : null;

  return (
    <article className={styles.wrap}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>{snapshot.customerLabel}께 드리는 매물 브리핑</p>
        <h1 className={styles.title}>{apartment?.name ?? '매물 정보'}</h1>
        {apartment ? (
          <p className={styles.sub}>
            {[apartment.umdName, apartment.buildYear ? `${apartment.buildYear}년 준공` : null, apartment.totalHouseholds ? `${apartment.totalHouseholds.toLocaleString('ko-KR')}세대` : null]
              .filter(Boolean)
              .join(' · ') || '단지 기본 정보 없음'}
          </p>
        ) : null}
      </header>

      {listing ? (
        <section className={styles.card} aria-labelledby="bv-listing">
          <h2 id="bv-listing" className={styles.h2}>
            <Building2 size={18} aria-hidden="true" />
            매물 정보
          </h2>
          <p className={styles.price}>
            <span className={styles.dealType}>{DEAL_TYPE_LABELS[listing.dealType as DealType] ?? listing.dealType}</span>
            {priceLine(listing)}
          </p>
          <dl className={styles.kv}>
            <dt>전용면적</dt>
            <dd>{m2(listing.exclusiveAreaM2)}</dd>
            <dt>층</dt>
            <dd>{listing.floorBand ? FLOOR_BAND_LABELS[listing.floorBand as FloorBand] : '-'}</dd>
            <dt>입주 가능</dt>
            <dd>
              {listing.moveInAvailableAt ? ymd(listing.moveInAvailableAt) : '-'}
              {listing.moveInNegotiable ? ' (협의 가능)' : ''}
            </dd>
          </dl>
        </section>
      ) : null}

      <section className={styles.card} aria-labelledby="bv-public">
        <h2 id="bv-public" className={styles.h2}>
          공공 실거래
        </h2>
        <p className={styles.note}>{publicData.note}</p>
        {publicData.state === 'OK' && publicData.recentTrades.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">계약일</th>
                  <th scope="col">전용</th>
                  <th scope="col">층</th>
                  <th scope="col">거래가</th>
                </tr>
              </thead>
              <tbody>
                {publicData.recentTrades.map((t, i) => (
                  <tr key={`${t.dealDate}-${i}`}>
                    <td>{t.dealDate}</td>
                    <td>{m2(t.exclusiveAreaM2)}</td>
                    <td>{t.floor != null ? `${t.floor}층` : '-'}</td>
                    <td>{manwon(t.priceManwon)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {fit ? (
        <section className={styles.card} aria-labelledby="bv-fit">
          <h2 id="bv-fit" className={styles.h2}>
            요청하신 조건과 비교
          </h2>
          <p className={styles.fitScore}>
            {fit.score != null && fit.confidence === 'SUFFICIENT' ? `조건 일치도 ${Math.round(fit.score)}%` : '정보 부족 — 중개사와 확인이 필요합니다'}
          </p>
          <p className={styles.small}>일치도는 요청하신 조건과 이 매물의 비교 결과이며, 단지 평가 점수가 아닙니다.</p>
          {fit.matched.length ? (
            <ul className={styles.reasons}>
              {fit.matched.map((t, i) => (
                <li key={`m-${i}`}>
                  <Check size={16} color="var(--primary-color)" aria-hidden="true" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {fit.differences.length ? (
            <>
              <h3 className={styles.h3}>차이가 있는 점</h3>
              <ul className={styles.reasons}>
                {fit.differences.map((t, i) => (
                  <li key={`d-${i}`}>
                    <TriangleAlert size={16} color="var(--warning-color)" aria-hidden="true" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {fit.unknown.length ? (
            <>
              <h3 className={styles.h3}>확인이 필요한 점</h3>
              <ul className={styles.reasons}>
                {fit.unknown.map((t, i) => (
                  <li key={`u-${i}`}>
                    <CircleHelp size={16} color="var(--text-secondary)" aria-hidden="true" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      <section className={styles.card} aria-labelledby="bv-realtor">
        <h2 id="bv-realtor" className={styles.h2}>
          담당 중개사
        </h2>
        <p className={styles.realtorName}>{realtor.displayName}</p>
        {realtor.officeName ? <p className={styles.sub}>{realtor.officeName}</p> : null}
        {phoneHref ? (
          <a href={phoneHref} className={styles.call}>
            <Phone size={18} aria-hidden="true" />
            {realtor.officePhone}
          </a>
        ) : null}
      </section>

      <footer className={styles.footer}>
        <p>{snapshot.disclaimer}</p>
        <p>데이터 기준일: {ymd(dataAsOf)}</p>
      </footer>
    </article>
  );
}
