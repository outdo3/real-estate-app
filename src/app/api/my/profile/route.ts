import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { validateNickname } from '@/lib/nickname';

/**
 * USER_NICKNAME_EDIT_V1 §4 — 내 프로필(닉네임) 수정 API.
 *
 * 소유권: userId는 **항상** requireUser()가 돌려준 세션 사용자에서만 가져온다.
 * 요청 본문이나 쿼리의 userId는 절대 신뢰하지 않는다 — 애초에 받지도 않는다.
 * (기존 /api/my/preferences와 동일한 패턴을 그대로 따른다.)
 *
 * 이 STEP의 범위는 닉네임 하나다. 이메일과 프로필 사진은 읽기 전용이며 여기서 수정할
 * 수 없다(§2/§10) — 받지 않는 필드는 무시하는 게 아니라 아예 읽지 않는다.
 */
export async function PUT(request: Request) {
  const { error, status, user } = await requireUser();
  if (error) return NextResponse.json({ success: false, error }, { status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const validated = validateNickname(body);
  if (!validated.valid) {
    return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: user!.id },
      data: { name: validated.nickname },
      select: { name: true },
    });

    return NextResponse.json({ success: true, data: { nickname: updated.name } });
  } catch (err) {
    // 닉네임 값 자체는 로그에 남기지 않는다 — 사용자가 입력한 표시명이다(§4 no PII logging).
    console.error('Failed to update nickname for current user');
    return NextResponse.json(
      { success: false, error: '닉네임을 저장하지 못했습니다.' },
      { status: 500 }
    );
  }
}
