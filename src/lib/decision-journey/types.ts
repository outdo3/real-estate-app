// DECISION_JOURNEY_V1 — 페이지마다 CTA를 하드코딩하지 않고 공통 타입으로
// 다음 행동(Next Action)을 표현한다. href(정적 링크) 또는 onClick(비동기 처리,
// 예: 지도 좌표 지오코딩 후 이동)을 선택적으로 가진다 — 둘 다 실제 존재하는
// route만 가리켜야 하며, 존재하지 않는 기능으로 연결하지 않는다.
export type NextActionType =
  | 'COMPARE'
  | 'MAP'
  | 'NEARBY'
  | 'FAVORITE'
  | 'PRICE'
  | 'TRANSACTIONS'
  | 'SCORE'
  | 'BUDGET'
  | 'SEARCH'
  | 'BACK_TO_RESULTS';

export interface NextAction {
  type: NextActionType;
  label: string;
  priority: 'primary' | 'secondary';
  href?: string;
  onClick?: () => void | Promise<void>;
  loading?: boolean;
}
