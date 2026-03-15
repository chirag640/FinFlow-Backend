import { IsString, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class GoogleAuthDto {
  @ApiProperty({
    description: "Google ID token obtained from google_sign_in Flutter package",
  })
  @IsString()
  @IsNotEmpty()
  idToken: string;
}
