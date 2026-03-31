import { describe, expect, it } from "@jest/globals";
import { of } from "rxjs";
import { TransformInterceptor } from "./transform.interceptor";

describe("TransformInterceptor", () => {
  it("wraps payload in data envelope with requestId and timestamp", (done) => {
    const interceptor = new TransformInterceptor<any>();

    const context: any = {
      switchToHttp: () => ({
        getRequest: () => ({ requestId: "req-123" }),
      }),
    };

    const next: any = {
      handle: () => of({ status: "ok" }),
    };

    interceptor.intercept(context, next).subscribe((result) => {
      expect(result).toEqual(
        expect.objectContaining({
          data: { status: "ok" },
          requestId: "req-123",
        }),
      );
      expect(typeof result.timestamp).toBe("string");
      done();
    });
  });
});
