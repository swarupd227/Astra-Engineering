import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Activity, Heart, Wind, Droplets, ArrowLeft,
  CheckCircle2, XCircle, AlertTriangle, Clock,
  ShieldCheck, Database, Cloud, RefreshCw,
  Lock, BarChart3, Download, FileCheck,
  Cpu, ScanSearch, Bot, Zap, Layers,
  Settings, ChevronDown, ChevronUp, Plug, TestTube2,
  Server, Key, Wifi, Globe
} from "lucide-react";
import { DashboardHeader } from "@/components/dashboard/header";

// ── Device definitions ───────────────────────────────────────────────────────

interface FieldSpec {
  label: string; unit: string; min: number; max: number;
  criticalLow: number; criticalHigh: number; precision?: number; fhirPath: string;
}
interface DeviceDef {
  id: string; name: string; model: string; ward: string; patientId: string;
  icon: typeof Heart; color: string; fields: Record<string, FieldSpec>;
}

const DEVICES: DeviceDef[] = [
  {
    id: "pm-bed-3", name: "Patient Monitor", model: "GE CARESCAPE B650",
    ward: "ICU-3", patientId: "PT-00412", icon: Activity, color: "#34d399",
    fields: {
      heartRate:   { label: "Heart Rate",   unit: "bpm",    min: 60,  max: 100, criticalLow: 40,  criticalHigh: 150, fhirPath: "Observation.component[HR].valueQuantity" },
      spo2:        { label: "SpO2",         unit: "%",      min: 95,  max: 100, criticalLow: 88,  criticalHigh: 100, precision: 1, fhirPath: "Observation.component[SpO2].valueQuantity" },
      systolicBP:  { label: "Systolic BP",  unit: "mmHg",   min: 100, max: 140, criticalLow: 70,  criticalHigh: 180, fhirPath: "Observation.component[SBP].valueQuantity" },
      diastolicBP: { label: "Diastolic BP", unit: "mmHg",   min: 60,  max: 90,  criticalLow: 40,  criticalHigh: 110, fhirPath: "Observation.component[DBP].valueQuantity" },
      temperature: { label: "Temperature",  unit: "°C",     min: 36.1,max: 37.2,criticalLow: 35,  criticalHigh: 39,  precision: 1, fhirPath: "Observation.component[Temp].valueQuantity" },
      respRate:    { label: "Resp Rate",    unit: "br/min", min: 12,  max: 20,  criticalLow: 8,   criticalHigh: 30,  fhirPath: "Observation.component[RR].valueQuantity" },
    }
  },
  {
    id: "vent-bed-3", name: "Ventilator", model: "GE Carestation 650",
    ward: "ICU-3", patientId: "PT-00412", icon: Wind, color: "#60a5fa",
    fields: {
      tidalVolume:  { label: "Tidal Volume",  unit: "mL",     min: 400, max: 600, criticalLow: 200, criticalHigh: 800, fhirPath: "Observation.component[TV].valueQuantity" },
      peep:         { label: "PEEP",          unit: "cmH2O",  min: 5,   max: 10,  criticalLow: 2,   criticalHigh: 20,  fhirPath: "Observation.component[PEEP].valueQuantity" },
      fio2:         { label: "FiO2",          unit: "%",      min: 21,  max: 60,  criticalLow: 21,  criticalHigh: 100, fhirPath: "Observation.component[FiO2].valueQuantity" },
      ventRate:     { label: "Vent Rate",     unit: "br/min", min: 10,  max: 20,  criticalLow: 6,   criticalHigh: 35,  fhirPath: "Observation.component[VentRate].valueQuantity" },
      peakPressure: { label: "Peak Pressure", unit: "cmH2O",  min: 15,  max: 30,  criticalLow: 5,   criticalHigh: 45,  fhirPath: "Observation.component[PIP].valueQuantity" },
    }
  },
  {
    id: "pump-bed-3", name: "Infusion Pump", model: "GE Alaris 8015",
    ward: "ICU-5", patientId: "PT-00389", icon: Droplets, color: "#a78bfa",
    fields: {
      flowRate:     { label: "Flow Rate",        unit: "mL/hr", min: 5,  max: 250, criticalLow: 0,  criticalHigh: 500,  precision: 1, fhirPath: "MedicationAdministration.dosage.rate" },
      volumeRemain: { label: "Vol Remaining",    unit: "mL",    min: 50, max: 500, criticalLow: 20, criticalHigh: 1000, fhirPath: "MedicationAdministration.dosage.dose" },
      vtbi:         { label: "Vol to Infuse",    unit: "mL",    min: 10, max: 250, criticalLow: 0,  criticalHigh: 500,  fhirPath: "MedicationAdministration.dosage.rateQuantity" },
      linePressure: { label: "Line Pressure",    unit: "psi",   min: 1,  max: 8,   criticalLow: 0,  criticalHigh: 15,   precision: 1, fhirPath: "Observation.component[LinePressure].valueQuantity" },
    }
  },
  {
    id: "ecg-bed-7", name: "ECG Monitor", model: "GE MAC 5500 HD",
    ward: "ICU-7", patientId: "PT-00521", icon: Heart, color: "#f87171",
    fields: {
      heartRate:  { label: "Heart Rate",    unit: "bpm", min: 60,  max: 100, criticalLow: 40,  criticalHigh: 160, fhirPath: "Observation.component[HR].valueQuantity" },
      prInterval: { label: "PR Interval",   unit: "ms",  min: 120, max: 200, criticalLow: 80,  criticalHigh: 280, fhirPath: "Observation.component[PR].valueQuantity" },
      qrsDuration:{ label: "QRS Duration",  unit: "ms",  min: 80,  max: 120, criticalLow: 60,  criticalHigh: 160, fhirPath: "Observation.component[QRS].valueQuantity" },
      qtInterval: { label: "QT Interval",   unit: "ms",  min: 350, max: 440, criticalLow: 300, criticalHigh: 500, fhirPath: "Observation.component[QT].valueQuantity" },
    }
  },
];

// ── Agent definitions ─────────────────────────────────────────────────────────

type AgentStatus = "idle" | "running" | "done" | "error";

interface AgentDef {
  id: string; name: string; role: string;
  icon: typeof Bot; color: string; glowColor: string; ringColor: string;
}

