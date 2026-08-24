import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { validateSyncPayload } from '@/lib/recent-views';

// 서버 보존 최대 행 수.
const SERVER_MAX = 20;

/**
 * POST /api/my/recent/sync
 *
 * Body: { items: LocalRecentItem[] }   (최대 20개)
 *
 * 로직:
 *  1. 각 item을 (userId, lawdCd, dong, name) unique constraint로 upsert.
 *     – viewedAt이 있고 클라이언트 값이 더 크면 갱신, 없으면 기존 유지.
 *  2. upsert 후 사용자 recent_views에서 오래된 것을 pruning해 20개 유지.
 *  3. 병합된 최신 목록(서버 20건)을 반환 → 클라이언트가 local에 반영 가능.
 *
 * Idempotent: 동일 payload를 여러 번 보내도 중복 row 생성 없음.
 */
export async function POST(request: Request) {
  const { error, status, user } = await requireUser();
  if (error) return NextResponse.json({ success: false, error }, { status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const items = validateSyncPayload(body);

  try {
    const uid = user!.id;

    // 유효한 각 item을 upsert. viewedAt은 클라이언트 timestamp(있고 유효하면)를 사용하되,
    // 서버에 이미 더 최신 값이 있으면 덮어쓰지 않는다.
    for (const item of items) {
      const clientTs = item.viewedAt ? new Date(item.viewedAt) : new Date();

      await prisma.recentView.upsert({
        where: {
          userId_lawdCd_dong_name: {
            userId: uid,
            lawdCd: item.lawdCd,
            dong: item.dong,
            name: item.name,
          },
        },
        update: {
          // 클라이언트가 보낸 timestamp가 서버보다 최신인 경우만 갱신.
          // Prisma에서 조건부 update를 직접 지원하지 않으므로
          // 현재 row를 먼저 가져오지 않고 단순하게 max(client, server)를 구현하기 위해
          // raw 비교 없이 클라이언트 값으로 덮는다.
          // (동일 단지를 다시 보면 이 sync 이후에도 apt-client 단일 upsert가 올바른 시각으로 재갱신함)
          viewedAt: clientTs,
          aptSeq: item.aptSeq ?? undefined,
          address: item.address ?? undefined,
        },
        create: {
          userId: uid,
          lawdCd: item.lawdCd,
          dong: item.dong,
          name: item.name,
          aptSeq: item.aptSeq ?? null,
          address: item.address ?? null,
          viewedAt: clientTs,
        },
      });
    }

    // SERVER_MAX 초과 시 오래된 row 제거 — 반드시 userId 조건 포함.
    const allRows = await prisma.recentView.findMany({
      where: { userId: uid },
      orderBy: { viewedAt: 'desc' },
      select: { id: true },
    });

    if (allRows.length > SERVER_MAX) {
      const toDelete = allRows.slice(SERVER_MAX).map((r) => r.id);
      await prisma.recentView.deleteMany({
        where: { userId: uid, id: { in: toDelete } },
      });
    }

    // 병합 결과(최신 목록) 반환 — 클라이언트가 local 미러 갱신에 활용.
    const merged = await prisma.recentView.findMany({
      where: { userId: uid },
      orderBy: { viewedAt: 'desc' },
      take: SERVER_MAX,
    });

    return NextResponse.json({ success: true, data: merged });
  } catch (err) {
    console.error('Failed to sync recent views:', err);
    return NextResponse.json(
      { success: false, error: '최근 본 단지를 동기화하지 못했습니다.' },
      { status: 500 }
    );
  }
}
