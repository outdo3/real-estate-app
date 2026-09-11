'use client';

/**
 * REAL_ESTATE_TOOLS_FINANCE_ACTION_LOOP_V1 §3/§17 — 부동산도구 출시 IA.
 *
 * ── 이 페이지가 바꾼 가장 중요한 것 ────────────────────────────────────────
 * 예전 이 페이지에는 작성자가 주석으로 **"간단한 모의 로직"이라고 직접 적어둔**
 * 계산기 두 개가 실제 결과처럼 표시되고 있었다:
 *
 *   취득세    = 가격 × (1주택 3.3% / 2주택 8% / 3주택 12%)   ← 구간 누진 무시
 *   대출여력  = 연소득 × 8                                   ← 근거 없는 배수
 *
 * 둘 다 제거했다. 취득세는 구간 누진을 반영한 좁고 정확한 계산으로 대체했고,
 * 대출여력은 LTV·DSR **산수**로 대체했다(한도 판정은 하지 않는다).
 *
 * 남은 원칙: 완성되지 않은 도구는 노출하지 않거나 "준비중"으로만 둔다.
 * 눌리는데 아무 일도 일어나지 않는 버튼을 만들지 않는다(§18).
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Calculator, Landmark, Receipt, FileSignature, Scale, FileText,
  TrendingUp, Ruler, ShieldCheck, Gavel, ClipboardList, ArrowRight,
} from 'lucide-react';
import Header from '@/components/Header';
import Empty from '@/components/ui/Empty';
import PartnerCtaCard from '@/components/partner/PartnerCtaCard';
import { formatWon } from '@/lib/finance-fit/format';
import { calculateMonthlyPayment } from '@/lib/finance-fit/amortization';
import {
  calculateAcquisitionTax, ACQUISITION_TAX_RULE_VERSION, UNSUPPORTED_MESSAGE,
} from '@/lib/finance-tools/acquisition-tax';
import { REGISTRATION_COST_ITEMS } from '@/lib/finance-tools/registration-cost';
import { loanAmountAtLtv, calculateDsr, calculateGap, pricePerPyeong } from '@/lib/finance-tools/ratios';
import { cityReportHref } from '@/lib/report/report-links';
import styles from './tools.module.css';

const TABS = [
  { id: 'home', name: '내 집 마련', Icon: Landmark },
  { id: 'invest', name: '투자 계산', Icon: TrendingUp },
  { id: 'report', name: '비교·리포트', Icon: FileText },
  { id: 'safety', name: '안전계약', Icon: ShieldCheck },
] as const;

/** 만원 단위 입력 → 원. 콤마·공백을 허용한다(§22/§23). */
function manwonToWon(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return 0;
  const man = Number(digits);
  return Number.isFinite(man) ? man * 10_000 : 0;
}

