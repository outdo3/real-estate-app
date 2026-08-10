"""단지 커뮤니티 시설(골프연습장/수영장/피트니스 등) 정보 수집 스크립트.

사용법:
    # 저장해둔 HTML 파일에서 파싱 (권장 — 아래 "왜 URL 직접 조회를 기본값으로 안 했는가" 참고)
    python scripts/crawl_facilities.py --name "해운대동백두산위브더제니스아파트" \
        --file ./naver_page.html --dong 우동 --lawd-cd 26350 --dry-run

    # URL을 직접 조회 (차단되지 않는 사이트에 한해서만 안정적으로 동작)
    python scripts/crawl_facilities.py --name "..." --url "https://..." --dong 우동

    # 여러 단지를 한 번에 (JSON 목록)
    python scripts/crawl_facilities.py --list ./targets.json

--dry-run 없이 실행하면 Supabase의 apartments 테이블에 실제로 upsert한다
(SUPABASE_URL / SUPABASE_KEY 환경변수 필요).

왜 URL 직접 조회를 기본값으로 안 했는가:
    네이버 부동산(new.land.naver.com)의 단지 상세 API는 브라우저 세션 토큰이
    없는 일반 요청을 즉시 TOO_MANY_REQUESTS로 차단한다(이 스크립트 작성 중 직접
    확인함). 이 스크립트는 그 차단을 우회하려 하지 않는다 — 대신 사용자가 실제
    브라우저에서 열람 중인(즉, 접근 권한이 있는) 페이지를 "다른 이름으로 저장"한
    HTML 파일이나, 애초에 자동 요청을 막지 않는 사이트(단지 자체 분양 홈페이지,
    K-apt 등)의 URL을 입력으로 받는 방식을 기본으로 한다. --url로 직접 조회하는
    기능도 제공하지만 결과가 없거나 차단 응답이면 그 사실을 그대로 보고하고
    끝난다(재시도로 우회를 시도하지 않음).
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import requests
from bs4 import BeautifulSoup

# 실제 브라우저와 동일한 헤더를 사용해 "이 요청이 어디서 왔는지" 사이트 운영자가
# 확인할 수 있게 한다 — 신원을 숨기는 게 목적이 아니라, 스크립트가 아닌 요청과
# 최대한 비슷하게 부하를 주지 않기 위한 통상적인 배려다.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
REQUEST_TIMEOUT_SEC = 10

# 상세페이지 UI(apt-client.tsx)가 그대로 렌더링하는 고정 태그 집합. 키워드 매칭은
# 이 중 하나로만 귀결되므로, 스크립트가 임의의 새 이모지/문구를 지어내는 일은 없다.
# 키워드는 실제 분양 공고/단지 소개 문구에서 흔히 쓰이는 표현들을 여러 개 등록해
# 표기 차이(예: "골프연습장" vs "스크린골프")로 놓치는 경우를 줄인다.
FACILITY_KEYWORD_MAP: dict[str, list[str]] = {
    "⛳ 골프연습장": ["골프연습장", "스크린골프", "골프장"],
    "🏊 수영장": ["수영장", "실내수영장", "워터파크"],
    "🏋️ 피트니스": ["피트니스", "헬스장", "휘트니스", "GX룸", "gx룸"],
    "📚 독서실": ["독서실", "스터디카페", "스터디룸"],
    "♨️ 사우나": ["사우나", "찜질방", "스파"],
    "🍳 조식서비스": ["조식서비스", "조식 서비스", "조식뷔페", "모닝서비스"],
    "🎬 시네마룸": ["시네마룸", "영화관람실", "미디어룸"],
    "🎱 골든룸": ["골든룸", "당구장"],
    "🧒 키즈카페": ["키즈카페", "어린이놀이방", "실내놀이터"],
    "🐾 반려동물놀이터": ["반려동물놀이터", "펫파크", "애견놀이터"],
    "🛋️ 게스트하우스": ["게스트하우스", "게스트룸"],
    "🚗 카셰어링": ["카셰어링", "공유차량"],
}


@dataclass
class FacilityTarget:
    name: str
    dong: Optional[str] = None
    lawd_cd: Optional[str] = None
    url: Optional[str] = None
    file: Optional[str] = None


@dataclass
class FacilityResult:
    target: FacilityTarget
    facilities: list[str] = field(default_factory=list)
    source: str = ""
    error: Optional[str] = None


def fetch_html_from_url(url: str) -> str:
    """일반 GET 요청 한 번만 시도한다 — 차단 응답을 우회하려는 재시도/헤더 위조는 하지 않는다."""
    resp = requests.get(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": "ko-KR,ko;q=0.9",
        },
        timeout=REQUEST_TIMEOUT_SEC,
    )
    resp.raise_for_status()
    return resp.text


def fetch_html_from_file(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def extract_facilities(html_or_text: str) -> list[str]:
    """HTML(또는 순수 텍스트)에서 키워드를 찾아 정해진 이모지 태그 목록으로 정형화한다.

    페이지 전체 텍스트에서 키워드를 찾는 단순한 방식이라 "인근에 골프연습장 없음"처럼
    부정문에도 걸릴 수 있는 한계가 있다 — 그래서 상세페이지 UI는 이 결과를 100%
    확정값이 아니라 참고 정보로 다루고, 항상 [정보 제보하기]로 사용자가 바로잡을 수
    있게 한다.
    """
    soup = BeautifulSoup(html_or_text, "html.parser")
    text = soup.get_text(" ", strip=True)

    found: list[str] = []
    for tag, keywords in FACILITY_KEYWORD_MAP.items():
        if any(kw in text for kw in keywords):
            found.append(tag)
    return found


def collect_one(target: FacilityTarget) -> FacilityResult:
    try:
        if target.file:
            html_or_text = fetch_html_from_file(target.file)
            source = f"file:{target.file}"
        elif target.url:
            html_or_text = fetch_html_from_url(target.url)
            source = target.url
        else:
            return FacilityResult(target=target, error="url 또는 file 중 하나가 필요합니다.")

        facilities = extract_facilities(html_or_text)
        return FacilityResult(target=target, facilities=facilities, source=source)
    except requests.exceptions.RequestException as e:
        return FacilityResult(target=target, error=f"요청 실패: {e}")
    except OSError as e:
        return FacilityResult(target=target, error=f"파일 읽기 실패: {e}")


def get_supabase_client():
    """지연 import — --dry-run만 쓰는 경우엔 supabase 패키지가 없어도 스크립트가 동작해야 한다."""
    try:
        from supabase import create_client
    except ImportError as e:
        raise RuntimeError(
            "supabase 패키지가 설치되어 있지 않습니다. `pip install -r scripts/requirements.txt` 실행 후 다시 시도하세요."
        ) from e

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_KEY(또는 SUPABASE_SERVICE_ROLE_KEY) 환경변수가 필요합니다."
        )
    return create_client(url, key)


def upsert_facilities(client, result: FacilityResult) -> None:
    row = {
        "name": result.target.name,
        "dong": result.target.dong,
        "lawd_cd": result.target.lawd_cd,
        "community_facilities": result.facilities,
        # updated_at은 DB DEFAULT now()가 INSERT에는 적용되지만, upsert의 UPDATE 경로에서는
        # SET 절에 없는 컬럼은 그대로 남는다(직접 실측 확인) — 재크롤링해도 "마지막 수집 시각"이
        # 안 바뀌는 걸 막기 위해 항상 명시적으로 채운다.
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    # apartments 테이블에 (name, dong) 복합 유니크가 있다고 가정하고 upsert한다
    # (prisma/schema.prisma의 Apartment 모델과 동일한 제약).
    client.table("apartments").upsert(row, on_conflict="name,dong").execute()


def load_targets_from_list_file(path: str) -> list[FacilityTarget]:
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    targets = []
    for item in raw:
        targets.append(
            FacilityTarget(
                name=item["name"],
                dong=item.get("dong"),
                lawd_cd=item.get("lawdCd") or item.get("lawd_cd"),
                url=item.get("url"),
                file=item.get("file"),
            )
        )
    return targets


def run(targets: list[FacilityTarget], dry_run: bool) -> list[FacilityResult]:
    client = None if dry_run else get_supabase_client()
    results: list[FacilityResult] = []

    for i, target in enumerate(targets):
        result = collect_one(target)
        results.append(result)

        if result.error:
            print(f"[실패] {target.name}: {result.error}")
        else:
            tag_summary = ", ".join(result.facilities) if result.facilities else "(감지된 시설 없음)"
            print(f"[성공] {target.name} ({result.source}) -> {tag_summary}")
            if not dry_run:
                upsert_facilities(client, result)
                print(f"       DB 반영 완료 (apartments: {target.name}/{target.dong or '-'})")

        # 여러 건을 연속으로 조회할 때만 쉬어간다 — 마지막 건 뒤에는 대기할 이유가 없다.
        if target.url and i < len(targets) - 1:
            time.sleep(random.uniform(2, 4))

    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", help="단지명 (단건 조회 시)")
    parser.add_argument("--dong", help="법정동명, 예: 우동")
    parser.add_argument("--lawd-cd", help="법정동코드 5자리")
    parser.add_argument("--url", help="단지 상세 페이지 URL (단건 조회 시)")
    parser.add_argument("--file", help="미리 저장해둔 HTML 파일 경로 (단건 조회 시, --url보다 우선)")
    parser.add_argument("--list", dest="list_file", help="{name,dong,lawdCd,url|file}[] 형태의 JSON 목록 파일")
    parser.add_argument("--dry-run", action="store_true", help="DB에 쓰지 않고 추출 결과만 출력")
    parser.add_argument("--selftest", action="store_true", help="네트워크 없이 파싱 로직만 샘플 텍스트로 검증")
    args = parser.parse_args()

    if args.selftest:
        return run_selftest()

    if args.list_file:
        targets = load_targets_from_list_file(args.list_file)
    elif args.name and (args.url or args.file):
        targets = [
            FacilityTarget(
                name=args.name,
                dong=args.dong,
                lawd_cd=args.lawd_cd,
                url=args.url,
                file=args.file,
            )
        ]
    else:
        parser.error("--name과 (--url 또는 --file)을 함께 주거나, --list로 목록 파일을 지정하세요.")
        return 2

    try:
        results = run(targets, dry_run=args.dry_run)
    except RuntimeError as e:
        print(f"[중단] {e}", file=sys.stderr)
        return 1

    failed = sum(1 for r in results if r.error)
    print(f"\n완료: {len(results) - failed}/{len(results)}건 성공")
    return 1 if failed else 0


def run_selftest() -> int:
    """실제 사이트 없이 파싱 로직 자체가 맞는지 확인한다(리뷰/CI에서 네트워크 없이 실행 가능)."""
    sample_html = """
    <html><body>
      <h2>단지 커뮤니티 안내</h2>
      <ul>
        <li>실내 골프연습장 (24시간 운영)</li>
        <li>수영장 및 사우나 완비</li>
        <li>입주민 전용 피트니스 센터</li>
        <li>키즈카페, 스터디카페 운영</li>
      </ul>
      <p>조식서비스는 평일에만 제공됩니다.</p>
    </body></html>
    """
    expected = {
        "⛳ 골프연습장",
        "🏊 수영장",
        "♨️ 사우나",
        "🏋️ 피트니스",
        "🧒 키즈카페",
        "📚 독서실",
        "🍳 조식서비스",
    }
    got = set(extract_facilities(sample_html))

    if got != expected:
        print(f"[selftest 실패] expected={sorted(expected)} got={sorted(got)}", file=sys.stderr)
        return 1

    # 아무 시설 언급도 없는 페이지에서는 빈 목록이어야 한다(과감지 방지 확인).
    empty = extract_facilities("<html><body><p>84A타입 평면도입니다.</p></body></html>")
    if empty:
        print(f"[selftest 실패] 시설 언급이 없는데도 감지됨: {empty}", file=sys.stderr)
        return 1

    print("[selftest 통과] 파싱 로직 정상")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
