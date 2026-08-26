import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/pagination.dto';
import { OutboxStatus } from '../outbox.entity';

export class ListOutboxDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: OutboxStatus })
  @IsOptional()
  @IsEnum(OutboxStatus)
  status?: OutboxStatus;

  @ApiPropertyOptional({ example: 'hik.userUpsert' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  topic?: string;
}
