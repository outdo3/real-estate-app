import type { RedevelopmentPrismaClient } from './ingest';

// RedevelopmentPrismaClient는 구조적 타입(필요한 메서드만 선언)이라, 실제 Prisma
// 없이도 이 인메모리 구현으로 ingestRecord()를 그대로 재사용할 수 있다 — 목적 두 가지:
//   1) DB 없이 idempotency/matching 통합 테스트(ingest.test.ts)
//   2) migration이 아직 production에 적용되지 않은 상태에서도 quality_report.ts가
//      실제 매칭/병합 로직으로 파일럿 통계를 낼 수 있게 함(섹션 40/41 dry-run 요구사항)
export class InMemoryRedevelopmentStore implements RedevelopmentPrismaClient {
  private projects: any[] = [];
  private sourceRecords: any[] = [];
  private nextProjectId = 1;

  redevelopmentProject = {
    findMany: async (args: any) => {
      const where = args?.where ?? {};
      return this.projects.filter((p) => Object.entries(where).every(([k, v]) => p[k] === v));
    },
    create: async (args: any) => {
      const project = { id: this.nextProjectId++, ...args.data };
      this.projects.push(project);
      return project;
    },
    update: async (args: any) => {
      const project = this.projects.find((p) => p.id === args.where.id);
      if (!project) throw new Error(`Project ${args.where.id} not found`);
      Object.assign(project, args.data);
      return project;
    },
  };

  redevelopmentSourceRecord = {
    findUnique: async (args: any) => {
      const { source, sourceRecordId } = args.where.source_sourceRecordId;
      return this.sourceRecords.find((r) => r.source === source && r.sourceRecordId === sourceRecordId) ?? null;
    },
    upsert: async (args: any) => {
      const { source, sourceRecordId } = args.where.source_sourceRecordId;
      const existing = this.sourceRecords.find((r) => r.source === source && r.sourceRecordId === sourceRecordId);
      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }
      const created = { source, sourceRecordId, ...args.create };
      this.sourceRecords.push(created);
      return created;
    },
    update: async (args: any) => {
      const { source, sourceRecordId } = args.where.source_sourceRecordId;
      const existing = this.sourceRecords.find((r) => r.source === source && r.sourceRecordId === sourceRecordId);
      if (!existing) throw new Error(`SourceRecord ${source}/${sourceRecordId} not found`);
      Object.assign(existing, args.data);
      return existing;
    },
    findMany: async (args: any) => {
      const where = args?.where ?? {};
      return this.sourceRecords.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    },
  };

  getAllProjects() {
    return this.projects;
  }

  getAllSourceRecords() {
    return this.sourceRecords;
  }
}
