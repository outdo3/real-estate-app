import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { validateFavoriteInput } from '@/lib/favorites';

// 관심단지(Favorites) CRUD. userId는 항상 requireUser()가 반환한 세션 사용자에서만
// 가져온다 — body/query로 받은 userId는 절대 신뢰하지 않는다(다른 사용자 데이터
// 접근/변조 방지).

export async function GET() {
  const { error, status, user } = await requireUser();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: user!.id },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ success: true, data: favorites });
  } catch (err) {
    console.error('Failed to list favorites:', err);
    return NextResponse.json({ success: false, error: '관심단지 목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error, status, user } = await requireUser();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const body = await request.json();
    const validated = validateFavoriteInput(body);
    if (!validated.valid) {
      return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
    }
    const { lawdCd, dong, name, aptSeq, address } = validated.data;

    // 같은 단지를 다시 저장해도 500/중복 row 대신 upsert로 조용히 성공 처리한다
    // (DB @@unique([userId, lawdCd, dong, name])와 동일한 키로 매칭).
    const favorite = await prisma.favorite.upsert({
      where: { userId_lawdCd_dong_name: { userId: user!.id, lawdCd, dong, name } },
      update: { aptSeq, address },
      create: { userId: user!.id, lawdCd, dong, name, aptSeq, address },
    });

    return NextResponse.json({ success: true, data: favorite });
  } catch (err) {
    console.error('Failed to save favorite:', err);
    return NextResponse.json({ success: false, error: '관심단지를 저장하지 못했습니다.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { error, status, user } = await requireUser();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const { searchParams } = new URL(request.url);
    const validated = validateFavoriteInput({
      lawdCd: searchParams.get('lawdCd'),
      dong: searchParams.get('dong'),
      name: searchParams.get('name'),
    });
    if (!validated.valid) {
      return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
    }
    const { lawdCd, dong, name } = validated.data;

    // deleteMany + userId 조건으로, 본인 소유가 아니거나 이미 없는 favorite를
    // 지우려는 요청도 에러 없이 0건 삭제로 안전하게 끝난다(존재 여부로 다른
    // 사용자의 데이터 유무를 유추할 수 있는 정보 노출도 막는다).
    await prisma.favorite.deleteMany({
      where: { userId: user!.id, lawdCd, dong, name },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete favorite:', err);
    return NextResponse.json({ success: false, error: '관심단지를 해제하지 못했습니다.' }, { status: 500 });
  }
}
