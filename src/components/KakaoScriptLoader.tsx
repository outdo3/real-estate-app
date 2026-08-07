'use client';

import { useKakaoLoader } from 'react-kakao-maps-sdk';

export default function KakaoScriptLoader() {
  const [loading, error] = useKakaoLoader({
    appkey: process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || '',
    libraries: ['services', 'clusterer'],
  });

  return null;
}
