import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { startOfLocalDay } from '../../common/utils/date.util';
import { TaskCompletion } from './task-completion.entity';
import { Task, TaskKind } from './task.entity';
import { expandRule } from './task.expand';
import type { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';

/** Календарь/жагсаалтад харагдах НЭГ ӨДРИЙН нэг ажил. */
export interface TaskOccurrence {
  /** Ажил + огноогийн хослол — дэлгэц дээр түлхүүр болгоно. */
  key: string;
  taskId: string;
  title: string;
  notes: string | null;
  kind: TaskKind;
  /** `YYYY-MM-DD`. */
  on: string;
  /** `HH:MM` эсвэл `null`. */
  atTime: string | null;
  assignee: { id: string; name: string; role: string } | null;
  done: boolean;
  doneAt: Date | null;
  doneBy: string | null;
}

/**
 * ⚠ ХАМГИЙН ӨРГӨН МУЖ. Календарь нэг сар харуулдаг (42 нүд) тул
 * 120 хоног нь хангалттай нөөцтэй. Хязгааргүй орхивол хэн нэгэн
 * `from=2000&to=2100` гэж дуудаад серверийг ачаална.
 */
const MAX_RANGE_DAYS = 120;

/**
 * Нүүр хуудсан дээр ХЭДЭН ХОНОГИЙН хоцрогдлыг харуулах вэ.
 *
 * Хязгааргүй бол өдөр бүрийн ажлыг нэг сар тэмдэглээгүй орхиход
 * жагсаалт 30 мөр болж, өнөөдрийн ажил живнэ. Долоо хоног нь
 * «саяхан мартсан» ба «аль эрт орхигдсон» хоёрын зөв зааг.
 */
const OVERDUE_DAYS = 7;

/**
 * Төлөвлөгөөт ажил.
 *
 * ★ ТОХИОЛДЛУУД ХАДГАЛАГДДАГГҮЙ
 *
 * `tasks` нь зөвхөн ДҮРЭМ. Аль өдөр ажил гарахыг `expandRule` тооцно.
 * Санд байдаг цорын ганц «баримт» нь ГҮЙЦЭТГЭЛ (`task_completions`).
 * Шалтгааныг migration 1788170000000-д бичсэн.
 */
@Injectable()
export class TaskService {
  private readonly tz: string;

  constructor(
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(TaskCompletion)
    private readonly completions: Repository<TaskCompletion>,
    config: ConfigService,
  ) {
    this.tz = config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  /** Өнөөдөр — ЗААЛНЫ цагаар, серверийн UTC-ээр биш. */
  today(): string {
    return this.toDay(startOfLocalDay(new Date(), this.tz));
  }

  private toDay(d: Date): string {
    // `startOfLocalDay` нь орон нутгийн шөнө дундыг UTC агшин болгож
    // өгдөг тул огноог тэр бүсэд нь буцааж уншина.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  }

  private shiftDay(day: string, delta: number): string {
    const [y, m, d] = day.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d, 12));
    t.setUTCDate(t.getUTCDate() + delta);
    return t.toISOString().slice(0, 10);
  }

  // ══════════════════════════════════════════════════════════════
  //  Унших
  // ══════════════════════════════════════════════════════════════

  /**
   * Мужийн бүх тохиолдол — КАЛЕНДАРИЙН цорын ганц асуулга.
   *
   * @param mine  өгвөл ЗӨВХӨН тэр ажилтных + эзэнгүй ажлууд.
   */
  async occurrences(
    from: string,
    to: string,
    mine?: string,
  ): Promise<TaskOccurrence[]> {
    if (from > to) throw new BadRequestException('Огнооны муж буруу байна');
    const span =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000;
    if (span > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Хэт өргөн муж — дээд тал нь ${MAX_RANGE_DAYS} хоног`,
      );
    }

    /*
     * ⚠ `starts_on <= to` гэж шүүнэ — мужийн ДАРАА эхэлдэг ажил
     *   хэзээ ч энэ мужид гарахгүй. `ends_on`-ыг мөн шүүж болох ч
     *   `expandRule` дотор дахин шалгагддаг тул давхардуулахгүй.
     */
    const rows = await this.tasks
      .createQueryBuilder('t')
      .where('t.active = true')
      .andWhere('t.starts_on <= :to', { to })
      .andWhere('(t.ends_on IS NULL OR t.ends_on >= :from)', { from })
      .getMany();

    if (!rows.length) return [];

    const doneMap = await this.doneMap(
      rows.map((t) => t.id),
      from,
      to,
    );
    /*
     * ⚠ Нэрсийг ХАРИУЦАГЧ ба ГҮЙЦЭТГЭГЧ ХОЁУЛАНГААС нь цуглуулна.
     *   Зөвхөн хариуцагчаар барьвал «хэн гүйцэтгэсэн» талбар эзэнгүй
     *   ажлууд дээр үргэлж хоосон харагдана.
     */
    const staff = await this.staffMap([
      ...rows.map((t) => t.assigneeId),
      ...[...doneMap.values()].map((c) => c.doneBy),
    ]);

    const out: TaskOccurrence[] = [];
    for (const t of rows) {
      // «Миний ажил» — эзэнгүй ажлыг БҮГДЭД нь харуулна: тэдгээр нь
      // «хэн ч хийж болно» гэсэн утгатай, нуувал хэн ч хийхгүй.
      if (mine && t.assigneeId && t.assigneeId !== mine) continue;

      for (const on of expandRule(t, from, to)) {
        const c = doneMap.get(`${t.id}|${on}`);
        out.push({
          key: `${t.id}|${on}`,
          taskId: t.id,
          title: t.title,
          notes: t.notes,
          kind: t.kind,
          on,
          atTime: t.atTime ? t.atTime.slice(0, 5) : null,
          assignee: t.assigneeId ? (staff.get(t.assigneeId) ?? null) : null,
          done: !!c,
          doneAt: c?.doneAt ?? null,
          doneBy: c ? (staff.get(c.doneBy ?? '')?.name ?? null) : null,
        });
      }
    }

    // Огноо → цаг → гарчиг. Цаггүй ажил цагтайн ДАРАА: тодорхой
    // цагтай нь эхэлж хийгдэх ёстой.
    return out.sort(
      (a, b) =>
        a.on.localeCompare(b.on) ||
        (a.atTime ?? '99').localeCompare(b.atTime ?? '99') ||
        a.title.localeCompare(b.title),
    );
  }

  /**
   * Нүүр хуудасны жагсаалт — ӨНӨӨДӨР + хоцорсон.
   *
   * ⚠ Зөвхөн ГҮЙЦЭТГЭЭГҮЙГ нь буцаана: гүйцэтгэсэн ажил нүүрэн дээр
   * зай эзлэх шаардлагагүй. Календарь дээр бүгд харагдана.
   */
  async todo(staffId: string): Promise<{
    today: string;
    items: TaskOccurrence[];
    overdue: TaskOccurrence[];
  }> {
    const today = this.today();
    const all = await this.occurrences(
      this.shiftDay(today, -OVERDUE_DAYS),
      today,
      staffId,
    );
    const open = all.filter((o) => !o.done);
    return {
      today,
      items: open.filter((o) => o.on === today),
      overdue: open.filter((o) => o.on < today),
    };
  }

  /** Удирдах дэлгэцийн ДҮРМҮҮД (тохиолдол биш). */
  async list(includeInactive: boolean): Promise<
    (Task & { assignee: { id: string; name: string; role: string } | null })[]
  > {
    const rows = await this.tasks.find({
      where: includeInactive ? {} : { active: true },
      order: { createdAt: 'DESC' },
    });
    const staff = await this.staffMap(rows.map((t) => t.assigneeId));
    return rows.map((t) => ({
      ...t,
      assignee: t.assigneeId ? (staff.get(t.assigneeId) ?? null) : null,
    }));
  }

  // ══════════════════════════════════════════════════════════════
  //  Бичих
  // ══════════════════════════════════════════════════════════════

  async create(dto: CreateTaskDto, staffId: string): Promise<Task> {
    this.assertRule(dto.kind, dto.startsOn, dto.endsOn ?? null);
    return this.tasks.save(
      this.tasks.create({
        title: dto.title.trim(),
        notes: dto.notes?.trim() || null,
        kind: dto.kind,
        startsOn: dto.startsOn,
        atTime: dto.atTime || null,
        endsOn: dto.endsOn || null,
        assigneeId: dto.assigneeId || null,
        active: true,
        createdBy: staffId,
      }),
    );
  }

  async update(id: string, dto: UpdateTaskDto): Promise<Task> {
    const t = await this.find(id);
    if (dto.title !== undefined) t.title = dto.title.trim();
    if (dto.notes !== undefined) t.notes = dto.notes?.trim() || null;
    if (dto.kind !== undefined) t.kind = dto.kind;
    if (dto.startsOn !== undefined) t.startsOn = dto.startsOn;
    if (dto.atTime !== undefined) t.atTime = dto.atTime || null;
    if (dto.endsOn !== undefined) t.endsOn = dto.endsOn || null;
    if (dto.assigneeId !== undefined) t.assigneeId = dto.assigneeId || null;
    if (dto.active !== undefined) t.active = dto.active;
    this.assertRule(t.kind, t.startsOn, t.endsOn);
    return this.tasks.save(t);
  }

  /**
   * ⚠ УСТГАХГҮЙ — унтраана.
   *
   * `task_completions` нь `ON DELETE CASCADE` тул мөрийг устгавал
   * өнгөрсөн бүх гүйцэтгэл хамт арилна. Календарь дээр өнөөдрийг
   * хүртэлх түүх хоосорно.
   */
  async deactivate(id: string): Promise<{ ok: true }> {
    const t = await this.find(id);
    t.active = false;
    await this.tasks.save(t);
    return { ok: true };
  }

  /** Гүйцэтгэсэн гэж тэмдэглэх — идемпотент. */
  async complete(id: string, on: string, staffId: string): Promise<{ done: true }> {
    const t = await this.find(id);
    // Дүрэмд байхгүй өдрийг тэмдэглүүлэхгүй: эс бөгөөс дэлгэцийн алдаа
    // санд хэзээ ч харагдахгүй мөр үлдээнэ.
    if (!expandRule(t, on, on).length) {
      throw new BadRequestException('Энэ өдөр уг ажил төлөвлөгдөөгүй байна');
    }
    await this.completions
      .createQueryBuilder()
      .insert()
      .values({ taskId: id, occurrenceOn: on, doneBy: staffId })
      .orIgnore() // ON CONFLICT DO NOTHING — давхар дарахад алдаа өгөхгүй
      .execute();
    return { done: true };
  }

  async uncomplete(id: string, on: string): Promise<{ done: false }> {
    await this.completions.delete({ taskId: id, occurrenceOn: on });
    return { done: false };
  }

  // ══════════════════════════════════════════════════════════════

  async find(id: string): Promise<Task> {
    const t = await this.tasks.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Ажил олдсонгүй');
    return t;
  }

  /** Дүрмийн алдааг САНД хүрэхээс өмнө барина. */
  private assertRule(kind: TaskKind, startsOn: string, endsOn: string | null) {
    if (endsOn && endsOn < startsOn) {
      throw new BadRequestException('Дуусах огноо эхлэхээсээ өмнө байна');
    }
    // «Нэг удаа» дээр төгсгөл утгагүй — чимээгүй хаяхын оронд хэлнэ.
    if (kind === TaskKind.ONCE && endsOn) {
      throw new BadRequestException(
        'Нэг удаагийн ажилд дуусах огноо шаардлагагүй',
      );
    }
  }

  private async doneMap(
    ids: string[],
    from: string,
    to: string,
  ): Promise<Map<string, TaskCompletion>> {
    if (!ids.length) return new Map();
    const rows = await this.completions
      .createQueryBuilder('c')
      .where('c.task_id IN (:...ids)', { ids })
      .andWhere('c.occurrence_on BETWEEN :from AND :to', { from, to })
      .getMany();
    return new Map(rows.map((c) => [`${c.taskId}|${c.occurrenceOn}`, c]));
  }

  /**
   * Ажилтны нэрсийг ТҮҮХИЙ асуулгаар.
   *
   * `Task` нь `StaffUser`-тэй харилцаагүй — модуль хоорондын хамаарал
   * үүсгэхгүйн тулд (`member.service`-тэй ижил арга).
   */
  private async staffMap(
    ids: (string | null)[],
  ): Promise<Map<string, { id: string; name: string; role: string }>> {
    const clean = [...new Set(ids.filter((v): v is string => !!v))];
    if (!clean.length) return new Map();
    const rows = await this.tasks.manager.query<
      { id: string; name: string; role: string }[]
    >(`SELECT id, name, role FROM staff_users WHERE id = ANY($1)`, [clean]);
    return new Map(rows.map((r) => [r.id, r]));
  }
}
