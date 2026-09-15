// USER_FEEDBACK_V1 — Prisma 구현(서버 전용). 앱의 기존 서버 DB 경로(Prisma, 테이블 소유자)만 쓴다.
import 'server-only';
import { prisma } from '@/lib/prisma';
import type { FeedbackCategory, FeedbackStatus } from './feedback-rules';
import type { AdminFeedbackRepo, FeedbackRepo, FeedbackRow, MasterLookup } from './feedback-service';

function toRow(r: {
  id: string;
  category: string;
  message: string;
  status: string;
  userId: string | null;
  pagePath: string | null;
  pageQuery: string | null;
  aptSeq: string | null;
  apartmentName: string | null;
  lawdCd: string | null;
  userAgent: string | null;
  ipHash: string | null;
  notifiedAt: Date | null;
  adminNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): FeedbackRow {
  // DB CHECK 제약이 값을 보장한다(category/status는 허용 목록 밖 값이 들어갈 수 없다).
  return { ...r, category: r.category as FeedbackCategory, status: r.status as FeedbackStatus };
}

export const prismaFeedbackRepo: FeedbackRepo = {
  async countRecent(key, since) {
    return prisma.userFeedback.count({
      where: 'userId' in key ? { userId: key.userId, createdAt: { gte: since } } : { ipHash: key.ipHash, createdAt: { gte: since } },
    });
  },
  async create(data) {
    return prisma.userFeedback.create({ data, select: { id: true, createdAt: true } });
  },
  async markNotified(id, at) {
    await prisma.userFeedback.update({ where: { id }, data: { notifiedAt: at } });
  },
};

export const prismaMasterLookup: MasterLookup = {
  async findByAptSeq(aptSeq) {
    const m = await prisma.apartmentMaster.findUnique({ where: { aptSeq }, select: { aptSeq: true, name: true, sggCd: true } });
    return m && m.aptSeq ? { aptSeq: m.aptSeq, name: m.name, lawdCd: m.sggCd } : null;
  },
};

export const prismaAdminFeedbackRepo: AdminFeedbackRepo = {
  async list(filters, take, skip) {
    const where = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.category ? { category: filters.category } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.userFeedback.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      prisma.userFeedback.count({ where }),
    ]);
    return { rows: rows.map(toRow), total };
  },
  async findStatus(id) {
    return prisma.userFeedback.findUnique({ where: { id }, select: { status: true, resolvedAt: true } });
  },
  async update(id, data) {
    return toRow(await prisma.userFeedback.update({ where: { id }, data }));
  },
};
