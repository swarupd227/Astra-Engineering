import { memo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface WorkItemsChartProps {
  data: Array<{
    name: string;
    value: number;
    color: string;
  }>;
}

const formatArtifactCount = (value: number) => {
  if (value >= 1000) {
    const compact = (value / 1000).toFixed(1).replace(/\.0$/, "");
    return `${compact}K`;
  }
  return `${value}`;
};

export const WorkItemsChart = memo<WorkItemsChartProps>(({ data }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No generated artifacts yet
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[260px] flex-col gap-4 lg:flex-row lg:items-center">
      <div className="relative h-[220px] w-full min-w-0 lg:h-[240px] lg:flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={false}
              outerRadius="80%"
              innerRadius="58%"
              fill="#8884d8"
              dataKey="value"
              strokeWidth={3}
              stroke="transparent"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <RechartsTooltip
              formatter={(value: number, name: string) => {
                const percentage = total > 0 ? ((value / total) * 100).toFixed(0) : "0";
                return [`${value} (${percentage}%)`, name];
              }}
              contentStyle={{
                backgroundColor: "hsl(220 5% 15%)",
                border: "1px solid hsl(220 6% 24%)",
                borderRadius: "8px",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                color: "#f2f2f2",
              }}
              itemStyle={{ color: "#e5e5e5" }}
            />
            <text
              x="50%"
              y="46%"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-foreground text-2xl font-bold"
            >
              {formatArtifactCount(total)}
            </text>
            <text
              x="50%"
              y="58%"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted-foreground text-xs"
            >
              Total Artifacts
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-2 lg:w-44 lg:shrink-0">
        {data.map((entry) => (
          <div
            key={entry.name}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="truncate text-muted-foreground">{entry.name}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-foreground">
              {formatArtifactCount(entry.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

WorkItemsChart.displayName = "WorkItemsChart";

interface PhaseProgressChartProps {
  data: Array<{
    name?: string;
    value?: number;
    color?: string;
    projectName?: string;
    Active?: number;
    Completed?: number;
    Pending?: number;
  }>;
}

export const PhaseProgressChart = memo<PhaseProgressChartProps>(
  ({ data }) => {
    if (data.length === 0) {
      return (
        <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
          No phase data available
        </div>
      );
    }

    // Check if data is project-wise (has projectName) or overall totals (has name/value)
    const isProjectWise = data[0]?.projectName !== undefined;

    if (isProjectWise) {
      // Horizontal grouped bar chart for project-wise data with fixed height and scroll
      // Calculate required height for all projects
      const requiredHeight = data.length * 40 + 100;
      const fixedHeight = 400; // Fixed visible height
      const actualHeight = Math.max(fixedHeight, requiredHeight);
      
      return (
        <div className="w-full" style={{ height: `${fixedHeight}px`, overflowY: 'auto', overflowX: 'hidden', position: 'relative', zIndex: 1 }}>
          <style>{`
            .recharts-tooltip-wrapper {
              z-index: 99999 !important;
            }
            .recharts-default-tooltip {
              z-index: 99999 !important;
            }
            .recharts-tooltip-cursor {
              z-index: 1 !important;
            }
          `}</style>
          <ResponsiveContainer width="100%" height={actualHeight}>
            <BarChart 
              data={data} 
              layout="vertical"
              margin={{ top: 20, right: 30, left: 150, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
              <XAxis type="number" />
              <YAxis 
                type="category" 
                dataKey="projectName" 
                width={140}
                tick={{ fontSize: 12 }}
                tickLine={false}
              />
              <RechartsTooltip 
                cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
                contentStyle={{ 
                  backgroundColor: 'rgba(255, 255, 255, 0.98)', 
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                  padding: '12px',
                  zIndex: 99999
                }}
                wrapperStyle={{ 
                  zIndex: 99999,
                  outline: 'none'
                }}
                allowEscapeViewBox={{ x: false, y: true }}
                labelStyle={{ 
                  color: '#111827', 
                  fontWeight: '700',
                  fontSize: '13px',
                  marginBottom: '10px',
                  paddingBottom: '6px',
                  borderBottom: '2px solid #e5e7eb',
                  backgroundColor: 'transparent'
                }}
                itemStyle={{ 
                  color: '#374151',
                  fontSize: '12px',
                  padding: '2px 0'
                }}
                labelFormatter={(label: string) => {
                  return <span style={{ color: '#111827', fontWeight: '700' }}>{label}</span>;
                }}
                formatter={(value: any, name: string) => {
                  const colorMap: { [key: string]: string } = {
                    'Active': '#5cb85c',
                    'Completed': '#4a90e2',
                    'Pending': '#6c757d'
                  };
                  return [
                    <span key={name} style={{ color: colorMap[name] || '#374151', fontWeight: '600' }}>
                      {value}
                    </span>,
                    name
                  ];
                }}
              />
              <Legend 
                wrapperStyle={{ paddingTop: '20px' }}
              />
              <Bar dataKey="Active" fill="#5cb85c" name="Active" radius={[0, 4, 4, 0]} />
              <Bar dataKey="Completed" fill="#4a90e2" name="Completed" radius={[0, 4, 4, 0]} />
              <Bar dataKey="Pending" fill="#6c757d" name="Pending" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      );
    }

    // Original bar chart for overall totals
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <RechartsTooltip />
          <Bar dataKey="value" fill="#8884d8">
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color || "#8884d8"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
);

PhaseProgressChart.displayName = "PhaseProgressChart";

