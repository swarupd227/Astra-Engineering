import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentTask } from "@shared/qe-schema";

interface AgentTimelineProps {
  tasks: AgentTask[];
}

export function AgentTimeline({ tasks }: AgentTimelineProps) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Waiting for test to begin...</p>
      </div>
    );
  }

  // Get unique agents and their latest task status
  const agentStates: Record<string, AgentTask> = {};
  tasks.forEach(task => {
    if (!agentStates[task.agentName] || new Date(task.timestamp) > new Date(agentStates[task.agentName].timestamp)) {
      agentStates[task.agentName] = task;
    }
  });

  // Sort agents in correct order: Discovery (left) -> Insurance Expert (middle) -> Test Generation (right)
  const agentOrder = ["Discovery Agent", "Insurance Expert Agent", "Test Generation Agent"];
  const agents = Object.values(agentStates).sort((a, b) => {
    const indexA = agentOrder.indexOf(a.agentName);
    const indexB = agentOrder.indexOf(b.agentName);
    return indexA - indexB;
  });
  const colors = [
    { bg: "from-emerald-500/20 to-emerald-600/20", circle: "bg-emerald-500", text: "text-emerald-400" },
    { bg: "from-rose-500/20 to-rose-600/20", circle: "bg-rose-500", text: "text-rose-400" },
    { bg: "from-blue-500/20 to-blue-600/20", circle: "bg-blue-500", text: "text-blue-400" },
    { bg: "from-purple-500/20 to-purple-600/20", circle: "bg-purple-500", text: "text-purple-400" },
    { bg: "from-yellow-500/20 to-yellow-600/20", circle: "bg-yellow-500", text: "text-yellow-400" },
  ];

  return (
    <div className="w-full flex flex-col justify-center py-12">
      <div className="flex justify-center items-start w-full gap-6 px-4 overflow-x-auto">
        <AnimatePresence>
          {agents.map((task, index) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.3, delay: index * 0.1 }}
              className="flex flex-col items-center gap-3 flex-shrink-0"
            >
              {/* Circular Progress Indicator */}
              <div className="relative" style={{
                filter: `drop-shadow(0 0 20px ${colors[index % colors.length].circle === "bg-emerald-500" ? "rgba(16, 185, 129, 0.6)" : colors[index % colors.length].circle === "bg-rose-500" ? "rgba(244, 63, 94, 0.6)" : colors[index % colors.length].circle === "bg-blue-500" ? "rgba(59, 130, 246, 0.6)" : "rgba(139, 92, 246, 0.6)"})`
              }}>
                {/* Background glow */}
                <div className={cn(
                  "absolute inset-0 w-24 h-24 rounded-full blur-xl opacity-50",
                  colors[index % colors.length].circle
                )} />
                
                {/* Main circle */}
                <motion.div
                  className={cn(
                    "w-24 h-24 rounded-full border-4 flex items-center justify-center relative",
                    task.status === "pending" && "border-muted-foreground bg-muted/20",
                    task.status === "in-progress" && cn("border-2", colors[index % colors.length].circle, "bg-background/80"),
                    task.status === "completed" && cn("border-2", colors[index % colors.length].circle, "bg-background/80")
                  )}
                >
                  {/* Inner circle with progress */}
                  {task.status === "in-progress" && (
                    <motion.svg
                      className="absolute w-28 h-28"
                      viewBox="0 0 100 100"
                      initial={{ rotate: 0 }}
                      animate={{ rotate: 360 }}
                      transition={{ duration: 2, repeat: Infinity, linear: true }}
                    >
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke={colors[index % colors.length].circle}
                        strokeWidth="2"
                        opacity="0.3"
                      />
                      <motion.circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        strokeDasharray={`${(task.progress / 100) * 282} 282`}
                        stroke={colors[index % colors.length].circle}
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </motion.svg>
                  )}
                  
                  {/* Icon */}
                  <div className={cn(
                    "flex items-center justify-center",
                    colors[index % colors.length].text
                  )}>
                    {task.status === "in-progress" && (
                      <Loader2 className="w-6 h-6 animate-spin" />
                    )}
                    {task.status === "completed" && (
                      <CheckCircle2 className="w-6 h-6" />
                    )}
                    {task.status === "pending" && (
                      <div className="w-3 h-3 rounded-full bg-muted-foreground/50" />
                    )}
                  </div>
                </motion.div>

                {/* Status badge */}
                {task.status === "in-progress" && (
                  <motion.div
                    className={cn(
                      "absolute -top-1 -right-1 w-4 h-4 rounded-full",
                      colors[index % colors.length].circle,
                      "animate-pulse"
                    )}
                  />
                )}
              </div>

              {/* Agent Info - 2 lines text, progress on 3rd line */}
              <div className="text-center max-w-xs">
                <h3 className="text-sm font-bold text-foreground" data-testid={`agent-name-${task.id}`}>
                  {task.agentName}
                </h3>
                <p className="text-xs text-muted-foreground line-clamp-2" data-testid={`agent-status-${task.id}`}>
                  {task.taskName}
                </p>
                {task.status === "in-progress" && (
                  <p className={cn("text-xs font-semibold mt-1", colors[index % colors.length].text)}>
                    {task.progress}%
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(task.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
