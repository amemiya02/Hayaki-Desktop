import "./styles/app.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { useNav } from "./lib/nav";
import { queryClient } from "./lib/queries";

// Development builds expose navigation to the visual test driver (scripts/drive.mjs).
if (import.meta.env.DEV) (window as unknown as { __hayakiNav: typeof useNav }).__hayakiNav = useNav;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
