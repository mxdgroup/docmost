import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  refreshAnalyticsIdentity,
  startAnalyticsListeners,
} from "./docs-analytics";

export function AnalyticsObserver() {
  const { pathname } = useLocation();
  useEffect(startAnalyticsListeners, []);
  useEffect(() => {
    void refreshAnalyticsIdentity(true);
  }, [pathname]);
  return null;
}
