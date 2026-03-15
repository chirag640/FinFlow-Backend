import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { UserDoc } from "../../database/database.types";

/** Injects the authenticated user object (or a specific field) from request. */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: UserDoc & { id?: string } = request.user;
    if (!data) return user;
    // Support both 'id' (alias) and native '_id'
    if (data === "id") return user._id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (user as any)[data];
  },
);
