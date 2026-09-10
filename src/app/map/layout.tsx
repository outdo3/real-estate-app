import type { ReactNode } from 'react';
import { kakaoMapsSdkUrl, KAKAO_SDK_SCRIPT_ID } from '@/lib/kakao/maps-sdk';
import { DEFAULT_LAWD_CD, aptMarkerRequestPath } from '@/lib/map-marker-share';

// ── PERCEIVED_PERFORMANCE_V2_5 §5 — SDK를 "받아만 두는" 게 아니라 **실행까지** 앞당긴다 ──
//
// V2.2가 넣은 `<link rel="preload" as="script">`는 다운로드만 앞당긴다. 실측(Production,
// Slow 4G / CPU 4x)에서 SDK는 약 560ms에 이미 다 받아져 있는데, 정작 `kakao.maps.load()`는
// hydration이 끝난 뒤(약 2,250ms) client effect에서야 호출됐다. 즉 **1.7초 동안 SDK가
// 받아진 채 실행되지 않고 놀았다.** `autoload=false`라 `maps.load()`가 실제 지도 모듈을
// 추가로 받아오므로, 그 시작이 늦어지면 지도 인스턴스 생성과 첫 타일이 통째로 밀린다.
//
// 그래서 부트 스크립트가 태그를 **직접 심고** 곧바로 `kakao.maps.load()`를 호출한다.
// 태그 id는 로더와 같은 상수(KAKAO_SDK_SCRIPT_ID)를 쓰므로, 나중에 hydration에서
// loadKakaoMapsSdk()가 돌 때 기존 태그를 재사용한다 — 중복 주입이 구조적으로 불가능하다.
// 그때는 이미 `window.kakao.maps.load`가 존재하므로 로더의 동기 검사 경로를 타고
// 즉시 resolve된다(폴링 없음, 계약 변경 없음).
//
// 실패 처리는 그대로 로더가 담당한다 — 여기서는 에러를 삼키기만 하고(try/catch),
// 로더의 타임아웃/에러 문구(광고차단·사내망 안내)가 그대로 사용자에게 전달된다.
function bootSdkScript(sdkUrl: string): string {
  return `(function(){try{
if(document.getElementById(${JSON.stringify(KAKAO_SDK_SCRIPT_ID)}))return;
var s=document.createElement('script');
s.id=${JSON.stringify(KAKAO_SDK_SCRIPT_ID)};
s.src=${JSON.stringify(sdkUrl)};
s.async=true;
s.addEventListener('load',function(){try{
  if(window.kakao&&window.kakao.maps&&typeof window.kakao.maps.load==='function'){
    window.__EJIP_KAKAO_BOOT__=1;
    window.kakao.maps.load(function(){window.__EJIP_KAKAO_BOOT__=2;});
  }
}catch(e){}});
document.head.appendChild(s);
}catch(e){}})();`;
}

