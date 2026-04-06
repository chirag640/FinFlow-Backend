import { IsInt, Min, Max } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";

export class MonthYearQueryDto {
  @ApiProperty({
    description: "Month (1-12)",
    example: new Date().getMonth() + 1,
    minimum: 1,
    maximum: 12,
  })
  @IsInt()
  @Min(1)
  @Max(12)
  @Transform(({ value }) => parseInt(value))
  month: number = new Date().getMonth() + 1;

  @ApiProperty({
    description: "Year (2000-2100)",
    example: new Date().getFullYear(),
    minimum: 2000,
    maximum: 2100,
  })
  @IsInt()
  @Min(2000)
  @Max(2100)
  @Transform(({ value }) => parseInt(value))
  year: number = new Date().getFullYear();
}