function toNumber(raw: string): number {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export default function ToolsPage() {
  const [activeTab, setActiveTab] = useState<string>(TABS[0].id);

  // ── 내 집 마련 입력 (전부 만원 단위, 클라이언트 로컬 — API 호출 0건) ──
  const [priceMan, setPriceMan] = useState('50000');      // 5억
  const [areaM2, setAreaM2] = useState('84.95');
  const [ltvRatio, setLtvRatio] = useState('70');
  const [rate, setRate] = useState('3.5');
  const [years, setYears] = useState('30');
  const [incomeMan, setIncomeMan] = useState('6000');     // 연 6천만
  const [existingDebtMan, setExistingDebtMan] = useState('0');

  // ── 투자 계산 입력 ──
  const [gapSaleMan, setGapSaleMan] = useState('50000');
  const [gapJeonseMan, setGapJeonseMan] = useState('35000');
  const [ppPriceMan, setPpPriceMan] = useState('50000');
  const [ppAreaM2, setPpAreaM2] = useState('84.95');

  const price = manwonToWon(priceMan);
  const area = toNumber(areaM2);

  const tax = useMemo(
    () => calculateAcquisitionTax({
      purchasePrice: price,
      homeCountAfterPurchase: 1,
      exclusiveAreaM2: area > 0 ? area : null,
      isPurchase: true,
    }),
    [price, area]
  );

  const ltv = useMemo(() => loanAmountAtLtv(price, toNumber(ltvRatio)), [price, ltvRatio]);
  const monthly = useMemo(
    () => (ltv ? calculateMonthlyPayment(ltv.loanAmount, toNumber(rate), toNumber(years)) : 0),
    [ltv, rate, years]
  );
  const dsr = useMemo(
    () => calculateDsr(manwonToWon(incomeMan), manwonToWon(existingDebtMan), monthly),
    [incomeMan, existingDebtMan, monthly]
  );

  const gap = useMemo(
    () => calculateGap(manwonToWon(gapSaleMan), manwonToWon(gapJeonseMan)),
    [gapSaleMan, gapJeonseMan]
  );
  const pp = useMemo(
    () => pricePerPyeong(manwonToWon(ppPriceMan), toNumber(ppAreaM2)),
    [ppPriceMan, ppAreaM2]
  );

  const moneyInput = (value: string, onChange: (v: string) => void, label: string, unit = '만원') => (
    <div className={styles.formGroup}>
      <label className={styles.formLabel}>{label}</label>
      <div className={styles.inputRow}>
        <input
          className={styles.formInput}
          // 모바일에서 숫자 키패드가 뜨도록. type="number"는 콤마 입력이 막혀 쓰지 않는다.
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className={styles.inputUnit}>{unit}</span>
      </div>
    </div>
  );

  const renderHome = () => (
    <div className={styles.toolsGrid}>
      {/* 진입점 — 상세에서 오지 않았어도 여기서 들어갈 수 있다 */}
      <Link href="/finance-fit" className={styles.entryCard}>
        <Calculator size={18} strokeWidth={2.2} aria-hidden="true" />
        <div>
          <div className={styles.entryTitle}>이 집 사려면 얼마 필요?</div>
          <div className={styles.entryDesc}>매매가·대출·필요 현금을 한 번에 정리합니다.</div>
        </div>
        <ArrowRight size={16} aria-hidden="true" className={styles.entryArrow} />
      </Link>

      {/* 취득세 */}
      <section className={styles.toolCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}><Receipt size={16} aria-hidden="true" /> 취득세 계산</h2>
          <span className={styles.limitedBadge}>1주택 기준</span>
        </div>
        <div className={styles.cardBody}>
          {moneyInput(priceMan, setPriceMan, '취득가액')}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>전용면적 (㎡)</label>
            <div className={styles.inputRow}>
              <input className={styles.formInput} inputMode="decimal" value={areaM2} onChange={(e) => setAreaM2(e.target.value)} />
              <span className={styles.inputUnit}>㎡</span>
            </div>
          </div>

          {tax.kind === 'SUPPORTED' ? (
            <div className={styles.resultBox}>
              <p className={styles.resultText}>예상 취득세 합계 {formatWon(tax.result.total)}</p>
              <ul className={styles.breakdown}>
                <li><span>취득세 ({tax.result.baseRatePercent}%)</span><b>{formatWon(tax.result.baseTax)}</b></li>
                <li><span>지방교육세</span><b>{formatWon(tax.result.localEducationTax)}</b></li>
                <li>
                  <span>농어촌특별세</span>
                  <b>{tax.result.ruralSpecialTax > 0 ? formatWon(tax.result.ruralSpecialTax) : '해당 없음'}</b>
                </li>
              </ul>
            </div>
          ) : (
            <div className={styles.resultBox}>
              <p className={styles.resultText}>{UNSUPPORTED_MESSAGE[tax.reason]}</p>
            </div>
          )}

          <div className={styles.disclosurePanel} role="note">
            <b>계산 기준</b> — 개인이 주택을 <b>매매로 1주택 취득</b>하는 경우입니다.
            2주택 이상 취득, 생애최초 감면, 증여·상속·분양권, 조정대상지역 중과는 반영하지 않습니다.
            실제 세액은 세무 상담으로 확인하세요.
            <br />
            기준: {ACQUISITION_TAX_RULE_VERSION.source} · {ACQUISITION_TAX_RULE_VERSION.referenceDate}
          </div>
        </div>
      </section>

      {/* 대출 · LTV · DSR · 월 상환액 */}
      <section className={styles.toolCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}><Landmark size={16} aria-hidden="true" /> 대출 · 월 상환액 · DSR</h2>
          <span className={styles.limitedBadge}>참고 계산</span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>가정 LTV 비율</label>
            <div className={styles.inputRow}>
              <input className={styles.formInput} inputMode="decimal" value={ltvRatio} onChange={(e) => setLtvRatio(e.target.value)} />
              <span className={styles.inputUnit}>%</span>
            </div>
            <p className={styles.hint}>규제·주택 수·은행에 따라 실제 한도는 달라집니다. 직접 가정값을 넣어 비교해 보세요.</p>
          </div>
          <div className={styles.twoCol}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>금리</label>
              <div className={styles.inputRow}>
                <input className={styles.formInput} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
                <span className={styles.inputUnit}>%</span>
              </div>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>기간</label>
              <div className={styles.inputRow}>
                <input className={styles.formInput} inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value)} />
                <span className={styles.inputUnit}>년</span>
              </div>
            </div>
          </div>
          <div className={styles.twoCol}>
            {moneyInput(incomeMan, setIncomeMan, '연소득')}
            {moneyInput(existingDebtMan, setExistingDebtMan, '기존 연간 원리금')}
          </div>

          <div className={styles.resultBox}>
            {ltv ? (
              <ul className={styles.breakdown}>
                <li><span>예상 대출 한도 (가정 {ltv.ratioPercent}%)</span><b>{formatWon(ltv.loanAmount)}</b></li>
                <li><span>필요 자기자금</span><b>{formatWon(ltv.requiredOwnFunds)}</b></li>
                <li><span>월 상환액 (원리금균등)</span><b>{formatWon(Math.round(monthly))}</b></li>
                <li>
                  <span>DSR</span>
                  <b>{dsr ? `${dsr.percent.toFixed(1)}%` : '연소득 입력 필요'}</b>
                </li>
              </ul>
            ) : (
              <p className={styles.resultText}>매매가와 비율을 입력해 주세요.</p>
            )}
          </div>

          <div className={styles.disclosurePanel} role="note">
            <b>계산 기준</b> — 입력한 가정값에 비율을 적용한 <b>참고 계산</b>입니다.
            상환방식은 원리금균등만 지원합니다. 이 값은 <b>금융기관의 승인 가능 금액이 아니며</b>,
            실제 한도는 규제지역·보유 주택 수·소득 증빙·은행별 심사에 따라 달라집니다.
          </div>
        </div>
      </section>

      {/* 등기비용 — 금액을 만들지 않는다 */}
      <section className={styles.toolCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}><FileSignature size={16} aria-hidden="true" /> 등기 비용</h2>
          <span className={styles.limitedBadge}>견적 필요</span>
        </div>
        <div className={styles.cardBody}>
          <p className={styles.hint}>
            등기 비용은 성격이 다른 항목이 섞여 있어 하나의 예상 금액으로 묶지 않습니다.
            항목별로 어디서 확정되는지 알려드립니다.
          </p>
          <ul className={styles.costList}>
            {REGISTRATION_COST_ITEMS.map((item) => (
              <li key={item.key} className={styles.costItem}>
                <div className={styles.costLabel}>
                  {item.label}
                  <span className={styles.costNature}>
                    {item.nature === 'CALCULATED_ELSEWHERE' ? '계산 가능' : item.nature === 'QUOTE_REQUIRED' ? '견적 필요' : '변동'}
                  </span>
                </div>
                <p className={styles.costNote}>{item.note}</p>
              </li>
            ))}
          </ul>
          {/* §11 — 기존 파트너 인프라를 그대로 쓴다(설정 복제 없음, 추적도 기존 이벤트). */}
          <PartnerCtaCard placement="finance" />
        </div>
      </section>
    </div>
  );

  const renderInvest = () => (
    <div className={styles.toolsGrid}>
      <section className={styles.toolCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}><Scale size={16} aria-hidden="true" /> 필요 갭 · 전세가율</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.twoCol}>
            {moneyInput(gapSaleMan, setGapSaleMan, '매매가')}
            {moneyInput(gapJeonseMan, setGapJeonseMan, '전세가')}
          </div>
          <div className={styles.resultBox}>
            {gap ? (
              <ul className={styles.breakdown}>
                <li><span>필요 갭</span><b>{formatWon(gap.gapAmount)}</b></li>
                <li><span>전세가율</span><b>{gap.jeonseRatioPercent.toFixed(1)}%</b></li>
              </ul>
            ) : (
              <p className={styles.resultText}>매매가와 전세가를 입력해 주세요.</p>
            )}
          </div>
          <div className={styles.disclosurePanel} role="note">
            <b>계산 기준</b> — 입력한 두 값의 차이와 비율입니다.
            <b>같은 단지의 같은 전용면적</b>끼리 비교할 때만 의미가 있습니다.
            면적이나 시점이 다른 거래를 넣으면 실제로 존재하지 않는 갭이 나옵니다.
          </div>
        </div>
      </section>

      <section className={styles.toolCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}><Ruler size={16} aria-hidden="true" /> 평당가</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.twoCol}>
            {moneyInput(ppPriceMan, setPpPriceMan, '가격')}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>전용면적 (㎡)</label>
              <div className={styles.inputRow}>
                <input className={styles.formInput} inputMode="decimal" value={ppAreaM2} onChange={(e) => setPpAreaM2(e.target.value)} />
                <span className={styles.inputUnit}>㎡</span>
              </div>
            </div>
          </div>
          <div className={styles.resultBox}>
            {pp ? (
              <ul className={styles.breakdown}>
                <li><span>면적</span><b>약 {pp.pyeong.toFixed(1)}평</b></li>
                <li><span>평당가</span><b>{formatWon(pp.pricePerPyeong)}</b></li>
                <li><span>㎡당</span><b>{formatWon(pp.pricePerM2)}</b></li>
              </ul>
            ) : (
              <p className={styles.resultText}>가격과 전용면적을 입력해 주세요.</p>
            )}
          </div>
          <div className={styles.disclosurePanel} role="note">
            <b>계산 기준</b> — 입력한 <b>전용면적</b> 기준입니다. 공급면적 기준 평당가와는 다릅니다.
          </div>
        </div>
      </section>
    </div>
  );

  const renderReport = () => (
    <div className={styles.toolsGrid}>
      {/* §25 — 리포트는 다시 만들지 않는다. 기존 라우트를 그대로 연다. */}
      <Link href="/stats/compare" className={styles.entryCard}>
        <Scale size={18} strokeWidth={2.2} aria-hidden="true" />
        <div>
          <div className={styles.entryTitle}>단지 비교</div>
          <div className={styles.entryDesc}>여러 단지를 나란히 두고 비교합니다.</div>
        </div>
        <ArrowRight size={16} aria-hidden="true" className={styles.entryArrow} />
      </Link>
      <Link href="/report" className={styles.entryCard}>
        <FileText size={18} strokeWidth={2.2} aria-hidden="true" />
        <div>
          <div className={styles.entryTitle}>단지 한장 리포트</div>
          <div className={styles.entryDesc}>단지 하나를 한 장으로 정리해 저장·공유합니다.</div>
        </div>
        <ArrowRight size={16} aria-hidden="true" className={styles.entryArrow} />
      </Link>
      <Link href={cityReportHref()} className={styles.entryCard}>
        <TrendingUp size={18} strokeWidth={2.2} aria-hidden="true" />
        <div>
          <div className={styles.entryTitle}>지역 브리핑</div>
          <div className={styles.entryDesc}>부산 전체 흐름을 한 장으로 봅니다.</div>
        </div>
        <ArrowRight size={16} aria-hidden="true" className={styles.entryArrow} />
      </Link>
    </div>
  );

  const renderSafety = () => (
    <div className={styles.toolsGrid}>
      <section className={styles.toolCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}><ShieldCheck size={16} aria-hidden="true" /> 전세 계약 필수 특약</h2>
        </div>
        <div className={styles.cardBody}>
          <ul className={styles.checkList}>
            {SPECIAL_TERMS.map((term) => (
              <li key={term.title} className={styles.checkItem}>
                <div>
                  <div className={styles.checkItemTitle}>{term.title}</div>
                  <div className={styles.checkItemDesc}>{term.text}</div>
                </div>
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={() => navigator.clipboard?.writeText(term.text)}
                >
                  복사
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.toolCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}><Gavel size={16} aria-hidden="true" /> 경매 · 공매</h2>
          <span className={styles.soonBadge}>준비중</span>
        </div>
        <div className={styles.cardBody}>
          <Empty
            variant="notReady"
            title="경매·공매 데이터는 아직 연동 준비 중입니다."
            description="실제 데이터가 연동될 때까지 임의의 예시 매물을 보여드리지 않습니다."
          />
        </div>
      </section>

      <section className={styles.toolCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}><ClipboardList size={16} aria-hidden="true" /> 임장 노트</h2>
          <span className={styles.soonBadge}>준비중</span>
        </div>
        <div className={styles.cardBody}>
          {/* §18 — 예전에는 입력칸과 "저장하기" 버튼이 있었지만 저장되는 곳이 없었고
              별점도 눌리지 않았다. 눌리는데 아무 일도 없는 버튼을 남기지 않는다. */}
          <Empty
            variant="notReady"
            title="임장 노트는 저장 기능과 함께 준비 중입니다."
            description="기록이 실제로 보관되기 전까지는 입력칸을 열어두지 않습니다."
          />
        </div>
      </section>
    </div>
  );

  return (
    <div className={styles.main}>
      <Header pageTitle="부동산 도구" />
      <div className="container">
        <div className={styles.header}>
          <p className={styles.lead}>집을 고른 다음, 실제로 살 수 있는지까지 계산해 봅니다.</p>
          <div className={styles.tabsContainer}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`${styles.tab} ${activeTab === tab.id ? styles.activeTab : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.Icon size={14} strokeWidth={2.2} aria-hidden="true" /> {tab.name}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'home' && renderHome()}
        {activeTab === 'invest' && renderInvest()}
        {activeTab === 'report' && renderReport()}
        {activeTab === 'safety' && renderSafety()}
      </div>
    </div>
  );
}

const SPECIAL_TERMS = [
  {
    title: '대출 불승인 시 계약금 반환',
    text: '임차인의 전세자금대출이 목적물의 하자로 인하여 불가할 경우, 임대인은 계약금을 즉시 반환한다.',
  },
  {
    title: '잔금일까지 권리변동 금지',
    text: '임대인은 잔금 지급일 다음 날까지 목적물에 근저당권 등 새로운 권리를 설정하지 않는다.',
  },
  {
    title: '선순위 보증금 고지',
    text: '임대인은 계약 체결 시점의 선순위 보증금 및 미납 조세 내역을 임차인에게 고지한다.',
  },
] as const;
