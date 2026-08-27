import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SelectProgramDto {
  @ApiProperty({ description: 'Loopy программын ID' })
  @IsUUID()
  programId: string;
}
