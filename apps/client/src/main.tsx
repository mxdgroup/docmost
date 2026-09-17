import "@mantine/core/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dates/styles.css";
import "@/styles/a11y-overrides.css";

import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { mantineCssResolver, theme } from "@/theme";
import { MantineProvider } from "@mantine/core";
import { BrowserRouter } from "react-router-dom";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import "./i18n";
import { PostHogProvider } from "posthog-js/react";
import { AnalyticsObserver } from "@/features/analytics/analytics-observer";
import posthog from "posthog-js";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const container = document.getElementById("root") as HTMLElement;
const root = ((container as any).__reactRoot ??=
  ReactDOM.createRoot(container));

root.render(
  <BrowserRouter>
    <MantineProvider theme={theme} cssVariablesResolver={mantineCssResolver}>
      <ModalsProvider>
        <QueryClientProvider client={queryClient}>
          <Notifications position="bottom-center" limit={3} zIndex={10000} />
          <HelmetProvider>
            <PostHogProvider client={posthog}>
              <AnalyticsObserver />
              <App />
            </PostHogProvider>
          </HelmetProvider>
        </QueryClientProvider>
      </ModalsProvider>
    </MantineProvider>
  </BrowserRouter>,
);
