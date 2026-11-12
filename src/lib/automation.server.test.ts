import { describe, expect, it } from "vitest";
import { reportDate } from "./automation.server";
import { exportAllPdf } from "./report-pdf";

describe("workflow reports for a meeting (S-25)", () => {
  const org = { booksLockedThrough: "2026-10-31", timezone: "America/Chicago" };
  it("picks the date the reports run to", () => {
    expect(reportDate("last_closed_month", null, org)).toBe("2026-10-31");
    expect(reportDate("date", "2026-06-30", org)).toBe("2026-06-30");
    expect(reportDate("today", null, org, new Date("2026-11-12T15:00:00Z"))).toBe("2026-11-12");
    expect(() =>
      reportDate("last_closed_month", null, { ...org, booksLockedThrough: null }),
    ).toThrow(/No month is closed/);
    expect(() => reportDate("date", "", org)).toThrow(/no date is set/);
  });

  it("builds the PDF on the server, without a browser", async () => {
    const blob = await exportAllPdf({
      org: { name: "Riverside", orgType: "nonprofit", currency: "USD", fiscalYearStartMonth: 1 },
      pref: "simplest",
      subtitle: "2026-01-01 to 2026-10-31",
      sheets: [
        {
          name: "Money In & Out",
          rows: [
            ["Dues", 6550.5],
            ["Total", 6550.5],
          ],
        },
      ],
      fileName: "x.pdf",
      output: "blob",
    });
    expect(blob).toBeInstanceOf(Blob);
    const head = new TextDecoder().decode((await blob!.arrayBuffer()).slice(0, 5));
    expect(head).toBe("%PDF-");
  });
});
