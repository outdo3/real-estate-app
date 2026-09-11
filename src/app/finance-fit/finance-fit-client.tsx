'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import { calculateFinanceFit } from '@/lib/finance-fit/calculate';
import { formatPercent, formatWon, formatWonPerMonth } from '@/lib/finance-fit/format';
import { BROKERAGE_RULE_VERSION } from '@/lib/finance-fit/types';
import { parseFinanceFitUrl } from '@/lib/finance-fit/url';
import { validateFinanceFitInputs, type FinanceFitValidationError } from '@/lib/finance-fit/validation';
import type { FinanceFitResult } from '@/lib/finance-fit/types';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { trackEvent } from '@/lib/analytics/trackEvent';
import PartnerCtaCard from '@/components/partner/PartnerCtaCard';
import styles from './finance-fit.module.css';

// 원 단위 텍스트 입력 — 숫자 이외 문자는 무시하고, 커서 위치를 건드리는 재포맷은
// 하지 않는다(FINANCE_FIT_V1_PHASE2A §29). 옆에 읽기 전용 "= N억 M천만원" 미리보기만
// 별도로 보여준다.
function onlyDigits(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

function fieldError(errors: FinanceFitValidationError[], field: FinanceFitValidationError['field']): string | null {
  return errors.find((e) => e.field === field)?.message ?? null;
}

export default function FinanceFitClient() {
  const searchParams = useSearchParams();
  const seed = useMemo(() => parseFinanceFitUrl(searchParams), [searchParams]);
  const startTracked = useRef(false);

  // §16 — 들어온 단지로 돌아가는 경로. identity(lawdCd/dong/aptSeq)를 그대로 유지해
  // 돌아간 화면이 같은 단지를 같은 방식으로 해석하게 한다. 이름만으로 되돌리지 않는다.
  // seed는 위에서 이미 searchParams로부터 memo된 객체다. 하위 필드를 optional chaining으로
  // 의존성에 나열하면 React Compiler lint가 수동 memo를 보존하지 못한다 — 객체 자체를 쓴다.
  const returnHref = useMemo(() => {
    if (!seed || !seed.name) return null;
    const qs = new URLSearchParams();
    if (seed.lawdCd) qs.set('lawdCd', seed.lawdCd);
    if (seed.dong) qs.set('dong', seed.dong);
    if (seed.aptSeq) qs.set('aptSeq', seed.aptSeq);
    const query = qs.toString();
    return `/apt/${encodeURIComponent(seed.name)}${query ? `?${query}` : ''}`;
  }, [seed]);

  const [purchasePriceInput, setPurchasePriceInput] = useState('');
  const [availableCashInput, setAvailableCashInput] = useState('');
  const [loanAmountInput, setLoanAmountInput] = useState('');
  const [interestRateInput, setInterestRateInput] = useState('3.5');
  const [loanYearsInput, setLoanYearsInput] = useState('30');

  const [result, setResult] = useState<FinanceFitResult | null>(null);
  const [errors, setErrors] = useState<FinanceFitValidationError[]>([]);

  useEffect(() => {
    if (seed?.refPriceWon != null) {
      setPurchasePriceInput(String(Math.round(seed.refPriceWon)));
    }
  }, [seed?.refPriceWon]);

  useEffect(() => {
    if (startTracked.current) return;
    startTracked.current = true;
    trackEvent('finance_fit_start', { aptName: seed?.name ?? undefined });
  }, [seed?.name]);

  const purchasePrice = Number(purchasePriceInput || '0');
  const availableCash = availableCashInput === '' ? null : Number(availableCashInput);
  const loanAmount = Number(loanAmountInput || '0');
  const interestRatePercent = Number(interestRateInput || '0');
  const loanYears = Number(loanYearsInput || '0');

  const handleCalculate = () => {
    const inputs = { purchasePrice, availableCash, loanAmount, interestRatePercent, loanYears };
    const validationErrors = validateFinanceFitInputs(inputs);
    setErrors(validationErrors);
    if (validationErrors.length > 0) {
      setResult(null);
      return;
    }
    setResult(calculateFinanceFit(inputs));
    trackEvent('finance_fit_calculate', { aptName: seed?.name ?? undefined });
  };

  return (
    <div className={styles.main}>
      <Header pageTitle="자금 계획 간편 계산기" />
      <div className="container">
        <div className={styles.intro}>
          이 계산기는 &quot;살 수 있다/없다&quot;를 판정하지 않습니다. 현재 입력 기준으로{' '}
          <strong>얼마의 자기자금이 필요하고 매달 얼마를 상환하게 되는지</strong> 보여드립니다.
        </div>

        {seed?.name && (
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>{seed.name}</h2>
            {seed.refPriceWon != null ? (
              <p className={styles.refPrice}>
                최근 실거래 기준 참고금액: <strong>{formatWon(seed.refPriceWon)}</strong>
                {seed.refTradeDate ? <span className={styles.refDate}> ({seed.refTradeDate} 거래)</span> : null}
              </p>
            ) : (
              <p className={styles.refPrice}>참고할 최근 실거래가 정보가 없습니다. 직접 입력해주세요.</p>
            )}
            {/* REAL_ESTATE_TOOLS_FINANCE_ACTION_LOOP_V1 §16 — 자금 계획은 막다른 길이
                아니다. 계산을 마친 사용자는 보통 그 단지로 돌아간다. 홈이 아니라
                **원래 보던 단지 상세로** 돌려보낸다(identity를 그대로 들고 간다). */}
            {returnHref && (
              <Link href={returnHref} className={styles.returnLink}>
                <ArrowLeft size={14} strokeWidth={2.2} aria-hidden="true" /> {seed.name} 단지로 돌아가기
              </Link>
            )}
          </div>
        )}

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>내 예상 매수가 · 준비자금</h2>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="ff-purchase-price">내 예상 매수가 (원)</label>
            <input
              id="ff-purchase-price"
              type="text"
              inputMode="numeric"
              className={styles.formInput}
              value={purchasePriceInput}
              onChange={(e) => setPurchasePriceInput(onlyDigits(e.target.value))}
              aria-describedby="ff-purchase-price-preview"
              aria-invalid={!!fieldError(errors, 'purchasePrice')}
            />
            <p id="ff-purchase-price-preview" className={styles.preview}>{purchasePrice > 0 ? formatWon(purchasePrice) : ' '}</p>
            {fieldError(errors, 'purchasePrice') && <p className={styles.errorText} role="alert">{fieldError(errors, 'purchasePrice')}</p>}
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="ff-available-cash">내 준비자금 (원, 선택)</label>
            <input
              id="ff-available-cash"
              type="text"
              inputMode="numeric"
              className={styles.formInput}
              value={availableCashInput}
              onChange={(e) => setAvailableCashInput(onlyDigits(e.target.value))}
              aria-describedby="ff-available-cash-preview"
              aria-invalid={!!fieldError(errors, 'availableCash')}
            />
            <p id="ff-available-cash-preview" className={styles.preview}>{availableCash != null && availableCash > 0 ? formatWon(availableCash) : ' '}</p>
            {fieldError(errors, 'availableCash') && <p className={styles.errorText} role="alert">{fieldError(errors, 'availableCash')}</p>}
          </div>
        </div>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>대출 가정</h2>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="ff-loan-amount">예상 대출액 (원)</label>
            <input
              id="ff-loan-amount"
              type="text"
              inputMode="numeric"
              className={styles.formInput}
              value={loanAmountInput}
              onChange={(e) => setLoanAmountInput(onlyDigits(e.target.value))}
              aria-describedby="ff-loan-amount-preview"
              aria-invalid={!!fieldError(errors, 'loanAmount')}
            />
            <p id="ff-loan-amount-preview" className={styles.preview}>{loanAmount > 0 ? formatWon(loanAmount) : ' '}</p>
            {fieldError(errors, 'loanAmount') && <p className={styles.errorText} role="alert">{fieldError(errors, 'loanAmount')}</p>}
          </div>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="ff-rate">금리 (연 %, 직접 입력)</label>
              <input
                id="ff-rate"
                type="text"
                inputMode="decimal"
                className={styles.formInput}
                value={interestRateInput}
                onChange={(e) => setInterestRateInput(e.target.value.replace(/[^0-9.]/g, ''))}
                aria-invalid={!!fieldError(errors, 'interestRatePercent')}
              />
              {fieldError(errors, 'interestRatePercent') && <p className={styles.errorText} role="alert">{fieldError(errors, 'interestRatePercent')}</p>}
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel} htmlFor="ff-years">대출 기간 (년)</label>
              <input
                id="ff-years"
                type="text"
                inputMode="numeric"
                className={styles.formInput}
                value={loanYearsInput}
                onChange={(e) => setLoanYearsInput(onlyDigits(e.target.value))}
                aria-invalid={!!fieldError(errors, 'loanYears')}
              />
              {fieldError(errors, 'loanYears') && <p className={styles.errorText} role="alert">{fieldError(errors, 'loanYears')}</p>}
            </div>
          </div>
          <p className={styles.methodNote}>상환방식: 원리금균등 (현재 지원하는 유일한 방식입니다)</p>
        </div>

        <button type="button" className={styles.calculateBtn} onClick={handleCalculate}>계산하기</button>

        {result && (
          <>
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>계산 결과</h2>
              <div className={styles.resultRow}>
                <span className={styles.resultLabel}>예상 필요 자기자금</span>
                <span className={styles.resultValue}>{formatWon(result.requiredCash.value)}</span>
              </div>
              <p className={styles.resultNote}>취득세 및 등기·법무 등 기타 부대비용은 별도입니다.</p>
              <div className={styles.resultRow}>
                <span className={styles.resultLabel}>월 예상 원리금</span>
                <span className={styles.resultValue}>{formatWonPerMonth(result.monthlyPayment.monthlyPayment)}</span>
              </div>
              <p className={styles.resultNote}>입력한 금리·기간을 기준으로 계산한 참고값입니다. 실제 금융기관 상환계획과 다를 수 있습니다.</p>
              <div className={styles.resultRow}>
                <span className={styles.resultLabel}>중개보수 법정 상한</span>
                <span className={styles.resultValue}>{formatWon(result.brokerage.amount)}</span>
              </div>
              <p className={styles.resultNote}>
                요율 {formatPercent(result.brokerage.rate * 100)}{result.brokerage.cap != null ? ` (상한 ${formatWon(result.brokerage.cap)})` : ''} 기준 법정 상한이며, 실제 금액은 상한 내에서 협의됩니다. 확정 금액이 아닙니다.
              </p>

              {result.cashGap && (
                <div className={styles.cashGapBox}>
                  {result.cashGap.direction === 'SHORT' ? (
                    <p>현재 입력 기준 약 {formatWon(result.cashGap.amount)}이 추가로 필요합니다.</p>
                  ) : (
                    <p>현재 입력 기준 약 {formatWon(result.cashGap.amount)}의 여유가 있습니다.</p>
                  )}
                </div>
              )}
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>금리 변화 시나리오</h2>
              <div className={styles.stressRow}>
                <span>기준 ({formatPercent(result.stressTest.base.ratePercent)})</span>
                <strong>{formatWonPerMonth(result.stressTest.base.monthlyPayment)}</strong>
              </div>
              <div className={styles.stressRow}>
                <span>+1%p ({formatPercent(result.stressTest.plus1.ratePercent)})</span>
                <strong>
                  {formatWonPerMonth(result.stressTest.plus1.monthlyPayment)}
                  <span className={styles.stressDelta}> (월 +{formatWon(result.stressTest.plus1.monthlyPayment - result.stressTest.base.monthlyPayment)})</span>
                </strong>
              </div>
              <div className={styles.stressRow}>
                <span>+2%p ({formatPercent(result.stressTest.plus2.ratePercent)})</span>
                <strong>
                  {formatWonPerMonth(result.stressTest.plus2.monthlyPayment)}
                  <span className={styles.stressDelta}> (월 +{formatWon(result.stressTest.plus2.monthlyPayment - result.stressTest.base.monthlyPayment)})</span>
                </strong>
              </div>
            </div>

            <div className={styles.card}>
              <h2 className={styles.cardTitle}>계산에 사용된 조건</h2>
              <ul className={styles.assumptionList}>
                <li>예상 매수가: {formatWon(result.purchasePrice.value)}</li>
                <li>예상 대출액: {formatWon(result.loanAmount.value)}</li>
                <li>금리: {formatPercent(result.monthlyPayment.ratePercent)}</li>
                <li>대출 기간: {loanYears}년</li>
                <li>상환방식: 원리금균등</li>
                <li>중개보수 기준: {BROKERAGE_RULE_VERSION.source} (확인일 {BROKERAGE_RULE_VERSION.referenceDate})</li>
              </ul>
            </div>
          </>
        )}

        <div className={styles.exclusionsPanel} role="note" aria-label="이번 계산에 포함되지 않는 항목 안내">
          <h2 className={styles.exclusionsTitle}>이번 계산에 포함되지 않음</h2>
          <ul>
            <li>취득세</li>
            <li>등기·법무 비용</li>
            <li>인지세·채권매입 등 기타 비용</li>
            <li>실제 금융기관 대출 심사</li>
            <li>DSR·LTV 규제 판단</li>
          </ul>
        </div>

        {/* PARTNER_LEAD_TRACKING_V1 §7 — 바로 위 패널이 "등기·법무 비용은 이 계산에
            포함되지 않는다"고 알린 직후다. 사용자가 방금 생긴 질문을 들고 있는 자리라
            이 STEP에서 문맥이 가장 강하다. 계산 결과 카드 **안**이 아니라 바깥에 두어
            객관적 계산값과 광고가 섞이지 않게 한다. */}
        <PartnerCtaCard placement="finance" />
      </div>
    </div>
  );
}
