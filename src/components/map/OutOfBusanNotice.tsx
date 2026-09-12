'use client';

import { useEffect, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { isInsideBusanBounds } from '@/lib/busan-bounds';
import styles from './OutOfBusanNotice.module.css';

/**
 * BUSAN_LAUNCH_SCOPE_SITEMAP_FIX_V1 §4 — 지도가 부산 밖에서 열렸을 때의 안내.
 *
 * 왜 필요한가: 지도는 사용자의 실제 위치로 열린다(의도된 동작 — 되돌리지 않는다).
 * 진주·남해 같은 곳에서 열면 마커가 거의/전혀 없는데, 그게 "서비스가 고장났다"처럼
 * 보인다. 사실은 **이집이 아직 부산 데이터를 우선 제공**하는 것이다. 그 사실을 그대로
 * 말한다 — 없는 데이터를 있는 척하지도, 사용자를 부산으로 강제로 끌고 오지도 않는다.
 *
 * 규칙(§4):
 *  - 지도 사용을 막지 않는다(pointer-events가 지도에 닿지 않는 위치, 닫기 가능)
 *  - 오류처럼 보이지 않는다(경고색·아이콘 없음)
 *  - pan/zoom마다 다시 뜨지 않는다 — 세션당 한 번, 닫으면 그 세션에서는 끝
 *  - 로그인 불필요
 *  - 판정은 좌표 bounding box 하나뿐이다(§11 — 역지오코딩 네트워크 호출 없음)
 */

const SESSION_KEY = 'ejip.map.outOfBusanNoticeDismissed';

export default function OutOfBusanNotice({ lat, lng }: { lat: number; lng: number }) {
  const [dismissed, setDismissed] = useState(true);

  // sessionStorage는 서버 렌더에 없다. 첫 페인트에서는 숨김으로 두고 마운트 후에
  // 판단해 hydration 불일치를 피한다.
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(SESSION_KEY) === '1');
    } catch {
      // 프라이빗 모드 등에서 sessionStorage가 막혀 있으면 안내는 보여주되
      // "닫음"을 기억하지 못할 뿐이다 — 기능을 끄지는 않는다.
      setDismissed(false);
    }
  }, []);

  const outside = !isInsideBusanBounds(lat, lng);
  if (dismissed || !outside) return null;

  const close = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // 저장에 실패해도 이번 화면에서는 닫힌다.
    }
  };

  return (
    <div className={styles.notice} role="status">
      <MapPin className={styles.icon} aria-hidden="true" />
      <p className={styles.text}>
        현재 위치는 부산 외 지역입니다.
        <br />
        이집은 현재 부산 지역 데이터를 우선 제공하고 있습니다.
      </p>
      <button type="button" onClick={close} className={styles.close} aria-label="안내 닫기">
        <X className={styles.closeIcon} aria-hidden="true" />
      </button>
    </div>
  );
}
