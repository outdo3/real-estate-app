'use client';

import Button from '@/components/ui/Button';
import { trackEvent } from '@/lib/analytics/trackEvent';
import type { NextAction } from '@/lib/decision-journey/types';
import styles from './NextActionSection.module.css';

interface Props {
  title?: string;
  actions: NextAction[];
  aptName?: string | null;
}

// DECISION_JOURNEY_V1 §7/§18 — 페이지마다 CTA를 따로 만들지 않고, 이 컴포넌트
// 하나가 NextAction[]을 받아 primary 1개 + secondary 2~3개 규칙으로 렌더링한다.
// 클릭 트래킹은 기존 analytics allowlist(ANALYTICS_EVENT_NAMES)에 등록된
// 'next_action_click' 하나만 사용한다 — 페이지/액션별 세부 구분은 하지 않는다
// (allowlist에 새 필드를 추가하지 않기 위한 의도적 단순화).
export default function NextActionSection({ title = '다음으로 확인해볼까요?', actions, aptName }: Props) {
  if (actions.length === 0) return null;

  const handleClick = (actionType: NextAction['type']) => {
    trackEvent('next_action_click', { aptName: aptName ?? undefined, actionType });
  };

  return (
    <div className={styles.wrap}>
      {title && <div className={styles.title}>{title}</div>}
      <div className={styles.actions}>
        {actions.map((action) => (
          <Button
            key={action.type}
            variant={action.priority === 'primary' ? 'primary' : 'secondary'}
            size="sm"
            href={action.href}
            loading={action.loading}
            className={styles.actionBtn}
            onClick={(e) => {
              handleClick(action.type);
              action.onClick?.();
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
