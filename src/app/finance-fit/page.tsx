import type { Metadata } from 'next';
import { Suspense } from 'react';
import { siteConfig, buildOpenGraph } from '@/config/site';
import FinanceFitClient from './finance-fit-client';

const title = `자금 계획 간편 계산기 - ${siteConfig.name}`;
const description = '예상 매수가, 대출 가정을 입력하면 필요 자기자금과 월 예상 원리금을 간편하게 계산해드립니다.';

export const metadata: Metadata = { title, description, openGraph: buildOpenGraph({ title, description }) };

// FINANCE_FIT_V1_PHASE2A §3 — /stats/[type]의 기존 패턴과 동일하게, Detail/Compare에서
// 넘어온 쿼리스트링(identity/참고가격)을 useSearchParams()로 읽는 클라이언트 컴포넌트를
// Suspense 경계 없이 정적 렌더하면 페이지 전체가 CSR로 강제 전환되므로 여기서 감싼다.
export default function FinanceFitPage() {
  return (
    <Suspense fallback={null}>
      <FinanceFitClient />
    </Suspense>
  );
}