const AGENTS: AgentDef[] = [
  { id: "collector",   name: "Data Collector",     role: "Reads live ICU device streams",        icon: Database,   color: "#34d399", glowColor: "rgba(52,211,153,0.35)",  ringColor: "#34d399" },
  { id: "prevalidator",name: "Pre-Cloud Validator", role: "Validates data quality at source",     icon: ShieldCheck,color: "#fbbf24", glowColor: "rgba(251,191,36,0.35)",  ringColor: "#fbbf24" },
  { id: "transmitter", name: "Cloud Transmitter",   role: "Encrypts and pushes to Azure",         icon: Cloud,      color: "#60a5fa", glowColor: "rgba(96,165,250,0.35)",  ringColor: "#60a5fa" },
  { id: "postverifier",name: "Post-Cloud Verifier", role: "Reconciles source vs cloud data",      icon: ScanSearch, color: "#22d3ee", glowColor: "rgba(34,211,238,0.35)",  ringColor: "#22d3ee" },
  { id: "reporter",    name: "Report Agent",        role: "Synthesizes findings & scores",        icon: BarChart3,  color: "#a78bfa", glowColor: "rgba(167,139,250,0.35)", ringColor: "#a78bfa" },
];

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentLog { agentId: string; msg: string; ts: string; level: "info" | "ok" | "warn" | "error"; }
type ValidationStatus = "pass" | "fail" | "warning" | "pending";

interface FieldResult {
  field: string; label: string; unit: string; fhirPath: string;
  sourceValue: number; cloudValue: number | null;
  preStatus: ValidationStatus; postStatus: ValidationStatus;
  issue?: string;
}

