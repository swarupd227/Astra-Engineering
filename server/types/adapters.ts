export interface DevXOperationsOutage {
  id: string;
  title: string;
  priority: string;
  assignedTo: string;
  startedAt: string;
}

export interface DevXIntegrationMetadata {
  provider: "datadog" | "servicenow";
  source: "live" | "fallback";
  fetchedAt: string;
  notes?: string[];
  fieldSources?: Record<string, "live" | "calculated" | "fallback">;
}

export interface DevXOperationsMetrics {
  ticketsRaisedToday: number;
  ticketsNewOrOpen: number;
  ticketsInProgress: number;
  ticketsResolvedToday: number;
  mttrDays: number; // Mean Time to Resolution
  activeOutages: DevXOperationsOutage[];
  metadata: DevXIntegrationMetadata;
}

export interface DevXMonitoringEvent {
  id: string;
  message: string;
  timestamp: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
}

export interface DevXMonitoringMetrics {
  systemState: "GREEN" | "YELLOW" | "RED"; // Green = OK, Yellow = Warn, Red = Alert
  uptimePercentage: number;
  criticalEvents: DevXMonitoringEvent[];
  metadata: DevXIntegrationMetadata;
}

export interface OperationsAdapter {
  /**
   * Translates third-party ticket data into standardized DevX Operations Metrics
   */
  getOperationsMetrics(): Promise<DevXOperationsMetrics>;
}

export interface MonitoringAdapter {
  /**
   * Translates third-party monitoring data into standardized DevX System Health Metrics
   */
  getMonitoringMetrics(): Promise<DevXMonitoringMetrics>;
}
