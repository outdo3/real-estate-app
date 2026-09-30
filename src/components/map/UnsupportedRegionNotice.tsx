'use client';

import { useEffect, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { isPublicRegionAllowed } from '@/lib/region/enablement';
import styles from './UnsupportedRegionNotice.module.css';

/**
 * 지도가 **아직 공개되지 않은 지역**을 보고 있을 때의 안내.
 *
 * BUSAN_LAUNCH_SCOPE_SITEMAP_FIX_V1 §4에서 시작한 안내(예전 이름 OutOfBusanNotice)를
 * SEOUL25_GO_LIVE_PREP_V1에서 일반화했다. 예전에는 "지도 중심이 부산 경계 밖인가"로 판정하고
 * "부산 데이터를 우선 제공" 문구를 썼는데, 서울 8구가 공개된 뒤부터 이미 틀린 말이었고 서울 25구·경기가
 * 열리면 더 틀려진다. 이제는 지도 중심의 시군구(currentLawdCd)가 공개 allowlist(`map` 축)에 없을 때만
 * 뜬다 — 지역 이름을 문구에 박지 않으므로 공개 지역이 늘어나도 문구를 다시 고칠 필요가 없다.
 *
 * 왜 필요한가: 지도는 사용자의 실제 위치로 열린다(의도된 동작 — 되돌리지 않는다). 공개되지 않은
 * 지역에서 열면 마커가 없고, 그게 "서비스가 고장났다"처럼 보인다. 사실을 그대로 말한다 — 없는 데이터를
 * 있는 척하지도, 사용자를 다른 지역으로 강제로 끌고 가지도 않는다.
 *
 * 규칙(§4 그대로):
 *  - 지도 사용을 막지 않는다(pointer-events가 지도에 닿지 않는 위치, 닫기 가능)
 *  - 오류처럼 보이지 않는다(경고색·아이콘 없음)
 *  - pan/zoom마다 다시 뜨지 않는다 — 세션당 한 번, 닫으면 그 세션에서는 끝
 *  - 로그인 불필요
 *  - 판정은 이미 알고 있는 시군구 코드 + 순수 allowlist 하나뿐이다(추가 네트워크 호출 없음)
 */

const SESSION_KEY = 'ejip.map.unsupportedRegionNoticeDismissed';

export default function UnsupportedRegionNotice({ lawdCd }: { lawdCd: string | null | undefined }) {
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

  // 지역을 아직 모르면(역지오코딩 전) 띄우지 않는다 — 추측으로 "지원 안 함"이라고 말하지 않는다.
  const unsupported = !!lawdCd && !isPublicRegionAllowed(lawdCd, 'map');
  if (dismissed || !unsupported) return null;

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
        지금 보고 계신 지역은 아직 이집 정보가 준비되지 않았어요.
        <br />
        제공 지역은 차례로 넓혀가고 있습니다.
      </p>
      <button type="button" onClick={close} className={styles.close} aria-label="안내 닫기">
        <X className={styles.closeIcon} aria-hidden="true" />
      </button>
    </div>
  );
}
