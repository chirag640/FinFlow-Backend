import { registerDecorator, ValidationArguments, ValidationOptions } from "class-validator";

export function IsDecimalScale(
  maxScale = 2,
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: "isDecimalScale",
      target: object.constructor,
      propertyName,
      constraints: [maxScale],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (value === null || value === undefined) return true;
          if (typeof value !== "number" || !Number.isFinite(value)) return false;
          const [scale] = args.constraints as [number];
          const text = value.toString();
          const decimals = text.includes(".") ? text.split(".")[1].length : 0;
          return decimals <= scale;
        },
        defaultMessage(args: ValidationArguments): string {
          const [scale] = args.constraints as [number];
          return `${args.property} must have at most ${scale} decimal places`;
        },
      },
    });
  };
}