// ── PERCEIVED_PERFORMANCE_V2_4 §1/§6 — 마커 요청을 hydration 앞으로 당긴다 ──────
//
// 실측(Production, Slow 4G / CPU 4x / cold cache, n=8 중앙값):
//   HTML 파싱 중 인라인 스크립트 실행  340ms
//   DOMContentLoaded                   968ms
//   마커 요청 **시작**               2,249ms   ← 서버는 20~23ms면 답한다
//   마커 응답 완료                   2,629ms
// 즉 "데이터가 늦게 온다"가 아니라 **요청을 늦게 건다**. 요청이 client effect 안에
// 있어서 JS 다운로드(177KB) + hydration이 끝나야 출발했다.
//
// 인라인 스크립트는 hydration을 기다리지 않고 HTML 파싱 중에 실행되므로, 같은 요청을
// 약 340ms에 출발시킬 수 있다. 응답은 window에 promise로만 얹어두고 **state는 건드리지
// 않는다** — V2.2에서 이미 확인된 제약이다(조기에 state를 채우면 지도 인스턴스 생성과
// 오버레이 렌더가 한 커밋에 겹쳐 오히려 느려졌다). 렌더 순서는 그대로고 네트워크만 앞선다.
//
// URL은 페이지와 **같은 함수**(aptMarkerRequestPath)로 만든다. V2.2에서 SDK preload와
// 실제 주입 URL이 한 글자만 달라도 두 번 받는다는 것을 겪었기 때문에, 여기서도 단일
// 지점을 강제한다. 판정 규칙(bootPrefetchLawdCd)은 순수 함수로 따로 테스트한다 —
// 이 스크립트는 그 규칙을 인라인으로 옮겨 적은 것이라 두 곳이 어긋나면 안 된다.
const BOOT_PREFETCH_SCRIPT = `(function(){try{
var p=new URLSearchParams(location.search);
var l=p.get('layers');
if(l!=null&&l!==''&&(l==='-'||l.split(',').indexOf('apt')<0))return;
var c=p.get('lawdCd')||'${DEFAULT_LAWD_CD}';
if(!/^[0-9]{5}$/.test(c))return;
var u='${aptMarkerRequestPath('@')}'.replace('@',c);
window.__EJIP_APT_BOOT__={lawdCd:c,promise:fetch(u).then(function(r){
return r.ok?r.json().then(function(b){return{ok:true,body:b}}):{ok:false,body:null};
}).catch(function(){return{ok:false,body:null}})};
}catch(e){}})();`;

// PERCEIVED_PERFORMANCE_V2_2 §5 — 지도 라우트에서만 Kakao 지도 SDK를 미리 받아둔다.
//
// 실측한 BEFORE 파이프라인(Production, 4G/4x CPU, n=4):
//   FCP 608ms → sdk.js 요청 시작 **1,133ms** → 다운로드 완료 1,258ms → SDK ready 1,488ms
// 다운로드는 125ms밖에 안 걸린다(root layout의 preconnect 덕). 1,133ms는 순수하게
// "hydration이 끝나고 effect가 돌아 로더가 스크립트를 주입할 때까지"의 대기다.
//
// preload는 스크립트를 **실행하지 않고 받아만 둔다** — 실행 시점과 `kakao.maps.load()`
// 호출은 여전히 loadKakaoMapsSdk()가 통제하므로 초기화 순서/중복 방지 로직은 그대로다.
// URL은 로더와 같은 함수(kakaoMapsSdkUrl)로 만들어 두 번 받는 일이 없게 한다.
//
// 이 layout은 `/map` 하위에만 적용된다 — 지도를 쓰지 않는 화면에서 SDK를 내려받지 않는다.
export default function MapLayout({ children }: { children: ReactNode }) {
  const sdkUrl = kakaoMapsSdkUrl();
  return (
    <>
      {/* PERCEIVED_PERFORMANCE_V2_5 §5/§7 — 지도 모듈이 실제로 오는 호스트에 미리 연결한다.
          실측 waterfall: kakao.maps.load()는 `t1.daumcdn.net`에서 kakao.js → services.js →
          clusterer.js를 **직렬로** 받아온다. 그런데 기존 KakaoPreconnect는 dapi.kakao.com과
          타일 호스트(mts)만 열어둘 뿐 t1은 빠져 있었고, 게다가 client 컴포넌트라
          hydration 이후에야 힌트가 생겨 부팅 구간에는 아무 도움이 되지 않았다.
          여기(layout, 서버 렌더 HTML)에 두면 HTML 파싱 시점에 핸드셰이크가 시작된다.
          KakaoPreconnect는 다른 화면에서 계속 쓰이므로 건드리지 않는다. */}
      <link rel="preconnect" href="https://t1.daumcdn.net" />
      <link rel="preconnect" href="https://mts.daumcdn.net" />
      {sdkUrl && <link rel="preload" as="script" href={sdkUrl} />}
      <script dangerouslySetInnerHTML={{ __html: BOOT_PREFETCH_SCRIPT }} />
      {sdkUrl && <script dangerouslySetInnerHTML={{ __html: bootSdkScript(sdkUrl) }} />}
      {children}
    </>
  );
}
