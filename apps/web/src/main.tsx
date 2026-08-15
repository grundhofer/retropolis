// SPDX-FileCopyrightText: 2026 Sebastian Grundhöfer
// SPDX-License-Identifier: AGPL-3.0-or-later

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "./index.css";
import "./i18n.js";
import { BoardPage } from "./pages/BoardPage.js";
import { HomePage } from "./pages/HomePage.js";

const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "/board/:boardId", element: <BoardPage /> },
]);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
