// SELLFLOW_DATA_API_V1 — HTTP 계층: 인증 -> 입력 검증 -> 서비스 -> 응답/오류 규격 -> 운영 로그.
// 순수 Web API(Request/Response)만 쓴다. DB·환경변수·로거는 deps로 받는다(route 파일이 연결).
//
// 오류 규격: { success:false, apiVersion, requestId, error:{ code, message } }
//   400 잘못된 입력 · 401 인증 실패 · 403 권한 없음(허용되지 않은 유형) · 404 대상 없음 · 429 예약(V1 미발행, 아래) · 500 서버 오류 · 503 미활성
// 429: V1은 요청 수 제한을 **발행하지 않는다**. 서버리스 인스턴스별 메모리 카운터는 신뢰할 수 없어 만들지 않았다.
//      V1의 비용 보호는 hard limit(기간·페이지·결과 수)이며, 키별 지속 제한은 별도 승인 사항이다(docs 참고).
// 로그: requestId · endpoint · status · 처리시간 · 반환 행 수 · 오류 코드만. 키, 쿼리 값, 거래 내용은 남기지 않는다.
import {
  SELLFLOW_API_VERSION,
  SellflowApiError,
  authenticate,
  parseSearchQuery,
  parseSummaryQuery,
  parseTransactionsQuery,
  type SellflowAuthConfig,
} from './contract';
import { getSummary, getTransactions, searchBuildings, type SellflowDb } from './service';

export type SellflowRoute = { kind: 'search' } | { kind: 'transactions'; masterId: string } | { kind: 'summary'; masterId: string };

export interface SellflowLogEntry {
  evt: 'sellflow_api';
  requestId: string;
  endpoint: SellflowRoute['kind'];
  status: number;
  ms: number;
  rows: number;
  code: string | null;
}

export interface SellflowHandlerDeps {
  auth: SellflowAuthConfig;
  db: SellflowDb;
  now: () => Date;
  newRequestId: () => string;
  log: (entry: SellflowLogEntry) => void;
  /** 예기치 못한 오류. 이름만 넘긴다(메시지에 연결 정보가 섞일 수 있다). */
  onUnexpectedError?: (errorName: string) => void;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };

export async function handleSellflowRequest(request: Request, route: SellflowRoute, deps: SellflowHandlerDeps): Promise<Response> {
  const startedAt = deps.now().getTime();
  const requestId = deps.newRequestId();
  let status = 500;
  let rows = 0;
  let code: string | null = null;

  const respond = (httpStatus: number, body: unknown, extra: Record<string, string> = {}): Response => {
    status = httpStatus;
    return new Response(JSON.stringify(body), {
      status: httpStatus,
      headers: { ...JSON_HEADERS, 'X-Request-Id': requestId, 'Cache-Control': httpStatus === 200 ? 'private, max-age=60' : 'no-store', ...extra },
    });
  };
  const fail = (httpStatus: number, errCode: string, message: string, extra: Record<string, string> = {}): Response => {
    code = errCode;
    return respond(httpStatus, { success: false, apiVersion: SELLFLOW_API_VERSION, requestId, error: { code: errCode, message } }, extra);
  };

  try {
    const auth = authenticate(request.headers.get('authorization'), deps.auth);
    if (!auth.ok) return fail(auth.status, auth.code, auth.message, auth.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {});

    const url = new URL(request.url);
    const keys = Array.from(new Set(Array.from(url.searchParams.keys())));
    const get = (k: string) => url.searchParams.get(k);
    const now = deps.now();

    if (route.kind === 'search') {
      const result = await searchBuildings(parseSearchQuery(keys, get, auth.allowedPropertyTypes), deps.db);
      rows = result.rowCount;
      return respond(200, { success: true, apiVersion: SELLFLOW_API_VERSION, requestId, asOf: now.toISOString(), data: result.data });
    }
    if (route.kind === 'transactions') {
      const result = await getTransactions(route.masterId, parseTransactionsQuery(keys, get, now), auth.allowedPropertyTypes, deps.db, now);
      rows = result.rowCount;
      return respond(200, { success: true, apiVersion: SELLFLOW_API_VERSION, requestId, asOf: result.asOf, data: result.data });
    }
    const result = await getSummary(route.masterId, parseSummaryQuery(keys, get, now), auth.allowedPropertyTypes, deps.db, now);
    rows = result.rowCount;
    return respond(200, { success: true, apiVersion: SELLFLOW_API_VERSION, requestId, asOf: result.asOf, data: result.data });
  } catch (e) {
    if (e instanceof SellflowApiError) return fail(e.status, e.code, e.message);
    deps.onUnexpectedError?.(e instanceof Error ? e.name : 'UnknownError');
    // 조회 실패를 빈 결과로 바꾸지 않는다.
    return fail(500, 'INTERNAL_ERROR', '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    try {
      deps.log({ evt: 'sellflow_api', requestId, endpoint: route.kind, status, ms: deps.now().getTime() - startedAt, rows, code });
    } catch {
      // 로깅 실패가 응답을 바꾸지 않는다.
    }
  }
}
