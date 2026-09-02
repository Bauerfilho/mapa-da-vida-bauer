import { expect, test } from "@playwright/test";
import {
  combineLocalDateAndTime,
  resolveShiftDepartureLocalDateTime,
} from "../src/domain/dates";

test.describe("combineLocalDateAndTime", () => {
  test("combines an explicit date and clock without changing either", () => {
    expect(combineLocalDateAndTime("2026-09-04", "07:00")).toBe(
      "2026-09-04T07:00",
    );
  });

  test("rejects an invalid clock", () => {
    expect(() => combineLocalDateAndTime("2026-09-04", "24:00")).toThrow(
      "Data e hora local inexistentes",
    );
  });
});

test.describe("resolveShiftDepartureLocalDateTime", () => {
  test("places a morning exit on the overnight shift end date", () => {
    expect(
      resolveShiftDepartureLocalDateTime(
        "2026-09-03T19:00:00",
        "2026-09-04T07:00:00",
        "06:45",
      ),
    ).toBe("2026-09-04T06:45");
  });

  test("keeps an early same-evening exit on the overnight shift start date", () => {
    expect(
      resolveShiftDepartureLocalDateTime(
        "2026-09-03T19:00:00",
        "2026-09-04T07:00:00",
        "23:15",
      ),
    ).toBe("2026-09-03T23:15");
  });

  test("anchors a slightly late morning exit to the overnight end date", () => {
    expect(
      resolveShiftDepartureLocalDateTime(
        "2026-09-03T19:00:00",
        "2026-09-04T07:00:00",
        "07:30",
      ),
    ).toBe("2026-09-04T07:30");
  });

  test("keeps a daytime departure on its single calendar date", () => {
    expect(
      resolveShiftDepartureLocalDateTime(
        "2026-09-01T07:00:00",
        "2026-09-01T19:00:00",
        "18:52",
      ),
    ).toBe("2026-09-01T18:52");
  });
});
