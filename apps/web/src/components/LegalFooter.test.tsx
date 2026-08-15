// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import "../i18n.js";
import { LegalFooter } from "./LegalFooter.js";

// AGPL §0 defines the Appropriate Legal Notices that §5(d) makes mandatory for
// an interactive UI: a copyright notice, the fact that recipients may convey
// the work under this licence, the absence of warranty, and how to view the
// licence. §13 adds the source offer. All five are asserted here — this footer
// is the only place the deployed app discharges them.
test("carries the copyright, licence, warranty and source notices", async () => {
  const screen = await render(<LegalFooter />);

  await expect
    .element(screen.getByText(/© 2026 Sebastian Grundhöfer/))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText(/AGPL-3\.0-or-later/))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText(/Redistribution|Weitergabe/))
    .toBeInTheDocument();
  await expect
    .element(screen.getByText(/no warranty|ohne Gewährleistung/))
    .toBeInTheDocument();
  await expect
    .element(screen.getByRole("link", { name: /Source code|Quelltext/ }))
    .toBeInTheDocument();
});

test("both notices resolve into the repository", async () => {
  const screen = await render(<LegalFooter />);
  const links = screen
    .getByTestId("legal-footer")
    .element()
    .querySelectorAll("a");

  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link.getAttribute("href")).toContain(
      "github.com/grundhofer/retropolis",
    );
  }
  expect(links[0]?.getAttribute("href")).toContain("/LICENSE");
});
