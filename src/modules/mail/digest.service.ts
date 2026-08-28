import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { MailEvent } from './mail.entity';
import { MailService } from './mail.service';
import { dailyDigest, type DigestData } from './mail.template';

/**
 * Өдрийн орлогын хураангуй.
 *
 * ★ ЯАГААД ТӨЛБӨР БҮРД БИШ, ӨДӨРТ НЭГ УДАА ВЭ
 *
 * «Орлого орох бүрд мэйл» гэдэг нь эхний долоо хоногт сайхан санагдаж,
 * хоёр дахь долоо хоногт хэн ч уншихаа болино. Өдөрт 10 төлбөр байвал
 * сард 300 мэйл — тэр бол ЧИМЭЭ, мэдээлэл биш. Нэг мэйл, бүтэн зураг
 * нь хамаагүй их үнэ цэнтэй.
 */
@Injectable()
export class DigestService {
  private readonly log = new Logger(DigestService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private get tz(): string {
    return this.config.get<string>('timezone') ?? 'Asia/Ulaanbaatar';
  }

  /** Өдөр бүр 23:00 — өдөр дуусахад ойрхон, шөнийн ажлуудаас өмнө. */
  @Cron('0 23 * * *', { name: 'daily-digest', timeZone: 'Asia/Ulaanbaatar' })
  async tick(): Promise<void> {
    const sent = await this.run();
    if (sent) this.log.log(`Өдрийн хураангуй илгээв: ${sent} хаяг`);
  }

  /** Гараар ажиллуулах / өнөөдрийн тоог харах. */
  async collect(day?: Date): Promise<DigestData> {
    const [row] = await this.ds.query<Record<string, string | null>[]>(
      `
      WITH d AS (SELECT ($1::timestamptz AT TIME ZONE $2)::date AS today)
      SELECT
        (SELECT coalesce(sum(amount),0) FROM memberships, d
          WHERE reversed_at IS NULL
            AND (created_at AT TIME ZONE $2)::date = d.today) AS revenue,
        (SELECT count(*) FROM memberships, d
          WHERE reversed_at IS NULL
            AND (created_at AT TIME ZONE $2)::date = d.today) AS sales,
        (SELECT coalesce(sum(amount),0) FROM memberships, d
          WHERE reversed_at IS NULL AND source = 'cash'
            AND (created_at AT TIME ZONE $2)::date = d.today) AS cash,
        (SELECT coalesce(sum(amount),0) FROM memberships, d
          WHERE reversed_at IS NULL AND source = 'bonum'
            AND (created_at AT TIME ZONE $2)::date = d.today) AS online,
        (SELECT coalesce(sum(amount),0) FROM locker_assignments, d
          WHERE type = 'rental'
            AND (issued_at AT TIME ZONE $2)::date = d.today) AS locker_revenue,
        (SELECT count(*) FROM members, d
          WHERE (created_at AT TIME ZONE $2)::date = d.today) AS new_members,
        (SELECT count(DISTINCT member_id) FROM access_events, d
          WHERE granted AND member_id IS NOT NULL
            AND (event_at AT TIME ZONE $2)::date = d.today) AS visits,
        (SELECT count(*) FROM invoices
          WHERE needs_approval AND approved_at IS NULL AND status = 'paid')
          AS awaiting_approval
      `,
      [day ?? new Date(), this.tz],
    );
    const n = (k: string): number => Number(row[k] ?? 0);
    const membership = n('revenue');
    return {
      // ⚠ `mn-MN` locale нь сарыг РОМ тоогоор бичдэг («VIII/28») —
      // мэйлийн гарчигт танигдахгүй. `sv-SE` нь ISO хэлбэр өгнө.
      date: new Date(day ?? new Date()).toLocaleDateString('sv-SE', {
        timeZone: this.tz,
      }),
      revenue: membership + n('locker_revenue'),
      sales: n('sales'),
      cash: n('cash'),
      online: n('online'),
      lockerRevenue: n('locker_revenue'),
      newMembers: n('new_members'),
      visits: n('visits'),
      awaitingApproval: n('awaiting_approval'),
    };
  }

  async run(day?: Date): Promise<number> {
    const data = await this.collect(day);
    const { subject, html } = dailyDigest(data);
    return this.mail.notify(MailEvent.DAILY_INCOME, subject, html, 'daily_digest');
  }
}
