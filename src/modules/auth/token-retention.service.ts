import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { RefreshToken } from './refresh-token.entity';

/**
 * Хугацаа дууссан refresh token-ыг устгана.
 *
 * Нэвтрэх бүрд шинэ мөр үүсдэг тул 5 ажилтан ч жилд мянга мянган мөр
 * үлдээнэ (одоо 209 мөр байна). Хугацаа нь дууссан токен нь ямар ч
 * үнэ цэнгүй — баталгаажуулалтад ашиглагдахаа больсон.
 *
 * ⚠ Хугацаа дуусмагц БИШ, түүнээс хойш 30 хоногийн дараа устгана:
 * «энэ төхөөрөмжөөс хэзээ нэвтэрсэн бэ» гэдэг нь халдлага мөшгихөд
 * хэрэгтэй байж болно.
 */
@Injectable()
export class TokenRetentionService {
  private readonly log = new Logger(TokenRetentionService.name);
  private static readonly KEEP_DAYS = 30;

  constructor(
    @InjectRepository(RefreshToken)
    private readonly repo: Repository<RefreshToken>,
  ) {}

  @Cron('40 4 * * *', { name: 'token-prune', timeZone: 'Asia/Ulaanbaatar' })
  async tick(): Promise<void> {
    const removed = await this.prune();
    if (removed) this.log.log(`Хуучин токен цэвэрлэв: ${removed} мөр`);
  }

  async prune(): Promise<number> {
    const cutoff = new Date(
      Date.now() - TokenRetentionService.KEEP_DAYS * 86_400_000,
    );
    const res = await this.repo.delete({ expiresAt: LessThan(cutoff) });
    return res.affected ?? 0;
  }
}
