import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { OutboxMessage, OutboxStatus } from './outbox.entity';

/**
 * Боловсруулагдсан outbox мөрийг устгана.
 *
 * ★ ЯАГААД ХЭРЭГТЭЙ ВЭ
 *
 * Outbox нь ДАРААЛАЛ — түүхийн бүртгэл БИШ. `done` болсон мөр нь зөвхөн
 * ойрын хугацааны алдаа мөшгихөд хэрэгтэй, дараа нь дэмий жин.
 *
 * Хэмжилт: гишүүн бүрийн өөрчлөлт ~2 мөр үүсгэдэг тул 250 үйлдэл/өдөр
 * гэвэл 5 жилд ~900,000 мөр ≈ 780 MB хуримтлагдана. Ирцийн хүснэгт нь
 * ижил хугацаанд 510 MB — өөрөөр хэлбэл ТҮР ЗУУРЫН өгөгдөл нь бодит
 * түүхээсээ илүү зай эзэлнэ.
 *
 * Мөн ажилтан удаашрана: `FOR UPDATE SKIP LOCKED` сканнер нь мөр
 * олширох тусам үнэтэй болно.
 *
 * ⚠ `failed` мөрийг ҮЛДЭЭНЭ. Тэдгээр нь «хүн харах ёстой» гэсэн
 * дохио — устгавал асуудал чимээгүй алга болно.
 */
@Injectable()
export class OutboxRetentionService {
  private readonly log = new Logger(OutboxRetentionService.name);

  constructor(
    @InjectRepository(OutboxMessage)
    private readonly repo: Repository<OutboxMessage>,
    private readonly config: ConfigService,
  ) {}

  /** Өдөр бүр 04:30 — бусад шөнийн ажлууд дууссаны дараа. */
  @Cron('30 4 * * *', { name: 'outbox-prune', timeZone: 'Asia/Ulaanbaatar' })
  async tick(): Promise<void> {
    const removed = await this.prune();
    if (removed) this.log.log(`Outbox цэвэрлэв: ${removed} мөр`);
  }

  async prune(): Promise<number> {
    const days = this.config.get<number>('outbox.retentionDays') ?? 14;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const res = await this.repo.delete({
      status: OutboxStatus.DONE,
      processedAt: LessThan(cutoff),
    });
    return res.affected ?? 0;
  }
}
