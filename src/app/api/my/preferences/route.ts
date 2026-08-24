import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth-helpers';
import { validatePurposes } from '@/lib/preferences';

// 관심 목적(User Preferences) API.
// userId는 항상 requireUser()가 반환한 세션 사용자에서만 가져온다.
// client body/query의 userId는 절대 신뢰하지 않는다.

export async function GET() {
  const { error, status, user } = await requireUser();
  if (error) return NextResponse.json({ success: false, error }, { status });

  try {
    const pref = await prisma.userPreference.findUnique({
      where: { userId: user!.id },
    });
    // row가 없으면 미설정 상태 — 빈 배열로 반환
    return NextResponse.json({
      success: true,
      data: { purposes: pref ? (pref.purposes as string[]) : [] },
    });
  } catch (err) {
    console.error('Failed to get preferences:', err);
    return NextResponse.json(
      { success: false, error: '관심 목적을 불러오지 못했습니다.' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const { error, status, user } = await requireUser();
  if (error) return NextResponse.json({ success: false, error }, { status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: '요청 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const validated = validatePurposes(body);
  if (!validated.valid) {
    return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
  }

  try {
    const pref = await prisma.userPreference.upsert({
      where: { userId: user!.id },
      update: { purposes: validated.purposes },
      create: { userId: user!.id, purposes: validated.purposes },
    });

    return NextResponse.json({
      success: true,
      data: { purposes: pref.purposes as string[] },
    });
  } catch (err) {
    console.error('Failed to update preferences:', err);
    return NextResponse.json(
      { success: false, error: '관심 목적을 저장하지 못했습니다.' },
      { status: 500 }
    );
  }
}
