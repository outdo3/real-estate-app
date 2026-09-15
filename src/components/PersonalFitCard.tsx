'use client';

// PERSONALIZED_SCORE_V1 P2-C — 상세페이지 "나에게 맞는 점수" 카드(공통 이집점수 카드 바로 아래, 별도 카드).
//
// 계산은 P2-B 엔진(src/lib/personalized-score.ts)을 거친 화면 모델(derivePersonalFitCard)을 그대로 렌더한다.
// 이 컴포넌트는 점수·잘 맞는 점/아쉬운 점을 다시 판정하지 않는다. 공통 점수 응답(_shadowV2)은 읽기만 한다.
// 중요도 값은 화면 표시와 계산에만 쓰고 analytics·URL·로그로 보내지 않는다.
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import LoginModal from './LoginModal';
import { useFitPreference } from '@/hooks/useFitPreference';
import { FIT_SETTINGS_HREF, PERSONAL_FIT_COPY as COPY, derivePersonalFitCard } from '@/lib/personal-fit-ui';
import { trackPersonalFit } from '@/lib/analytics/track-personal-fit';
import { cardViewAction, shouldLogImpression } from '@/lib/analytics/personal-fit-events';
import styles from './PersonalFitCard.module.css';

interface Props {
  /** 공통 점수 응답의 `_shadowV2`(없으면 undefined). */
  shadowV2: unknown;
  /** 공통 점수 응답을 기다리는 중인가. */
  scoreLoading: boolean;
}

function Header({ badge, limited }: { badge?: string; limited?: boolean }) {
  return (
    <div className={styles.headerRow}>
      <span className={styles.title}>{COPY.title}</span>
      {badge && <span className={`${styles.badge} ${limited ? styles.badgeLimited : ''}`}>{badge}</span>}
    </div>
  );
}

export default function PersonalFitCard({ shadowV2, scoreLoading }: Props) {
  const { state } = useFitPreference();
  const [loginOpen, setLoginOpen] = useState(false);
  const model = derivePersonalFitCard({ scoreLoading, shadowV2, preference: state });

  // P2-F — 결과 상태(FULL/LIMITED/UNAVAILABLE)로 그려졌을 때 같은 점수 응답당 한 번만. 로딩·안내 상태는 보내지 않는다.
  // 상태 enum만 보낸다(점수·중요도·coverage·단지 식별자 없음). 실패해도 화면에 영향 없음(fire-and-forget).
  const viewAction = cardViewAction(model);
  const lastViewKeys = useRef<unknown[] | null>(null);
  useEffect(() => {
    if (viewAction === null || !shouldLogImpression(lastViewKeys.current, [shadowV2], viewAction)) return;
    lastViewKeys.current = [shadowV2];
    trackPersonalFit('personal_fit_card_view', viewAction);
  }, [shadowV2, viewAction]);

  if (model.kind === 'HIDDEN') return null;

  if (model.kind === 'PLACEHOLDER') {
    return <div className={`${styles.card} ${styles.placeholder}`} aria-hidden="true" data-personal-fit="placeholder" />;
  }

  if (model.kind === 'LOGGED_OUT') {
    return (
      <section className={`${styles.card} ${styles.compact}`} aria-label={COPY.title} data-personal-fit="logged-out">
        <div className={styles.compactText}>
          <Header />
          <p className={styles.message}>{COPY.loggedOut}</p>
        </div>
        <button
          type="button"
          className={styles.ctaButton}
          onClick={() => {
            trackPersonalFit('personal_fit_login_cta_click', 'DETAIL');
            setLoginOpen(true);
          }}
        >
          {COPY.loggedOutCta}
        </button>
        {/* 기존 로그인 모달 — 콜백은 현재 상세 URL(모달 기본값) */}
        <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
      </section>
    );
  }

  if (model.kind === 'NO_SETTINGS') {
    return (
      <section className={`${styles.card} ${styles.compact}`} aria-label={COPY.title} data-personal-fit="no-settings">
        <div className={styles.compactText}>
          <Header />
          <p className={styles.message}>{COPY.noSettings}</p>
        </div>
        <Link href={FIT_SETTINGS_HREF} className={styles.ctaButton} onClick={() => trackPersonalFit('personal_fit_settings_cta_click', 'DETAIL')}>
          {COPY.noSettingsCta}
        </Link>
      </section>
    );
  }

  if (model.kind === 'UNAVAILABLE' || model.kind === 'ERROR') {
    return (
      <section className={`${styles.card} ${styles.compact}`} aria-label={COPY.title} data-personal-fit={model.kind === 'ERROR' ? 'error' : 'unavailable'}>
        <div className={styles.compactText}>
          <Header />
          <p className={styles.message}>{model.kind === 'ERROR' ? COPY.loadError : COPY.unavailable}</p>
        </div>
      </section>
    );
  }

  const limited = model.status === 'LIMITED';
  return (
    <section className={styles.card} aria-label={COPY.title} data-personal-fit={limited ? 'limited' : 'full'}>
      <div className={styles.topRow}>
        <Header badge={limited ? COPY.badgeLimited : COPY.badgeFull} limited={limited} />
        <Link href={FIT_SETTINGS_HREF} className={styles.editLink}>
          {COPY.editLink}
        </Link>
      </div>
      <p className={styles.subtitle}>{COPY.subtitle}</p>

      <div className={styles.scoreRow}>
        <span className={styles.scoreNumber}>{model.score}</span>
        <span className={styles.scoreUnit}>점</span>
      </div>

      {limited ? (
        <p className={styles.limitedNote}>
          {COPY.limitedNote} <span className={styles.excludedInline}>{COPY.excludedTitle}: {model.excludedTexts.join(', ')}</span>
        </p>
      ) : (
        model.excludedTexts.length > 0 && (
          <p className={styles.excludedNote}>
            {COPY.excludedTitle}: {model.excludedTexts.join(', ')}
          </p>
        )
      )}

      <ul className={styles.axisList}>
        {model.rows.map((row) => (
          <li key={row.axis} className={`${styles.axisRow} ${row.displayScore == null ? styles.axisExcluded : ''}`}>
            <span className={styles.axisLabel}>{row.label}</span>
            <span className={styles.axisImportance}>중요도 {row.importance}</span>
            {row.displayScore != null ? (
              <span className={styles.axisScore}>{row.displayScore}점</span>
            ) : (
              // 제외 사유는 위 안내 문구에 모아 보여주고, 행에는 0점처럼 보이지 않도록 "반영 제외"만 쓴다.
              <span className={styles.axisExcludedText} title={row.excludedText ?? undefined}>
                {COPY.excludedTitle}
              </span>
            )}
          </li>
        ))}
      </ul>

      {(model.goodFit.length > 0 || model.weakFit.length > 0) && (
        <div className={styles.fitSection}>
          {model.goodFit.length > 0 && (
            <div className={styles.fitGroup}>
              <div className={styles.fitTitle}>{COPY.goodTitle}</div>
              <ul className={styles.fitList}>
                {model.goodFit.map((g) => (
                  <li key={g.axis}>{g.text}</li>
                ))}
              </ul>
            </div>
          )}
          {model.weakFit.length > 0 && (
            <div className={styles.fitGroup}>
              <div className={styles.fitTitle}>{COPY.weakTitle}</div>
              <ul className={styles.fitList}>
                {model.weakFit.map((w) => (
                  <li key={w.axis}>{w.text}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className={styles.disclaimer}>{COPY.disclaimer}</p>
    </section>
  );
}
