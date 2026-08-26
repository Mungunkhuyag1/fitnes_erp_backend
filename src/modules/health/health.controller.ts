import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/public.decorator';

interface CheckResult {
  ok: boolean;
  detail?: string;
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly config: ConfigService,
  ) {}

  /** Хөнгөн шалгалт — Railway healthcheck энд ханддаг. */
  @Get()
  @ApiOperation({ summary: 'Апп амьд эсэх' })
  root() {
    return {
      status: 'ok',
      service: 'winfit-backend',
      env: this.config.get<string>('env'),
      time: new Date().toISOString(),
    };
  }

  /**
   * Гүнзгий шалгалт — хамаарал бүрийг тусад нь. Аль нэг нь унасан ч 200
   * буцаана (мониторинг өөрөө шийднэ), гэхдээ `ok: false` тодоор харагдана.
   */
  @Get('deep')
  @ApiOperation({ summary: 'Хамаарал бүрийн төлөв' })
  async deep() {
    const checks: Record<string, CheckResult> = {
      database: await this.checkDb(),
    };
    const gateways = this.config.get<Record<string, string>>('gateways') ?? {};
    return {
      status: Object.values(checks).every((c) => c.ok) ? 'ok' : 'degraded',
      checks,
      // Аль gateway stub горимд ажиллаж байгааг ил харуулна — production-д
      // санамсаргүй stub-аар үлдэхээс сэргийлнэ.
      gateways,
      time: new Date().toISOString(),
    };
  }

  private async checkDb(): Promise<CheckResult> {
    try {
      await this.ds.query('SELECT 1');
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
