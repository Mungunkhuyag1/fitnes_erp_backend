-- ════════════════════════════════════════════════════════════════
--  ПРОД ДЭЭРХ ТУРШИЛТЫН ӨГӨГДЛИЙГ ЦЭВЭРЛЭХ
--  2026-09-12 · Railway → Postgres → Query
-- ════════════════════════════════════════════════════════════════
--
--  ⚠ ЭНЭ НЬ БУЦААГДАХГҮЙ. Ажиллуулахын ӨМНӨ Railway дээр
--     Database → Backups → «Create backup» дарна.
--
--  ⚠ Терминал дээрх өгөгдөлд ХҮРЭХГҮЙ. Зөвхөн WinFit-ийн
--     мэдээллийн сан цэвэрлэгдэнэ.
--
--  ҮЛДЭХ зүйлс (зориуд):
--    staff_users              — админ бүртгэл
--    devices                  — терминалын холболтын тохиргоо
--    lockers                  — шүүгээний БҮРТГЭЛ (түрээс нь устана)
--    settings                 — системийн тохиргоо
--    notification_recipients  — мэйл хүлээн авагчид
--    integration_tokens       — Loopy/Bonum токен
-- ════════════════════════════════════════════════════════════════


-- ── 1-Р АЛХАМ: ЮУ УСТАХЫГ ХАРАХ (зөвхөн унших) ──────────────────
-- Эхлээд ЭНИЙГ ганцаар ажиллуулж тоог нь хараарай.

SELECT 'members'               AS huusnegt, count(*) FROM members
UNION ALL SELECT 'memberships',          count(*) FROM memberships
UNION ALL SELECT 'invoices',             count(*) FROM invoices
UNION ALL SELECT 'invoice_members',      count(*) FROM invoice_members
UNION ALL SELECT 'access_events',        count(*) FROM access_events
UNION ALL SELECT 'locker_assignments',   count(*) FROM locker_assignments
UNION ALL SELECT 'reminder_log',         count(*) FROM reminder_log
UNION ALL SELECT 'freezes',              count(*) FROM freezes
UNION ALL SELECT 'freeze_applications',  count(*) FROM freeze_applications
UNION ALL SELECT 'promotion_redemptions',count(*) FROM promotion_redemptions
UNION ALL SELECT 'gift_cards',           count(*) FROM gift_cards
UNION ALL SELECT 'outbox',               count(*) FROM outbox
UNION ALL SELECT 'email_log',            count(*) FROM email_log
UNION ALL SELECT 'audit_log',            count(*) FROM audit_log
UNION ALL SELECT 'packages',             count(*) FROM packages
UNION ALL SELECT '— ҮЛДЭХ: staff_users', count(*) FROM staff_users
UNION ALL SELECT '— ҮЛДЭХ: devices',     count(*) FROM devices
UNION ALL SELECT '— ҮЛДЭХ: lockers',     count(*) FROM lockers
ORDER BY 1;

-- Жинхэнэ гишүүн орчихсон эсэхийг шалгана. 0 байх ЁСТОЙ —
-- 0 биш бол ЗОГС, эдгээр нь терминалаас импортлосон хүмүүс.
SELECT count(*) AS terminalaas_importloson
FROM members WHERE note LIKE '%терминалаас импортлов%';


-- ── 2-Р АЛХАМ: УСТГАХ ───────────────────────────────────────────
-- Дээрх тоог хараад зөвшөөрсний ДАРАА эндээс доошхыг ажиллуулна.
--
-- Бүгд НЭГ гүйлгээнд: дунд нь алдаа гарвал юу ч устахгүй.
-- Дараалал нь хүүхдээс эцэг рүү — cascade-д найдахгүй, ил бичив.

BEGIN;

-- Ирц. ⚠ `access_events.member_id` нь ON DELETE SET NULL тул
-- гишүүнийг устгахад мөр нь ҮЛДДЭГ. Тусад нь устгана.
DELETE FROM access_events;

DELETE FROM reminder_log;

-- Чөлөө. FK байхгүй тул cascade болохгүй.
DELETE FROM freeze_applications;
DELETE FROM freezes;

-- Урамшуулал, бэлгийн карт. Мөн FK-гүй.
DELETE FROM promotion_redemptions;
DELETE FROM gift_cards;

-- Нэхэмжлэх ба хосын суудал.
DELETE FROM invoice_members;
DELETE FROM invoices;

-- Шүүгээний ТҮРЭЭС (шүүгээ өөрөө үлдэнэ).
DELETE FROM locker_assignments;

-- Гишүүнчлэлийн түүх.
DELETE FROM memberships;

-- Гишүүд. Админ нь `staff_users`-д суудаг тул энд хамаарахгүй.
DELETE FROM members;

-- ⚠ ДАРААЛАЛД ҮЛДСЭН АЖИЛ. Эдгээр нь устсан гишүүд рүү заасан
-- `hik.userUpsert` зэрэг ажил. Цэвэрлэхгүй бол терминал руу
-- холбогдмогц ТҮҮХЭН гишүүдийг бичих гэж оролдоно.
DELETE FROM outbox;

DELETE FROM email_log;
DELETE FROM audit_log;

-- Зохиомол багц (одоо ямар ч мөр заагаагүй). Жинхэнэ 13 багцыг
-- `seed:packages:prod` үүсгэнэ.
DELETE FROM packages;

-- Гишүүний дугаарын дараалал.
-- ⚠ Терминалаас импортлосны ДАРАА `import-device.ts` өөрөө
-- хамгийн их дугаараас цааш шилжүүлнэ — энд түр утга.
ALTER SEQUENCE member_no_seq RESTART WITH 1001;

COMMIT;


-- ── 3-Р АЛХАМ: ШАЛГАХ ───────────────────────────────────────────

SELECT 'members' AS huusnegt, count(*) FROM members
UNION ALL SELECT 'invoices',      count(*) FROM invoices
UNION ALL SELECT 'access_events', count(*) FROM access_events
UNION ALL SELECT 'outbox',        count(*) FROM outbox
UNION ALL SELECT 'audit_log',     count(*) FROM audit_log
UNION ALL SELECT 'packages',      count(*) FROM packages
UNION ALL SELECT 'staff_users (ҮЛДЭХ ЁСТОЙ)', count(*) FROM staff_users
ORDER BY 1;

-- Бүгд 0, зөвхөн staff_users нь 1-ээс дээш байх ёстой.