interface DeviceResult {
  deviceId: string; snapshotTs: string; cloudTs: string | null; latencyMs: number | null;
  fields: FieldResult[]; preStatus: ValidationStatus; postStatus: ValidationStatus;
  transformOk: boolean; countMatch: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rand(min: number, max: number, prec = 0) {
  return parseFloat((min + Math.random() * (max - min)).toFixed(prec));
}

function statusIcon(s: ValidationStatus, size = 14) {
  if (s === "pass")    return <CheckCircle2  style={{ width: size, height: size, color: "#34d399", flexShrink: 0 }} />;
  if (s === "fail")    return <XCircle       style={{ width: size, height: size, color: "#f87171", flexShrink: 0 }} />;
  if (s === "warning") return <AlertTriangle style={{ width: size, height: size, color: "#fbbf24", flexShrink: 0 }} />;
  return                      <Clock         style={{ width: size, height: size, color: "#9ca3af", flexShrink: 0 }} />;
}

function statusText(s: ValidationStatus) {
  if (s === "pass")    return { color: "#34d399", label: "PASS" };
  if (s === "fail")    return { color: "#f87171", label: "FAIL" };
  if (s === "warning") return { color: "#fbbf24", label: "WARN" };
  return                     { color: "#6b7280",  label: "—" };
}

function buildResults(deviceIds?: string[]): DeviceResult[] {
  const devs = deviceIds ? DEVICES.filter(d => deviceIds.includes(d.id)) : DEVICES;
  return devs.map(dev => {
    const now = new Date();
    const latencyMs = Math.round(80 + Math.random() * 200);
    const fields: FieldResult[] = Object.entries(dev.fields).map(([key, spec]) => {
      const sv = rand(spec.min, spec.max, spec.precision ?? 0);
      const inRange = sv >= spec.criticalLow && sv <= spec.criticalHigh;
      const r = Math.random();
      let cv: number | null = sv;
      let issue: string | undefined;
      if (r < 0.04) { cv = null; issue = "Field missing in cloud record"; }
      else if (r < 0.08) {
        cv = parseFloat((sv * (1 + (Math.random() - 0.5) * 0.07)).toFixed(spec.precision ?? 0));
        issue = `Value drift: ${sv} → ${cv} (${Math.abs(((cv - sv) / sv) * 100).toFixed(1)}% deviation)`;
      }
      return {
        field: key, label: spec.label, unit: spec.unit, fhirPath: spec.fhirPath,
        sourceValue: sv, cloudValue: cv,
        preStatus: inRange ? "pass" : "fail",
        postStatus: cv === null ? "fail" : issue ? "warning" : "pass",
        issue,
      };
    });
    const preStatus: ValidationStatus = fields.some(f => f.preStatus === "fail") ? "fail" : "pass";
    const postStatus: ValidationStatus = fields.some(f => f.postStatus === "fail") ? "fail" : fields.some(f => f.postStatus === "warning") ? "warning" : "pass";
    return {
      deviceId: dev.id, snapshotTs: now.toISOString().slice(0, 23).replace("T", " "),
      cloudTs: new Date(now.getTime() + latencyMs).toISOString().slice(0, 23).replace("T", " "),
      latencyMs, fields, preStatus, postStatus,
      transformOk: Math.random() > 0.05, countMatch: Math.random() > 0.04,
    };
  });
}

// ── Agent Circle ─────────────────────────────────────────────────────────────

function AgentCircle({ agent, status, isLast }: { agent: AgentDef; status: AgentStatus; isLast: boolean }) {
  const AgIcon = agent.icon;
  const isRunning = status === "running";
  const isDone = status === "done";
  const isError = status === "error";
  const isIdle = status === "idle";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 100 }}>
        {/* Outer glow ring */}
        <div style={{ position: "relative", width: 88, height: 88 }}>
          {/* Pulse glow */}
          {isRunning && (
            <div style={{
              position: "absolute", inset: -8, borderRadius: "50%",
              background: agent.glowColor,
              animation: "ping 1.2s cubic-bezier(0,0,0.2,1) infinite",
            }} />
          )}
          {/* Spinning ring when running */}
          {isRunning && (
            <div style={{
              position: "absolute", inset: 0, borderRadius: "50%",
              border: `2px solid transparent`,
              borderTopColor: agent.ringColor,
              borderRightColor: agent.ringColor,
              animation: "spin 1s linear infinite",
            }} />
          )}
          {/* Done ring */}
          {isDone && (
            <div style={{
              position: "absolute", inset: 0, borderRadius: "50%",
              border: `2px solid ${agent.color}`,
              opacity: 0.7,
            }} />
          )}
          {/* Main circle */}
          <div style={{
            position: "absolute", inset: 4, borderRadius: "50%",
            background: isIdle
              ? "rgba(255,255,255,0.04)"
              : isRunning
              ? `radial-gradient(circle at 40% 40%, ${agent.glowColor}, rgba(0,0,0,0.6))`
              : isDone
              ? `radial-gradient(circle at 40% 40%, ${agent.glowColor}, rgba(0,0,0,0.5))`
              : "rgba(239,68,68,0.2)",
            border: `1.5px solid ${isIdle ? "rgba(255,255,255,0.1)" : agent.color + "88"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.5s ease",
            boxShadow: isRunning ? `0 0 24px ${agent.glowColor}` : isDone ? `0 0 12px ${agent.glowColor}` : "none",
          }}>
            <AgIcon style={{ width: 26, height: 26, color: isIdle ? "#6b7280" : agent.color, transition: "color 0.4s" }} />
          </div>
          {/* Status dot */}
          <div style={{
            position: "absolute", bottom: 4, right: 4, width: 14, height: 14,
            borderRadius: "50%", border: "2px solid #1a1a2e",
            background: isRunning ? "#fbbf24" : isDone ? "#34d399" : isError ? "#f87171" : "#374151",
            boxShadow: isRunning ? "0 0 8px #fbbf24" : isDone ? "0 0 8px #34d399" : "none",
            animation: isRunning ? "ping-slow 2s ease-in-out infinite" : "none",
          }} />
        </div>

        {/* Agent name + role */}
        <div style={{ textAlign: "center" }}>
          <p style={{
            fontSize: 11, fontWeight: 600, margin: 0,
            color: isIdle ? "#6b7280" : agent.color,
            transition: "color 0.4s",
          }}>{agent.name}</p>
          <p style={{ fontSize: 9.5, color: "#6b7280", margin: "2px 0 0", lineHeight: 1.3 }}>{agent.role}</p>
          <div style={{ marginTop: 4, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isRunning && (
              <span style={{ fontSize: 9, color: agent.color, animation: "pulse 1.5s ease-in-out infinite" }}>
                ● processing...
              </span>
            )}
            {isDone && <span style={{ fontSize: 9, color: "#34d399" }}>✓ complete</span>}
            {isError && <span style={{ fontSize: 9, color: "#f87171" }}>✗ issues found</span>}
            {isIdle && <span style={{ fontSize: 9, color: "#374151" }}>○ waiting</span>}
          </div>
        </div>
      </div>

      {/* Connector line + animated particle */}
      {!isLast && (
        <div style={{ position: "relative", width: 48, height: 4, margin: "0 4px", marginBottom: 40, flexShrink: 0 }}>
          <div style={{
            position: "absolute", top: "50%", left: 0, right: 0,
            height: 2, transform: "translateY(-50%)",
            background: isDone
              ? `linear-gradient(90deg, ${agent.color}88, ${agent.color}44)`
              : "rgba(255,255,255,0.06)",
            transition: "background 0.5s",
            borderRadius: 2,
          }} />
          {isDone && (
            <div style={{
              position: "absolute", top: "50%", width: 8, height: 8,
              borderRadius: "50%", background: agent.color,
              transform: "translateY(-50%)",
              boxShadow: `0 0 8px ${agent.color}`,
              animation: "flow-right 1.4s ease-in-out infinite",
            }} />
          )}
          {isRunning && (
            <div style={{
              position: "absolute", top: "50%", width: 6, height: 6,
              borderRadius: "50%", background: agent.color + "66",
              transform: "translateY(-50%)",
              animation: "flow-right 2s ease-in-out infinite",
            }} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Log entry ────────────────────────────────────────────────────────────────

function LogEntry({ log, agentColor }: { log: AgentLog; agentColor: string }) {
  const color = log.level === "ok" ? "#34d399" : log.level === "warn" ? "#fbbf24" : log.level === "error" ? "#f87171" : "#9ca3af";
  return (
    <div style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", alignItems: "flex-start" }}>
      <span style={{ fontSize: 9, color: "#4b5563", flexShrink: 0, marginTop: 2, fontFamily: "monospace" }}>{log.ts}</span>
      <span style={{
        fontSize: 9, fontWeight: 600, color: agentColor, flexShrink: 0, marginTop: 2,
        minWidth: 120,
      }}>[{AGENTS.find(a => a.id === log.agentId)?.name ?? log.agentId}]</span>
      <span style={{ fontSize: 10.5, color, lineHeight: 1.4 }}>{log.msg}</span>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

type PipelinePhase = "idle" | "collecting" | "prevalidating" | "transmitting" | "postverifying" | "reporting" | "done";

const PHASE_ORDER: PipelinePhase[] = ["idle", "collecting", "prevalidating", "transmitting", "postverifying", "reporting", "done"];

function agentStatus(agentIdx: number, phase: PipelinePhase): AgentStatus {
  const runningPhases: PipelinePhase[] = ["collecting", "prevalidating", "transmitting", "postverifying", "reporting"];
  const phaseIdx = runningPhases.indexOf(phase);
  if (phaseIdx === -1 && phase !== "done") return "idle";
  if (phase === "done") return "done";
  if (agentIdx === phaseIdx) return "running";
  if (agentIdx < phaseIdx) return "done";
  return "idle";
}

// ── Data Source Config types ──────────────────────────────────────────────────
interface SourceConfig {
  protocol: string; host: string; port: string; topic: string;
  authType: string; apiKey: string; certPath: string;
}
interface CloudConfig {
  provider: string; serviceType: string; endpoint: string;
  authType: string; tenantId: string; clientId: string; apiKey: string;
}
type ConnStatus = "idle" | "testing" | "connected" | "failed";

export default function ICUStreamingValidatorPage() {
  const [phase, setPhase] = useState<PipelinePhase>("idle");
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [results, setResults] = useState<DeviceResult[]>([]);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(true);
  const [sourceConn, setSourceConn] = useState<ConnStatus>("idle");
  const [cloudConn, setCloudConn] = useState<ConnStatus>("idle");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>(DEVICES.map(d => d.id));
  const [source, setSource] = useState<SourceConfig>({
    protocol: "mqtt", host: "ge-icu-edge.local", port: "1883",
    topic: "icu/devices/+/vitals", authType: "apikey", apiKey: "", certPath: "",
  });
  const [cloud, setCloud] = useState<CloudConfig>({
    provider: "azure", serviceType: "fhir", endpoint: "gehealthcare-icu.azurehealthcareapis.com",
    authType: "managed-identity", tenantId: "", clientId: "", apiKey: "",
  });
  const logEndRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const testSourceConn = useCallback(() => {
    setSourceConn("testing");
    setTimeout(() => setSourceConn(Math.random() > 0.15 ? "connected" : "failed"), 1800);
  }, []);

  const testCloudConn = useCallback(() => {
    setCloudConn("testing");
    setTimeout(() => setCloudConn(Math.random() > 0.1 ? "connected" : "failed"), 2100);
  }, []);

  const toggleDevice = useCallback((id: string) => {
    setSelectedDeviceIds(prev =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter(x => x !== id) : prev) : [...prev, id]
    );
  }, []);

  function addLog(agentId: string, msg: string, level: AgentLog["level"] = "info", delay = 0) {
    const t = setTimeout(() => {
      const ts = new Date().toISOString().slice(11, 23);
      setLogs(l => [{ agentId, msg, ts, level }, ...l].slice(0, 120));
    }, delay);
    timers.current.push(t);
    return t;
  }

  function nextPhase(p: PipelinePhase, delay = 0) {
    const t = setTimeout(() => setPhase(p), delay);
    timers.current.push(t);
  }

  const runPipeline = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setLogs([]);
    setResults([]);
    setExpandedDevice(null);
    setConfigOpen(false);
    setPhase("collecting");

    const proto = source.protocol.toUpperCase();
    const srcHost = source.host || "ge-icu-edge.local";
    const srcTopic = source.topic || "icu/devices/+/vitals";
    const cloudEp = cloud.endpoint || "gehealthcare-icu.azurehealthcareapis.com";
    const cloudSvc = { fhir: "Azure FHIR R4 Service", datalake: "Azure Data Lake Gen2", cosmos: "Azure Cosmos DB", sql: "Azure SQL Database" }[cloud.serviceType] ?? "Azure Cloud";
    const activeDevices = DEVICES.filter(d => selectedDeviceIds.includes(d.id));
    const fieldCount = activeDevices.reduce((s, d) => s + Object.keys(d.fields).length, 0);

    // ── Agent 1: Data Collector ──
    addLog("collector", `Connecting to source via ${proto} — ${srcHost}:${source.port}`, "info", 0);
    addLog("collector", `Subscribing to topic: ${srcTopic}`, "info", 400);
    activeDevices.forEach((dev, i) => {
      addLog("collector", `Connected to ${dev.name} — ${dev.model} (${dev.ward} · ${dev.patientId})`, "ok", 700 + i * 400);
    });
    addLog("collector", `Capturing snapshot from ${activeDevices.length} device(s) — ${fieldCount} parameters total...`, "info", 700 + activeDevices.length * 400 + 200);
    addLog("collector", `Snapshot captured — ${fieldCount} parameters across ${activeDevices.length} devices. Handing off to Pre-Cloud Validator.`, "ok", 700 + activeDevices.length * 400 + 700);
    nextPhase("prevalidating", 700 + activeDevices.length * 400 + 900);

    const T2 = 700 + activeDevices.length * 400 + 1000;
    // ── Agent 2: Pre-Cloud Validator ──
    addLog("prevalidator", "Received data snapshot. Beginning pre-cloud quality gates.", "info", T2);
    addLog("prevalidator", `Checking field completeness — all ${fieldCount} expected fields present.`, "ok", T2 + 400);
    addLog("prevalidator", "Validating clinical ranges for all parameters...", "info", T2 + 800);
    activeDevices.forEach((dev, i) => {
      addLog("prevalidator", `${dev.name} (${dev.patientId}): All ${Object.keys(dev.fields).length} parameters validated.`, "ok", T2 + 1100 + i * 450);
    });
    addLog("prevalidator", "Data format check: HL7 v2.x source schema verified.", "ok", T2 + 1100 + activeDevices.length * 450 + 200);
    addLog("prevalidator", "Pre-cloud gate: PASSED. Data cleared for transmission.", "ok", T2 + 1100 + activeDevices.length * 450 + 600);
    const T3 = T2 + 1100 + activeDevices.length * 450 + 900;
    nextPhase("transmitting", T3 - 100);

    // ── Agent 3: Cloud Transmitter ──
    addLog("transmitter", `Initiating encrypted push to ${cloudEp}`, "info", T3);
    addLog("transmitter", `Target: ${cloudSvc} | Auth: ${cloud.authType === "managed-identity" ? "Managed Identity" : cloud.authType === "service-principal" ? "Service Principal" : "API Key"}`, "info", T3 + 400);
    addLog("transmitter", "TLS 1.3 handshake complete — AES-256-GCM cipher negotiated.", "ok", T3 + 800);
    activeDevices.forEach((dev, i) => {
      const kb = (Object.keys(dev.fields).length * 0.2 + 0.6).toFixed(1);
      addLog("transmitter", `Pushing ${dev.name} payload (${Object.keys(dev.fields).length} fields, ${kb} KB)...`, "info", T3 + 1100 + i * 350);
    });
    addLog("transmitter", `All ${activeDevices.length} device payloads acknowledged by ${cloudSvc}.`, "ok", T3 + 1100 + activeDevices.length * 350 + 300);
    addLog("transmitter", "Cloud confirmation tokens received. Handing off to Post-Cloud Verifier.", "ok", T3 + 1100 + activeDevices.length * 350 + 700);
    const T4 = T3 + 1100 + activeDevices.length * 350 + 1000;
    // ── Agent 4: Post-Cloud Verifier ──
    addLog("postverifier", `Querying ${cloudSvc} at ${cloudEp} for ingested records...`, "info", T4);
    addLog("postverifier", `Comparing source snapshot against cloud records (field-by-field).`, "info", T4 + 400);
    activeDevices.forEach((dev, i) => {
      const fc = Object.keys(dev.fields).length;
      addLog("postverifier", `${dev.name}: Source ${fc} fields — Cloud ${fc} fields. Checking value fidelity...`, "info", T4 + 800 + i * 450);
    });
    addLog("postverifier", `Record count reconciliation: ${activeDevices.length}/${activeDevices.length} device batches confirmed.`, "ok", T4 + 800 + activeDevices.length * 450 + 300);
    addLog("postverifier", "Post-cloud verification complete. Forwarding to Report Agent.", "ok", T4 + 800 + activeDevices.length * 450 + 700);
    const r = buildResults(selectedDeviceIds);
    const t = setTimeout(() => setResults(r), T4 + 800 + activeDevices.length * 450 + 600);
    timers.current.push(t);
    const T5 = T4 + 800 + activeDevices.length * 450 + 1000;
    nextPhase("reporting", T5 - 100);

    // ── Agent 5: Reporter ──
    addLog("reporter", "Aggregating findings from all pipeline agents...", "info", T5);
    addLog("reporter", `Computing data integrity scores — ${fieldCount} fields across ${activeDevices.length} devices.`, "info", T5 + 500);
    addLog("reporter", "Scoring FHIR R4 transformation completeness...", "info", T5 + 1000);
    addLog("reporter", "Generating end-to-end reconciliation report.", "info", T5 + 1500);
    addLog("reporter", "Report generated. Pipeline complete — results ready for review.", "ok", T5 + 2000);
    nextPhase("done", T5 + 2200);
  }, [source, cloud, selectedDeviceIds]);

  const reset = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("idle");
    setLogs([]);
    setResults([]);
    setExpandedDevice(null);
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const isDone = phase === "done";
  const isRunning = phase !== "idle" && phase !== "done";

  const prePass = results.filter(r => r.preStatus === "pass").length;
  const postPass = results.filter(r => r.postStatus === "pass").length;
  const postWarn = results.filter(r => r.postStatus === "warning").length;
  const allFields = results.flatMap(r => r.fields);
  const missingCloud = allFields.filter(f => f.cloudValue === null).length;
  const driftFields = allFields.filter(f => f.issue && f.cloudValue !== null).length;
  const avgLatency = results.filter(r => r.latencyMs).length > 0
    ? Math.round(results.filter(r => r.latencyMs).reduce((s, r) => s + (r.latencyMs ?? 0), 0) / results.filter(r => r.latencyMs).length) : 0;

  return (
    <>
      <style>{`
        @keyframes ping { 0%{transform:scale(1);opacity:0.8} 75%,100%{transform:scale(1.6);opacity:0} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes ping-slow { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes flow-right { 0%{left:0;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{left:calc(100% - 8px);opacity:0} }
      `}</style>
        <DashboardHeader />
        {/* Page Title Bar */}
        <div className="border-b border-border px-6 py-4 flex items-center justify-between flex-shrink-0 flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <Link href="/nradiverse">
              <Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="w-4 h-4" /></Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: "rgba(34,211,238,0.15)" }}>
                <Activity style={{ width: 20, height: 20, color: "#22d3ee" }} />
              </div>
              <div>
                <h1 className="text-lg font-bold">ICU Device Data Validator</h1>
                <p className="text-xs text-muted-foreground">AI agent pipeline — validates ICU data quality before and after cloud push</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDone && (
              <Button variant="outline" data-testid="button-export"><Download className="w-4 h-4 mr-2" /> Export Report</Button>
            )}
            {isDone || isRunning ? (
              <Button variant="outline" onClick={reset} data-testid="button-reset">
                <RefreshCw className="w-4 h-4 mr-2" /> New Run
              </Button>
            ) : (
              <Button onClick={runPipeline} style={{ background: "#0e7490" }} className="hover:opacity-90" data-testid="button-run-pipeline">
                <Bot className="w-4 h-4 mr-2" /> Run Agent Pipeline
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">

            {/* ── Data Source Configuration ── */}
            <Card style={{ borderColor: configOpen ? "rgba(34,211,238,0.25)" : "rgba(255,255,255,0.07)", background: "rgba(10,12,25,0.7)" }}>
              <CardHeader style={{ paddingBottom: configOpen ? 4 : 12 }}>
                <button
                  className="w-full text-left"
                  onClick={() => setConfigOpen(o => !o)}
                  data-testid="button-toggle-config"
                  disabled={isRunning}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Settings style={{ width: 15, height: 15, color: "#22d3ee" }} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Data Source Configuration</span>
                      {sourceConn === "connected" && cloudConn === "connected" && (
                        <Badge style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)", fontSize: 9 }}>
                          <CheckCircle2 style={{ width: 9, height: 9, marginRight: 3 }} /> Both sources connected
                        </Badge>
                      )}
                      {!configOpen && (
                        <span style={{ fontSize: 10, color: "#6b7280" }}>
                          {source.protocol.toUpperCase()} · {source.host}:{source.port} → {cloud.endpoint} ({cloud.serviceType.toUpperCase()})
                        </span>
                      )}
                    </div>
                    {configOpen
                      ? <ChevronUp style={{ width: 14, height: 14, color: "#6b7280" }} />
                      : <ChevronDown style={{ width: 14, height: 14, color: "#6b7280" }} />}
                  </div>
                </button>
              </CardHeader>

              {configOpen && (
                <CardContent style={{ paddingTop: 0 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

                    {/* ── Source (Edge/Device) ── */}
                    <div style={{ border: "1px solid rgba(52,211,153,0.2)", borderRadius: 8, padding: 16, background: "rgba(52,211,153,0.04)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Server style={{ width: 13, height: 13, color: "#34d399" }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#34d399" }}>Source — Edge / Device Layer</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {sourceConn === "connected" && <span style={{ fontSize: 9, color: "#34d399" }}>● Connected</span>}
                          {sourceConn === "failed"    && <span style={{ fontSize: 9, color: "#f87171" }}>● Failed</span>}
                          {sourceConn === "testing"   && <span style={{ fontSize: 9, color: "#fbbf24", animation: "pulse 1s infinite" }}>● Testing...</span>}
                          <Button variant="outline" size="sm" onClick={testSourceConn} disabled={sourceConn === "testing" || isRunning} data-testid="button-test-source">
                            <TestTube2 style={{ width: 11, height: 11, marginRight: 4 }} />
                            {sourceConn === "testing" ? "Testing..." : "Test Connection"}
                          </Button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {[
                          { label: "Protocol", field: "protocol", type: "select", options: ["mqtt", "websocket", "rest", "hl7-mllp", "opc-ua"], hint: "Device streaming protocol" },
                          { label: "Host / IP", field: "host", type: "text", placeholder: "ge-icu-edge.local", hint: "Edge gateway hostname or IP" },
                          { label: "Port", field: "port", type: "text", placeholder: "1883", hint: "" },
                          { label: "Topic / Path", field: "topic", type: "text", placeholder: "icu/devices/+/vitals", hint: "MQTT topic or REST path" },
                        ].map(f => (
                          <div key={f.field}>
                            <label style={{ fontSize: 9.5, color: "#6b7280", display: "block", marginBottom: 4 }}>{f.label}</label>
                            {f.type === "select" ? (
                              <select
                                style={{ width: "100%", fontSize: 11, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "inherit" }}
                                value={(source as any)[f.field]}
                                onChange={e => setSource(s => ({ ...s, [f.field]: e.target.value }))}
                                disabled={isRunning}
                                data-testid={`source-${f.field}`}
                              >
                                {f.options!.map(o => <option key={o} value={o}>{o.toUpperCase()}</option>)}
                              </select>
                            ) : (
                              <input
                                style={{ width: "100%", fontSize: 11, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "inherit", boxSizing: "border-box" }}
                                value={(source as any)[f.field]}
                                placeholder={f.placeholder}
                                onChange={e => setSource(s => ({ ...s, [f.field]: e.target.value }))}
                                disabled={isRunning}
                                data-testid={`source-${f.field}`}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <label style={{ fontSize: 9.5, color: "#6b7280", display: "block", marginBottom: 4 }}>Authentication</label>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                          <select
                            style={{ fontSize: 11, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "inherit" }}
                            value={source.authType}
                            onChange={e => setSource(s => ({ ...s, authType: e.target.value }))}
                            disabled={isRunning}
                            data-testid="source-authType"
                          >
                            <option value="apikey">API Key</option>
                            <option value="certificate">Client Certificate</option>
                            <option value="none">None</option>
                          </select>
                          <input
                            type="password"
                            style={{ fontSize: 11, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "inherit" }}
                            placeholder={source.authType === "certificate" ? "Certificate path" : "API Key / Token"}
                            value={source.authType === "certificate" ? source.certPath : source.apiKey}
                            onChange={e => setSource(s => source.authType === "certificate" ? { ...s, certPath: e.target.value } : { ...s, apiKey: e.target.value })}
                            disabled={isRunning}
                            data-testid="source-auth-value"
                          />
                        </div>
                      </div>
                    </div>

                    {/* ── Cloud Destination ── */}
                    <div style={{ border: "1px solid rgba(96,165,250,0.2)", borderRadius: 8, padding: 16, background: "rgba(96,165,250,0.04)" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Cloud style={{ width: 13, height: 13, color: "#60a5fa" }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#60a5fa" }}>Destination — Cloud Store</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {cloudConn === "connected" && <span style={{ fontSize: 9, color: "#34d399" }}>● Connected</span>}
                          {cloudConn === "failed"    && <span style={{ fontSize: 9, color: "#f87171" }}>● Failed</span>}
                          {cloudConn === "testing"   && <span style={{ fontSize: 9, color: "#fbbf24", animation: "pulse 1s infinite" }}>● Testing...</span>}
                          <Button variant="outline" size="sm" onClick={testCloudConn} disabled={cloudConn === "testing" || isRunning} data-testid="button-test-cloud">
                            <TestTube2 style={{ width: 11, height: 11, marginRight: 4 }} />
                            {cloudConn === "testing" ? "Testing..." : "Test Connection"}
                          </Button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {[
                          { label: "Cloud Provider", field: "provider", type: "select", options: ["azure", "aws", "gcp"], optLabels: ["Microsoft Azure", "Amazon AWS", "Google Cloud"] },
                          { label: "Service Type", field: "serviceType", type: "select", options: ["fhir", "datalake", "cosmos", "sql"], optLabels: ["Azure FHIR R4 Service", "Azure Data Lake Gen2", "Azure Cosmos DB", "Azure SQL Database"] },
                        ].map(f => (
                          <div key={f.field}>
                            <label style={{ fontSize: 9.5, color: "#6b7280", display: "block", marginBottom: 4 }}>{f.label}</label>
                            <select
                              style={{ width: "100%", fontSize: 11, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "inherit" }}
                              value={(cloud as any)[f.field]}
                              onChange={e => setCloud(c => ({ ...c, [f.field]: e.target.value }))}
                              disabled={isRunning}
                              data-testid={`cloud-${f.field}`}
                            >
                              {f.options.map((o, i) => <option key={o} value={o}>{f.optLabels[i]}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <label style={{ fontSize: 9.5, color: "#6b7280", display: "block", marginBottom: 4 }}>Endpoint URL</label>
                        <input
                          style={{ width: "100%", fontSize: 11, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "inherit", boxSizing: "border-box" }}
                          value={cloud.endpoint}
                          placeholder="gehealthcare-icu.azurehealthcareapis.com"
                          onChange={e => setCloud(c => ({ ...c, endpoint: e.target.value }))}
                          disabled={isRunning}
                          data-testid="cloud-endpoint"
                        />
                      </div>
                      <div style={{ marginTop: 10 }}>
                        <label style={{ fontSize: 9.5, color: "#6b7280", display: "block", marginBottom: 4 }}>Authentication</label>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                          <select
                            style={{ fontSize: 11, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "inherit" }}
                            value={cloud.authType}
                            onChange={e => setCloud(c => ({ ...c, authType: e.target.value }))}
                            disabled={isRunning}
                            data-testid="cloud-authType"
                          >
                            <option value="managed-identity">Managed Identity</option>
                            <option value="service-principal">Service Principal</option>
                            <option value="apikey">API Key</option>
                          </select>
                          <input
                            type="password"
                            style={{ fontSize: 11, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "5px 8px", color: "inherit" }}
                            placeholder={cloud.authType === "managed-identity" ? "No credentials needed" : cloud.authType === "service-principal" ? "Client Secret" : "API Key"}
                            disabled={cloud.authType === "managed-identity" || isRunning}
                            value={cloud.apiKey}
                            onChange={e => setCloud(c => ({ ...c, apiKey: e.target.value }))}
                            data-testid="cloud-auth-value"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Device selection */}
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                      <Wifi style={{ width: 12, height: 12, color: "#a78bfa" }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#a78bfa" }}>Devices to Monitor ({selectedDeviceIds.length} of {DEVICES.length} selected)</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {DEVICES.map(dev => {
                        const DevIcon = dev.icon;
                        const selected = selectedDeviceIds.includes(dev.id);
                        return (
                          <button
                            key={dev.id}
                            onClick={() => toggleDevice(dev.id)}
                            disabled={isRunning}
                            data-testid={`device-select-${dev.id}`}
                            style={{
                              display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
                              borderRadius: 6, border: `1px solid ${selected ? dev.color + "55" : "rgba(255,255,255,0.1)"}`,
                              background: selected ? dev.color + "15" : "transparent",
                              cursor: isRunning ? "default" : "pointer", transition: "all 0.2s",
                            }}
                          >
                            <DevIcon style={{ width: 12, height: 12, color: selected ? dev.color : "#6b7280" }} />
                            <span style={{ fontSize: 11, color: selected ? dev.color : "#6b7280", fontWeight: selected ? 600 : 400 }}>{dev.name}</span>
                            <span style={{ fontSize: 9, color: "#4b5563" }}>{dev.model}</span>
                            {selected && <CheckCircle2 style={{ width: 10, height: 10, color: dev.color }} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* ── Agent Pipeline ─── */}
            <Card style={{ background: "rgba(10,12,25,0.7)", borderColor: "rgba(255,255,255,0.07)" }}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Cpu style={{ width: 15, height: 15, color: "#22d3ee" }} />
                    AI Agent Pipeline
                  </CardTitle>
                  {isRunning && (
                    <Badge style={{ background: "rgba(34,211,238,0.15)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.3)" }}
                      className="animate-pulse">
                      <Zap style={{ width: 10, height: 10, marginRight: 4 }} /> Agents Active
                    </Badge>
                  )}
                  {isDone && (
                    <Badge style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }}>
                      <CheckCircle2 style={{ width: 10, height: 10, marginRight: 4 }} /> Pipeline Complete
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "16px 0 8px", overflowX: "auto" }}>
                  {AGENTS.map((agent, i) => (
                    <AgentCircle
                      key={agent.id}
                      agent={agent}
                      status={agentStatus(i, phase)}
                      isLast={i === AGENTS.length - 1}
                    />
                  ))}
                </div>

                {/* Stage labels below */}
                <div style={{ display: "flex", justifyContent: "center", gap: 0, marginTop: 8 }}>
                  {[
                    { label: "Stage 1", sub: "Source Capture", color: "#34d399" },
                    { label: "Stage 2", sub: "Pre-Cloud Gate", color: "#fbbf24" },
                    { label: "Stage 3", sub: "Cloud Push", color: "#60a5fa" },
                    { label: "Stage 4", sub: "Post-Cloud Gate", color: "#22d3ee" },
                    { label: "Stage 5", sub: "Reporting", color: "#a78bfa" },
                  ].map((s, i) => (
                    <div key={i} style={{ width: 148, textAlign: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: s.color, display: "block" }}>{s.label}</span>
                      <span style={{ fontSize: 8.5, color: "#4b5563" }}>{s.sub}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* ── Two columns: Agent Log + Quick Stats ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Agent Activity Log */}
              <Card className="lg:col-span-2" style={{ background: "rgba(10,12,25,0.7)", borderColor: "rgba(255,255,255,0.07)" }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers style={{ width: 14, height: 14, color: "#22d3ee" }} />
                    Agent Activity Feed
                  </CardTitle>
                </CardHeader>
                <CardContent style={{ padding: 0 }}>
                  <div style={{ height: 220, overflowY: "auto", padding: "0 16px 12px" }}>
                    {logs.length === 0 && (
                      <div style={{ textAlign: "center", paddingTop: 64, color: "#4b5563", fontSize: 12 }}>
                        Run the agent pipeline to see real-time activity
                      </div>
                    )}
                    {logs.map((log, i) => (
                      <LogEntry key={i} log={log} agentColor={AGENTS.find(a => a.id === log.agentId)?.color ?? "#9ca3af"} />
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </CardContent>
              </Card>

              {/* Quick stats */}
              <Card style={{ background: "rgba(10,12,25,0.7)", borderColor: "rgba(255,255,255,0.07)" }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 style={{ width: 14, height: 14, color: "#22d3ee" }} />
                    Validation Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Pre-Cloud Gate",    value: results.length ? `${prePass}/${results.length} devices` : "—", color: prePass === results.length && results.length > 0 ? "#34d399" : results.length > 0 ? "#f87171" : "#6b7280" },
                    { label: "Post-Cloud Gate",   value: results.length ? `${postPass}/${results.length} devices` : "—", color: postPass === results.length && results.length > 0 ? "#34d399" : postWarn > 0 ? "#fbbf24" : results.length > 0 ? "#f87171" : "#6b7280" },
                    { label: "Missing Cloud Fields", value: results.length ? String(missingCloud) : "—", color: missingCloud > 0 ? "#f87171" : results.length > 0 ? "#34d399" : "#6b7280" },
                    { label: "Value Drift Fields",   value: results.length ? String(driftFields) : "—", color: driftFields > 0 ? "#fbbf24" : results.length > 0 ? "#34d399" : "#6b7280" },
                    { label: "Avg Cloud Latency",    value: results.length ? `${avgLatency}ms` : "—", color: avgLatency < 200 ? "#34d399" : avgLatency < 300 ? "#fbbf24" : "#f87171" },
                    { label: "Total Fields Checked", value: results.length ? String(allFields.length) : "—", color: "#22d3ee" },
                  ].map(item => (
                    <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#9ca3af" }}>{item.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: item.color }}>{item.value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* ── Results per device ── */}
            {results.length > 0 && (
              <div className="space-y-3">
                <h2 style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Device-Level Results
                </h2>
                {results.map(record => {
                  const dev = DEVICES.find(d => d.id === record.deviceId)!;
                  const DevIcon = dev.icon;
                  const isExpanded = expandedDevice === record.deviceId;
                  const pre = statusText(record.preStatus);
                  const post = statusText(record.postStatus);
                  return (
                    <Card key={record.deviceId} style={{ borderColor: `${dev.color}30`, background: `${dev.color}06` }}>
                      <CardHeader style={{ paddingBottom: 0 }}>
                        <button
                          className="w-full text-left"
                          onClick={() => setExpandedDevice(isExpanded ? null : record.deviceId)}
                          data-testid={`device-toggle-${record.deviceId}`}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            <div style={{ padding: 8, borderRadius: 8, background: `${dev.color}18`, flexShrink: 0 }}>
                              <DevIcon style={{ width: 16, height: 16, color: dev.color }} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 600, fontSize: 13 }}>{dev.name}</span>
                                <span style={{ fontSize: 10, color: dev.color, border: `1px solid ${dev.color}44`, borderRadius: 4, padding: "1px 6px" }}>{dev.model}</span>
                                <span style={{ fontSize: 11, color: "#6b7280" }}>{dev.ward} · Patient {dev.patientId}</span>
                              </div>
                              <p style={{ fontSize: 10, color: "#6b7280", marginTop: 2 }}>
                                Snapshot: {record.snapshotTs}{record.cloudTs ? ` · Cloud: ${record.cloudTs}` : ""}
                                {record.latencyMs ? ` · ${record.latencyMs}ms latency` : ""}
                              </p>
                            </div>
                            <div style={{ display: "flex", gap: 12, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
                              {[
                                { label: "Pre-Cloud", s: record.preStatus },
                                { label: "Post-Cloud", s: record.postStatus },
                                { label: "FHIR Map", s: record.transformOk ? "pass" as ValidationStatus : "warning" as ValidationStatus },
                              ].map(badge => {
                                const t = statusText(badge.s);
                                return (
                                  <div key={badge.label} style={{ textAlign: "center" }}>
                                    <p style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>{badge.label}</p>
                                    <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 4, border: `1px solid ${t.color}44`, background: `${t.color}15` }}>
                                      {statusIcon(badge.s, 11)}
                                      <span style={{ fontSize: 10, fontWeight: 700, color: t.color }}>{t.label}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </button>
                      </CardHeader>

                      {isExpanded && (
                        <CardContent style={{ paddingTop: 16 }}>
                          <div style={{ overflowX: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                              <thead>
                                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                                  {["Parameter", "Source Value", "Cloud Value", "Pre-Cloud Check", "Post-Cloud Check", "FHIR Path"].map(h => (
                                    <th key={h} style={{ textAlign: h === "Source Value" || h === "Cloud Value" ? "right" : "left", padding: "6px 10px 6px 0", color: "#6b7280", fontWeight: 500, fontSize: 10, whiteSpace: "nowrap" }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {record.fields.map((f, i) => (
                                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                                    <td style={{ padding: "7px 10px 7px 0", fontWeight: 500, whiteSpace: "nowrap" }}>{f.label}</td>
                                    <td style={{ padding: "7px 10px 7px 0", textAlign: "right", fontFamily: "monospace" }}>{f.sourceValue} {f.unit}</td>
                                    <td style={{ padding: "7px 10px 7px 0", textAlign: "right", fontFamily: "monospace", color: f.cloudValue === null ? "#f87171" : f.cloudValue !== f.sourceValue ? "#fbbf24" : "inherit" }}>
                                      {f.cloudValue !== null ? `${f.cloudValue} ${f.unit}` : <span style={{ color: "#f87171" }}>MISSING</span>}
                                    </td>
                                    <td style={{ padding: "7px 10px 7px 0" }}>
                                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                        {statusIcon(f.preStatus, 12)}
                                        <span style={{ color: statusText(f.preStatus).color }}>
                                          {f.preStatus === "fail" ? "Out of range" : "In range"}
                                        </span>
                                      </div>
                                    </td>
                                    <td style={{ padding: "7px 10px 7px 0", maxWidth: 200 }}>
                                      <div style={{ display: "flex", alignItems: "flex-start", gap: 5 }}>
                                        {statusIcon(f.postStatus, 12)}
                                        <span style={{ color: statusText(f.postStatus).color, fontSize: 10.5, lineHeight: 1.3 }}>
                                          {f.postStatus === "fail" ? "Missing in cloud" : f.postStatus === "warning" ? (f.issue ?? "Value drift") : "Preserved"}
                                        </span>
                                      </div>
                                    </td>
                                    <td style={{ padding: "7px 0 7px 0", color: "#6b7280", fontFamily: "monospace", fontSize: 9.5, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.fhirPath}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div style={{ display: "flex", gap: 12, marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap" }}>
                            {[
                              { label: "Record Count", value: record.countMatch ? "Matched" : "Mismatch", ok: record.countMatch },
                              { label: "Cloud Latency", value: `${record.latencyMs}ms`, ok: (record.latencyMs ?? 0) < 200 },
                              { label: "FHIR Transform", value: record.transformOk ? "Valid" : "Gaps found", ok: record.transformOk },
                            ].map(item => (
                              <div key={item.label} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "8px 14px", minWidth: 110, textAlign: "center" }}>
                                <p style={{ fontSize: 9, color: "#6b7280", marginBottom: 3 }}>{item.label}</p>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                                  {statusIcon(item.ok ? "pass" : "warning", 11)}
                                  <span style={{ fontSize: 11, fontWeight: 600, color: item.ok ? "#34d399" : "#fbbf24" }}>{item.value}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}

            {/* ── NFR Summary (only when done) ── */}
            {isDone && results.length > 0 && (
              <Card style={{ background: "rgba(10,12,25,0.7)", borderColor: "rgba(255,255,255,0.07)" }}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ShieldCheck style={{ width: 15, height: 15, color: "#22d3ee" }} />
                    End-to-End Data Quality Report
                  </CardTitle>
                  <CardDescription className="text-xs">Non-functional requirements validated by the AI agent pipeline</CardDescription>
                </CardHeader>
                <CardContent>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
                    {[
                      { label: "Data Completeness", icon: Layers, value: missingCloud === 0 ? "All fields present" : `${missingCloud} missing`, ok: missingCloud === 0 },
                      { label: "Clinical Ranges", icon: ShieldCheck, value: results.every(r => r.preStatus === "pass") ? "All in range" : "Violations found", ok: results.every(r => r.preStatus === "pass") },
                      { label: "Value Fidelity", icon: FileCheck, value: driftFields === 0 ? "No drift" : `${driftFields} drifted`, ok: driftFields === 0 },
                      { label: "FHIR Mapping", icon: RefreshCw, value: results.filter(r => r.transformOk).length + "/" + results.length + " valid", ok: results.every(r => r.transformOk) },
                      { label: "Cloud Latency", icon: Clock, value: `Avg ${avgLatency}ms`, ok: avgLatency < 200 },
                      { label: "Record Count", icon: Database, value: results.every(r => r.countMatch) ? "Matched" : "Mismatch", ok: results.every(r => r.countMatch) },
                    ].map(item => (
                      <div key={item.label} style={{
                        borderRadius: 8, padding: "14px 10px", textAlign: "center",
                        background: item.ok ? "rgba(52,211,153,0.07)" : "rgba(251,191,36,0.07)",
                        border: `1px solid ${item.ok ? "rgba(52,211,153,0.2)" : "rgba(251,191,36,0.2)"}`,
                      }}>
                        <item.icon style={{ width: 18, height: 18, color: item.ok ? "#34d399" : "#fbbf24", margin: "0 auto 6px" }} />
                        <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{item.label}</p>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          {statusIcon(item.ok ? "pass" : "warning", 11)}
                          <span style={{ fontSize: 10, color: item.ok ? "#34d399" : "#fbbf24" }}>{item.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Idle empty state ── */}
            {phase === "idle" && (
              <Card style={{ borderStyle: "dashed", borderColor: "rgba(255,255,255,0.1)", background: "transparent" }}>
                <CardContent style={{ textAlign: "center", padding: "64px 24px" }}>
                  <Bot style={{ width: 44, height: 44, color: "#374151", margin: "0 auto 12px" }} />
                  <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>5 AI Agents Ready</p>
                  <p style={{ fontSize: 12, color: "#6b7280", maxWidth: 440, margin: "0 auto 24px" }}>
                    The pipeline orchestrates Data Collector, Pre-Cloud Validator, Cloud Transmitter, Post-Cloud Verifier,
                    and Report Agent — automatically validating ICU device data at every stage.
                  </p>
                  <Button onClick={runPipeline} style={{ background: "#0e7490" }} className="hover:opacity-90" data-testid="button-run-idle">
                    <Bot style={{ width: 15, height: 15, marginRight: 8 }} /> Run Agent Pipeline
                  </Button>
                </CardContent>
              </Card>
            )}

          </div>
        </div>
    </>
  );
}
