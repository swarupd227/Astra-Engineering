import { Globe, Shield, GitBranch, Network, FileSearch, PenTool, Code, Play, BarChart2 } from 'lucide-react';
import { AgentCard, AgentStatus } from './AgentCard';

export interface AgentState {
  scout_agent: AgentStatus;
  auth_agent: AgentStatus;
  workflow_analyst: AgentStatus;
  diagram_architect: AgentStatus;
  test_strategist: AgentStatus;
  test_writer: AgentStatus;
  script_engineer: AgentStatus;
  executor_agent: AgentStatus;
  qa_analyst: AgentStatus;
}

export interface AgentActivity {
  [key: string]: string;
}

export interface AgentProgress {
  [key: string]: number;
}

export interface AgentStats {
  [key: string]: { label: string; value: string | number }[];
}

const AGENT_DEFINITIONS = [
  { id: 'scout_agent', name: 'Scout Agent', role: 'Web Discovery', icon: Globe },
  { id: 'auth_agent', name: 'Auth Agent', role: 'Session Management', icon: Shield },
  { id: 'workflow_analyst', name: 'Workflow Analyst', role: 'Pattern Discovery', icon: GitBranch },
  { id: 'diagram_architect', name: 'Diagram Architect', role: 'Visual Mapping', icon: Network },
  { id: 'test_strategist', name: 'Test Strategist', role: 'Coverage Planning', icon: FileSearch },
  { id: 'test_writer', name: 'Test Writer', role: 'Case Generation', icon: PenTool },
  { id: 'script_engineer', name: 'Script Engineer', role: 'Automation Code', icon: Code },
  { id: 'executor_agent', name: 'Executor Agent', role: 'Test Execution', icon: Play },
  { id: 'qa_analyst', name: 'QA Analyst', role: 'Results Analysis', icon: BarChart2 },
] as const;

interface AgentPanelProps {
  agentStates: Partial<AgentState>;
  agentActivity?: AgentActivity;
  agentProgress?: AgentProgress;
  agentStats?: AgentStats;
  agentElapsed?: { [key: string]: number };
  visibleAgents?: (keyof AgentState)[];
}

export function AgentPanel({
  agentStates,
  agentActivity = {},
  agentProgress = {},
  agentStats = {},
  agentElapsed = {},
  visibleAgents,
}: AgentPanelProps) {
  const agents = AGENT_DEFINITIONS.filter(a =>
    !visibleAgents || visibleAgents.includes(a.id as keyof AgentState)
  );

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">
        AI Agents
      </h3>
      {agents.map(agent => (
        <AgentCard
          key={agent.id}
          name={agent.name}
          role={agent.role}
          icon={agent.icon}
          status={agentStates[agent.id as keyof AgentState] ?? 'idle'}
          activity={agentActivity[agent.id]}
          progress={agentProgress[agent.id]}
          stats={agentStats[agent.id]}
          elapsed={agentElapsed[agent.id]}
        />
      ))}
    </div>
  );
}
