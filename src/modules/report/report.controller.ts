import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  AttendanceQueryDto,
  DateRangeDto,
  TopMembersDto,
  RevenueQueryDto,
} from './dto/report.dto';
import { ReportService, type DashboardRange } from './report.service';

@ApiTags('reports')
@ApiBearerAuth('access-token')
@Controller()
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get('dashboard')
  @ApiQuery({ name: 'range', required: false, enum: ['7d', '30d', '12m'] })
  @ApiOperation({
    summary: 'Нүүр хуудасны бүх хайрцаг — НЭГ дуудлагаар',
  })
  dashboard(@Query('range') range?: DashboardRange) {
    // Танихгүй утга ирвэл ЧИМЭЭГҮЙ анхдагч руу — нүүр хуудас бүхэлдээ
    // хоосорохоос сэргийлнэ (URL-д хуучин утга үлдсэн байж болно).
    const ok: DashboardRange[] = ['7d', '30d', '12m'];
    return this.reports.dashboard(
      ok.includes(range as DashboardRange) ? (range as DashboardRange) : '30d',
    );
  }

  /**
   * ⚠ `dashboard`-аас ТУСДАА дуудлага — зориуд.
   *
   * Авлага нь ХОЁР жагсаалт (заал + йог) бөгөөд ажилтан бүр өдөржин
   * харах зүйл биш. `dashboard` нь аль хэдийн 10 дэд асуулгатай тул
   * үүнийг нэмбэл нүүр хуудас ачаалахад мэдэгдэхүйц удаашрана.
   * Тусдаа байвал нүүр дэлгэц эхлээд гарч, жагсаалт нь дараа нөхнө.
   */
  @Get('reports/receivables')
  @ApiOperation({
    summary: 'Авлагын ЖАГСААЛТ — хэнээс хэдийг авах вэ (заал + йог)',
    description:
      'Заал нь ГИШҮҮНЭЭР нэгтгэгдэнэ, йог нь БҮРТГЭЛЭЭР. Хамгийн ' +
      'ХУУЧИН өр эхэнд. 0₮ мөр (чөлөө, бэлэг) ороогүй.',
  })
  receivables() {
    return this.reports.receivables();
  }

  @Get('reports/summary')
  @ApiOperation({ summary: 'Товч үзүүлэлт (орлого, шинэ гишүүн, ирц)' })
  summary(@Query() q: DateRangeDto) {
    return this.reports.summary(q);
  }

  @Get('reports/revenue')
  @ApiOperation({ summary: 'Орлого — эх сурвалжаар задалсан' })
  revenue(@Query() q: RevenueQueryDto) {
    return this.reports.revenue(q);
  }

  @Get('reports/attendance')
  @ApiOperation({
    summary: 'Ирц / ачаалал',
    description:
      'groupBy=day → өдрийн ИРЦ (өдөрт 1 хүн). hour/weekday → бүх уншуулалт.',
  })
  attendance(@Query() q: AttendanceQueryDto) {
    return this.reports.attendance(q);
  }

  @Get('reports/packages')
  @ApiOperation({ summary: 'Багц тус бүрийн борлуулалт, орлого' })
  packages(@Query() q: DateRangeDto) {
    return this.reports.packages(q);
  }

  @Get('reports/top-members')
  @ApiOperation({ summary: 'Хамгийн олон ирсэн гишүүд' })
  topMembers(@Query() q: TopMembersDto) {
    return this.reports.topMembers(q);
  }

  @Get('reports/members')
  @ApiOperation({ summary: 'Гишүүдийн төлөв ба өсөлт' })
  members(@Query() q: DateRangeDto) {
    return this.reports.members(q);
  }
}
