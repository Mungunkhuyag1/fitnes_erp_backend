import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, DataSource } from 'typeorm';
import { pageResult, type PageResult } from '../../common/dto/paginated';
import { loadMembers, loadStaff } from '../../common/utils/enrich.util';
import { AuditLog } from './audit-log.entity';
import type { ListAuditDto } from './dto/audit.dto';

export interface AuditInput {
  staffUserId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>,
    private readonly ds: DataSource,
  ) {}

  /**
   * `manager` дамжуулбал бизнесийн транзакцад хамт бичигдэнэ — үйлдэл
   * амжилттай болсон ч лог дутуу үлдэх боломжгүй.
   */
  async record(input: AuditInput, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.repo;
    await repo.save(
      repo.create({
        staffUserId: input.staffUserId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        before: input.before ?? null,
        after: input.after ?? null,
        reason: input.reason ?? null,
        ip: input.ip ?? null,
      }),
    );
  }

  async list(q: ListAuditDto) {
    const qb = this.repo.createQueryBuilder('a');
    if (q.action) qb.andWhere('a.action = :action', { action: q.action });
    if (q.entity) qb.andWhere('a.entity = :entity', { entity: q.entity });
    if (q.entityId) qb.andWhere('a.entity_id = :eid', { eid: q.entityId });
    if (q.staffUserId) {
      qb.andWhere('a.staff_user_id = :sid', { sid: q.staffUserId });
    }
    if (q.from) qb.andWhere('a.created_at >= :from', { from: q.from });
    if (q.to) qb.andWhere('a.created_at <= :to', { to: q.to });
    qb.orderBy('a.created_at', q.order ? q.direction : 'DESC');
    const [rows, total] = await qb.skip(q.skip).take(q.take).getManyAndCount();

    // Мөр бүрийг ХҮНТЭЙ холбоно: «member.extend · a3f2…» гэхээс
    // «Эрх сунгав · Батаа №1042» нь ажилтанд шууд утга илэрхийлнэ.
    const [members, staff] = await Promise.all([
      loadMembers(
        this.ds,
        rows.filter((r) => r.entity === 'member').map((r) => r.entityId),
      ),
      loadStaff(this.ds, rows.map((r) => r.staffUserId)),
    ]);

    return pageResult(
      rows.map((r) => {
        const m = r.entity === 'member' ? members.get(r.entityId ?? '') : undefined;
        const s = staff.get(r.staffUserId ?? '');
        return {
          ...r,
          memberId: m?.id ?? null,
          memberName: m?.name ?? null,
          memberNo: m?.memberNo ?? null,
          staffName: s?.name ?? null,
          staffEmail: s?.email ?? null,
        };
      }),
      total,
      q,
    );
  }
}
