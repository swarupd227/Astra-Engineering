import { MonitoringAdapter, DevXMonitoringMetrics, DevXMonitoringEvent } from "../../types/adapters";

export class DatadogAdapter implements MonitoringAdapter {
  private baseUrl: string;
  private apiKey: string;
  private appKey: string;

  constructor(apiKey: string, appKey: string, baseUrl?: string | null) {
    this.apiKey = apiKey;
    this.appKey = appKey;
    this.baseUrl = (baseUrl?.trim() || "https://api.us5.datadoghq.com").replace(/\/+$/, "");
  }

  private async fetchDatadog(endpoint: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        "DD-API-KEY": this.apiKey,
        "DD-APPLICATION-KEY": this.appKey,
        "Accept": "application/json",
      }
    });

    if (!response.ok) {
      throw new Error(`Datadog API Error: ${response.statusText}`);
    }

    return response.json();
  }

  async getMonitoringMetrics(): Promise<DevXMonitoringMetrics> {
    try {
      const notes: string[] = [];
      const fieldSources: Record<string, "live" | "calculated" | "fallback"> = {
        systemState: "live",
        criticalEvents: "live",
      };

      const endTime = Math.floor(Date.now() / 1000);
      const startTime = endTime - (24 * 60 * 60); // 24 hours ago
      const [monitorsRes, sloRes, eventsRes] = await Promise.all([
        this.fetchDatadog("/api/v1/monitor?group_states=alert,warn"),
        this.fetchDatadog("/api/v1/slo"),
        this.fetchDatadog(`/api/v1/events?start=${startTime}&end=${endTime}&priority=normal`),
      ]);

      // 1. Get alert states from Monitors API
      const activeAlerts = monitorsRes || [];
      let systemState: "GREEN" | "YELLOW" | "RED" = "GREEN";

      if (activeAlerts.some((m: any) => m.overall_state === 'Alert')) {
        systemState = "RED";
      } else if (activeAlerts.length > 0) {
        systemState = "YELLOW";
      }

      // 2. Fetch SLOs for overall uptime tracking
      const hasLiveSlo = Array.isArray(sloRes?.data) && sloRes.data.length > 0;
      // Pick the first SLO or fall back when the account has no configured SLOs.
      const uptimePercentage = hasLiveSlo
        ? sloRes?.data?.[0]?.overall_status?.[0]?.status ?? 99.9
        : 99.9;

      if (!hasLiveSlo) {
        notes.push("Service uptime is using a default value because no Datadog SLO is configured.");
        fieldSources.uptimePercentage = "fallback";
      } else {
        fieldSources.uptimePercentage = "live";
      }

      const criticalEvents: DevXMonitoringEvent[] = (eventsRes?.events || [])
        .slice(0, 5) // Grab latest 5
        .map((evt: any) => ({
          id: evt.id.toString(),
          message: evt.title,
          timestamp: new Date(evt.date_happened * 1000).toISOString(),
          severity: evt.alert_type === "error" ? "CRITICAL" : (evt.alert_type === "warning" ? "WARNING" : "INFO")
        }));

      return {
        systemState,
        uptimePercentage,
        criticalEvents,
        metadata: {
          provider: "datadog",
          source: hasLiveSlo ? "live" : "fallback",
          fetchedAt: new Date().toISOString(),
          notes: notes.length > 0 ? notes : undefined,
          fieldSources,
        }
      };
    } catch (error) {
      console.error("Error fetching data from Datadog Adapter: ", error);
      // Provide beautiful fallback data so the dashboard still renders correctly with mock widgets!
      return {
        systemState: "GREEN",
        uptimePercentage: 99.98,
        criticalEvents: [
          {
            id: "DD-99231",
            message: "CPU Usage > 85% on prod-cluster-east",
            timestamp: new Date().toISOString(),
            severity: "WARNING"
          }
        ],
        metadata: {
          provider: "datadog",
          source: "fallback",
          fetchedAt: new Date().toISOString(),
          notes: [
            "Showing fallback monitoring data because the Datadog request failed.",
          ],
          fieldSources: {
            systemState: "fallback",
            uptimePercentage: "fallback",
            criticalEvents: "fallback",
          },
        }
      };
    }
  }
}
