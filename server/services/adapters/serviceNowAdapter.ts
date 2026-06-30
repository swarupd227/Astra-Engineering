import { OperationsAdapter, DevXOperationsMetrics, DevXOperationsOutage } from "../../types/adapters";

export class ServiceNowAdapter implements OperationsAdapter {
  private baseUrl: string;
  private apiKey: string; // Often an encoded Basic Auth string or OAuth token for ServiceNow

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    this.apiKey = apiKey;
  }

  private async fetchServiceNow(endpoint: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        "Authorization": `Basic ${this.apiKey}`,
        "Accept": "application/json",
      }
    });

    if (!response.ok) {
      throw new Error(`ServiceNow API Error: ${response.statusText}`);
    }

    return response.json();
  }

  private calculateMttrDays(incidents: any[]): number | null {
    const durationsInDays = incidents
      .map((incident: any) => {
        const openedAt = new Date(incident.opened_at ?? "");
        const resolvedAt = new Date(incident.resolved_at ?? incident.closed_at ?? "");

        if (Number.isNaN(openedAt.getTime()) || Number.isNaN(resolvedAt.getTime())) {
          return null;
        }

        const durationMs = resolvedAt.getTime() - openedAt.getTime();
        if (durationMs < 0) {
          return null;
        }

        return durationMs / (1000 * 60 * 60 * 24);
      })
      .filter((value: number | null): value is number => value !== null);

    if (durationsInDays.length === 0) {
      return null;
    }

    const avg = durationsInDays.reduce((sum, value) => sum + value, 0) / durationsInDays.length;
    return Math.round(avg * 10) / 10;
  }

  private getDisplayString(field: any, fallback = ""): string {
    if (typeof field === "string") {
      return field;
    }

    if (field && typeof field === "object") {
      if (typeof field.display_value === "string" && field.display_value.trim()) {
        return field.display_value;
      }

      if (typeof field.value === "string" && field.value.trim()) {
        return field.value;
      }
    }

    return fallback;
  }

  async getOperationsMetrics(): Promise<DevXOperationsMetrics> {
    try {
      const [
        raisedQuery,
        inProgressQuery,
        newOrOpenQuery,
        resolvedQuery,
        mttrIncidentsRes,
        activeOutagesRes,
      ] = await Promise.all([
        this.fetchServiceNow(
          "/api/now/stats/incident?sysparm_query=opened_atONToday@javascript:gs.beginningOfToday()@javascript:gs.endOfToday()&sysparm_count=true"
        ),
        this.fetchServiceNow(
          "/api/now/stats/incident?sysparm_query=state=3^ORstate=4&sysparm_count=true"
        ),
        this.fetchServiceNow(
          "/api/now/stats/incident?sysparm_query=state=1^ORstate=2&sysparm_count=true"
        ),
        this.fetchServiceNow(
          "/api/now/stats/incident?sysparm_query=state=6^ORstate=7^resolved_atONToday@javascript:gs.beginningOfToday()@javascript:gs.endOfToday()&sysparm_count=true"
        ),
        this.fetchServiceNow(
          "/api/now/table/incident?sysparm_query=stateIN6,7^resolved_atISNOTEMPTY^opened_atISNOTEMPTY^ORDERBYDESCresolved_at&sysparm_limit=50&sysparm_fields=number,opened_at,resolved_at,closed_at"
        ),
        this.fetchServiceNow(
          "/api/now/table/incident?sysparm_query=priority=1^state!=6^state!=7&sysparm_limit=50&sysparm_fields=number,short_description,assigned_to,opened_at&sysparm_display_value=all"
        ),
      ]);

      const ticketsRaisedToday = parseInt(raisedQuery?.result?.stats?.count ?? "0");
      const ticketsNewOrOpen = parseInt(newOrOpenQuery?.result?.stats?.count ?? "0");
      const ticketsInProgress = parseInt(inProgressQuery?.result?.stats?.count ?? "0");
      const ticketsResolvedToday = parseInt(resolvedQuery?.result?.stats?.count ?? "0");

      const mttrIncidents = mttrIncidentsRes?.result || [];
      const liveMttrDays = this.calculateMttrDays(mttrIncidents);
      const notes: string[] = [];
      const fieldSources: Record<string, "live" | "calculated" | "fallback"> = {
        ticketsRaisedToday: "live",
        ticketsNewOrOpen: "live",
        ticketsInProgress: "live",
        ticketsResolvedToday: "live",
        activeOutages: "live",
      };

      if (liveMttrDays === null) {
        notes.push("MTTR could not be calculated from ServiceNow because resolved incident timestamps were unavailable.");
        fieldSources.mttrDays = "fallback";
      } else {
        notes.push(`MTTR is calculated from ${mttrIncidents.length} recent resolved ServiceNow incidents.`);
        fieldSources.mttrDays = "calculated";
      }
      notes.push("Raised Today counts incidents opened today. New/Open counts the current backlog in new or open states.");

      const activeOutages: DevXOperationsOutage[] = (activeOutagesRes?.result || []).map((incident: any) => ({
        id: this.getDisplayString(incident.number, "INC0000000"),
        title: this.getDisplayString(incident.short_description, "Unknown Issue"),
        priority: "P1",
        assignedTo: this.getDisplayString(incident.assigned_to, "Unassigned"),
        startedAt: this.getDisplayString(incident.opened_at, new Date().toISOString()),
      }));

      return {
        ticketsRaisedToday,
        ticketsNewOrOpen,
        ticketsInProgress,
        ticketsResolvedToday,
        mttrDays: liveMttrDays ?? 1.5,
        activeOutages,
        metadata: {
          provider: "servicenow",
          source: "live",
          fetchedAt: new Date().toISOString(),
          notes,
          fieldSources,
        }
      };
    } catch (error) {
      console.error("Error fetching data from ServiceNow Adapter: ", error);
      // Provide beautiful fallback data so the dashboard still renders correctly with mock widgets!
      return {
        ticketsRaisedToday: 14,
        ticketsNewOrOpen: 22,
        ticketsInProgress: 22,
        ticketsResolvedToday: 8,
        mttrDays: 1.5,
        activeOutages: [
          {
            id: "INC940231",
            title: "Database latency spike in Production",
            priority: "P1",
            assignedTo: "DBA Team",
            startedAt: new Date().toISOString()
          }
        ],
        metadata: {
          provider: "servicenow",
          source: "fallback",
          fetchedAt: new Date().toISOString(),
          notes: [
            "Showing fallback operations data because the ServiceNow request failed.",
            "MTTR is using a placeholder because live ServiceNow data was unavailable.",
          ],
          fieldSources: {
            ticketsRaisedToday: "fallback",
            ticketsNewOrOpen: "fallback",
            ticketsInProgress: "fallback",
            ticketsResolvedToday: "fallback",
            mttrDays: "fallback",
            activeOutages: "fallback",
          },
        }
      };
    }
  }
}
