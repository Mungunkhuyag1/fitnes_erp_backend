import { EntityManager, IsNull } from 'typeorm';
import {
  entryStatusAt,
  replayLedger,
  type EntryStatus,
} from '../../common/utils/ledger.util';
import { Membership } from './membership.entity';

/**
 * Гишүүний ОДООГИЙН оролтын төлөв — хоногийн эрхтэй бол `null`.
 *
 * ★ ЯАГААД СЕРВИС БИШ ФУНКЦ ВЭ
 *
 * Гишүүний дэлгэц (`member`), `/pay` (`public`), Loopy карт (`loyalty`)
 * гурвуулаа үүнийг хэрэглэнэ. `MembershipModule` нь тэдгээрийг импортолдог
 * тул сервис болговол ДАВХАР ГОГЦОО үүснэ. Entity + цэвэр дүрэм л хангалттай.
 */
export async function loadEntryStatus(
  m: EntityManager,
  memberId: string,
  tz: string,
  now: Date = new Date(),
): Promise<EntryStatus | null> {
  const rows = await m.getRepository(Membership).find({
    where: { memberId, reversedAt: IsNull() },
    order: { createdAt: 'ASC' },
  });
  if (!rows.length) return null;
  return entryStatusAt(replayLedger(rows, tz, rows[0].startsAt), now);
}
