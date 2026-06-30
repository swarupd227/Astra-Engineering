import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { CheckCircle2, Calendar, User, Target, Bot, UserCircle, ChevronUp, ChevronDown, Database } from "lucide-react";
import { useState } from "react";
import { WikiDocumentViewer } from "@/components/wiki-document-viewer";

// Helper function to parse chat messages from description
function parseChatMessages(description: string): Array<{ role: 'user' | 'assistant'; message: string }> {
  if (!description) return [];
  
  const messages: Array<{ role: 'user' | 'assistant'; message: string }> = [];
  const lines = description.split('\n');
  
  let currentRole: 'user' | 'assistant' | null = null;
  let currentMessage: string[] = [];
  
  for (const line of lines) {
    if (line.startsWith('Assistant:')) {
      if (currentRole && currentMessage.length > 0) {
        messages.push({ role: currentRole, message: currentMessage.join('\n').trim() });
      }
      currentRole = 'assistant';
      currentMessage = [line.replace('Assistant:', '').trim()];
    } else if (line.startsWith('User:')) {
      if (currentRole && currentMessage.length > 0) {
        messages.push({ role: currentRole, message: currentMessage.join('\n').trim() });
      }
      currentRole = 'user';
      currentMessage = [line.replace('User:', '').trim()];
    } else if (currentRole) {
      currentMessage.push(line);
    }
  }
  
  if (currentRole && currentMessage.length > 0) {
    messages.push({ role: currentRole, message: currentMessage.join('\n').trim() });
  }
  
  return messages;
}

interface WorkItemDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: any;
  itemType: "story" | "requirement" | "backlog" | "document" | "epic" | "feature" | "bug" | "issue" | "task" | "testcase";
  projectId: string;
  phaseNumber: number;
  parent?: any;
  children?: any[];
}

export function WorkItemDetailsDialog({
  open,
  onOpenChange,
  item,
  itemType,
  projectId,
  phaseNumber,
  parent,
  children = [],
}: WorkItemDetailsDialogProps) {
  const [parentSectionExpanded, setParentSectionExpanded] = useState(true);
  const [childrenSectionExpanded, setChildrenSectionExpanded] = useState(true);
  
  if (!item) return null;

  // For documents, use the Wiki-style viewer
  if (itemType === "document") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[95vw] w-[95vw] h-[95vh] p-0 flex flex-col">
          <WikiDocumentViewer
            content={item.content || item.description || ""}
            title={item.title}
            createdAt={item.createdAt}
            updatedAt={item.updatedAt}
            author={item.createdBy || item.assignedTo}
          />
        </DialogContent>
      </Dialog>
    );
  }

  const chatMessages = item?.description ? parseChatMessages(item.description) : [];
  const isChat = chatMessages.length > 0;

  // Helper function to render HTML content safely (for ADO content with HTML tags)
  const renderHtmlContent = (htmlString: string): JSX.Element => {
    // Check if the content contains HTML tags
    const hasHtmlTags = /<[^>]+>/.test(htmlString);
    
    if (!hasHtmlTags) {
      // If no HTML tags, use the markdown-style formatter
      return formatContent(htmlString);
    }
    
    // Render HTML content safely
    return (
      <div 
        className="prose prose-sm max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: htmlString }}
      />
    );
  };

  // Helper function to format content with markdown, mermaid, and emojis
  const formatContent = (content: string): JSX.Element => {
    const lines = content.split('\n');
    const formattedLines: JSX.Element[] = [];
    let inMermaidBlock = false;
    let mermaidCode: string[] = [];
    let mermaidIndex = 0;
    
    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      
      // Check for mermaid code blocks
      if (trimmedLine === '```mermaid' || trimmedLine === ':::mermaid' || trimmedLine === '::: mermaid') {
        inMermaidBlock = true;
        mermaidCode = [];
        return;
      }
      
      if (inMermaidBlock && (trimmedLine === '```' || trimmedLine === ':::')) {
        inMermaidBlock = false;
        if (mermaidCode.length > 0) {
          formattedLines.push(
            <div key={`mermaid-${mermaidIndex}`} className="my-4 p-4 bg-muted/30 rounded-lg border border-border/50 overflow-x-auto">
              <div className="mermaid-code text-sm" style={{ minHeight: '200px' }}>
                {mermaidCode.join('\n')}
              </div>
            </div>
          );
          mermaidIndex++;
        }
        return;
      }
      
      if (inMermaidBlock) {
        mermaidCode.push(line);
        return;
      }
      
      // H1 headers (# Title)
      if (trimmedLine.startsWith('# ')) {
        const text = trimmedLine.replace(/^#\s+/, '');
        formattedLines.push(
          <div key={index} className="text-xl font-bold mb-4 mt-3 flex items-center gap-2 text-foreground break-words">
            <span className="text-2xl">📋</span>
            <span className="break-words">{text}</span>
          </div>
        );
      }
      // H2 headers (## Title)
      else if (trimmedLine.startsWith('## ')) {
        const text = trimmedLine.replace(/^##\s+/, '');
        const emoji = text.toLowerCase().includes('executive') ? '📊' :
                     text.toLowerCase().includes('summary') ? '📝' :
                     text.toLowerCase().includes('timeline') ? '⏱️' :
                     text.toLowerCase().includes('status') ? '🎯' :
                     text.toLowerCase().includes('owner') ? '👤' :
                     text.toLowerCase().includes('team') ? '👥' : '📌';
        formattedLines.push(
          <div key={index} className="text-lg font-semibold mb-3 mt-4 flex items-center gap-2 text-primary break-words">
            <span>{emoji}</span>
            <span className="break-words">{text}</span>
          </div>
        );
      }
      // H3 headers (### Title)
      else if (trimmedLine.startsWith('### ')) {
        const text = trimmedLine.replace(/^###\s+/, '');
        formattedLines.push(
          <div key={index} className="text-base font-semibold mb-2 mt-3 text-foreground/90 break-words">
            {text}
          </div>
        );
      }
      // Bold text with asterisks (**text**)
      else if (trimmedLine.includes('**')) {
        const formatted = trimmedLine.split(/(\*\*.*?\*\*)/).map((part, i) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            const boldText = part.replace(/\*\*/g, '');
            // Add emoji based on content
            const emoji = boldText.toLowerCase().includes('timeline') ? '⏱️ ' :
                         boldText.toLowerCase().includes('status') ? '📊 ' :
                         boldText.toLowerCase().includes('owner') ? '👤 ' :
                         boldText.toLowerCase().includes('team') ? '👥 ' :
                         boldText.toLowerCase().includes('project') ? '🎯 ' :
                         boldText.toLowerCase().includes('development') ? '💻 ' : '';
            return <span key={i} className="font-semibold text-primary">{emoji}{boldText}</span>;
          }
          return <span key={i}>{part}</span>;
        });
        formattedLines.push(<div key={index} className="mb-2 break-words">{formatted}</div>);
      }
      // List items (starting with - or *)
      else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
        const text = trimmedLine.replace(/^[-*]\s+/, '');
        formattedLines.push(
          <div key={index} className="flex gap-2 mb-1.5 ml-4 break-words">
            <span className="text-primary mt-1">•</span>
            <span className="flex-1 break-words">{text}</span>
          </div>
        );
      }
      // Empty lines
      else if (trimmedLine === '') {
        formattedLines.push(<div key={index} className="h-3" />);
      }
      // Regular paragraphs
      else if (trimmedLine) {
        formattedLines.push(
          <div key={index} className="mb-2 leading-relaxed text-muted-foreground break-words">
            {trimmedLine}
          </div>
        );
      }
    });
    
    return <div className="space-y-1 break-words overflow-wrap-anywhere">{formattedLines}</div>;
  };

  const getStatusColor = (status: unknown) => {
    const normalized = typeof status === "string" ? status.toLowerCase() : (status == null ? "" : String(status).toLowerCase());
    switch (normalized) {
      case "done":
      case "completed":
        return "default";
      case "in_progress":
      case "in-progress":
        return "secondary";
      default:
        return "outline";
    }
  };

  const getPriorityColor = (priority: unknown) => {
    const normalized = typeof priority === "string" ? priority.toLowerCase() : (priority == null ? "" : String(priority).toLowerCase());
    switch (normalized) {
      case "high":
        return "destructive";
      case "medium":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-7xl max-h-[90vh] p-0 rounded-lg flex flex-col overflow-hidden">
          <DialogHeader className="bg-gradient-to-r from-background to-muted/20 p-6 pb-4 border-b border-border/50 flex-shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-4">
                  {item._isAdoItem ? (
                    <Database className="h-6 w-6 text-blue-500" />
                  ) : (
                    <Database className="h-6 w-6 text-amber-500" />
                  )}
                  <DialogTitle className="text-2xl font-bold">
                    {item.title}
                  </DialogTitle>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {item.type && item.type !== 'wiki' && (
                    <Badge 
                      variant="outline" 
                      data-testid="badge-item-type"
                      className={
                        item.type === "Epic" ? "bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/50" :
                        item.type === "Feature" ? "bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-500/50" :
                        item.type === "User Story" ? "bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/50" :
                        ""
                      }
                    >
                      {item.type}
                    </Badge>
                  )}
                  {item.priority && (
                    <Badge variant={getPriorityColor(item.priority)} data-testid="badge-item-priority">
                      {item.priority}
                    </Badge>
                  )}
                  {item._isAdoItem ? (
                    <Badge variant="outline" className="border-blue-500/50 text-blue-500 bg-blue-500/10">
                      ADO
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="flex items-center gap-1 border-amber-500/50 text-amber-500 bg-amber-500/10">
                      <Database className="h-3 w-3" />
                      Draft
                    </Badge>
                  )}
                  {item.status && (
                    <Badge variant={getStatusColor(item.status)} data-testid="badge-item-status">
                      {item.status}
                    </Badge>
                  )}
                  {item.storyPoints && (
                    <Badge variant="outline" data-testid="badge-story-points">
                      <Target className="h-3 w-3 mr-1" />
                      {item.storyPoints} points
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto scrollbar-thin">
            <div className="space-y-6 p-6 pb-8">
              {/* Description section */}
              {item.description && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Description</h3>
                  <div className="text-sm leading-relaxed bg-muted/30 p-4 rounded-lg border border-border/50 break-words overflow-wrap-anywhere">
                    {isChat ? (
                      <div>
                        <h4 className="text-base font-semibold mb-4 flex items-center gap-2">
                          <Bot className="h-5 w-5 text-purple-600" />
                          Conversation History
                        </h4>
                        <div className="space-y-4 bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900/40 dark:to-slate-950/40 p-6 rounded-xl border border-slate-200 dark:border-slate-700 max-h-[60vh] overflow-y-auto scrollbar-thin">
                          {chatMessages.map((msg, idx) => (
                            <div
                              key={idx}
                              className={`flex gap-3 items-start ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                            >
                              <div className={`flex-shrink-0 w-10 h-10 rounded-full shadow-lg flex items-center justify-center ${
                                msg.role === 'assistant'
                                  ? 'bg-gradient-to-br from-purple-500 via-purple-600 to-pink-500'
                                  : 'bg-gradient-to-br from-blue-500 via-blue-600 to-cyan-500'
                              }`}>
                                {msg.role === 'assistant' ? (
                                  <Bot className="h-5 w-5 text-white" />
                                ) : (
                                  <UserCircle className="h-5 w-5 text-white" />
                                )}
                              </div>
                              <div className="flex flex-col gap-1 flex-1 min-w-0 max-w-[80%]">
                                <span className={`text-xs font-medium ${msg.role === 'user' ? 'text-right' : 'text-left'} text-slate-600 dark:text-slate-400`}>
                                  {msg.role === 'assistant' ? 'Tia Bot' : 'You'}
                                </span>
                                <div
                                  className={`rounded-2xl px-5 py-3 shadow-md ${
                                    msg.role === 'assistant'
                                      ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-tl-sm'
                                      : 'bg-gradient-to-br from-blue-600 to-blue-500 text-white rounded-tr-sm'
                                  }`}
                                >
                                  <div className={`text-sm leading-relaxed break-words overflow-wrap-anywhere ${
                                    msg.role === 'user' ? 'text-white' : 'text-slate-700 dark:text-slate-200'
                                  }`} style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                    {msg.message}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      renderHtmlContent(item.description)
                    )}
                  </div>
                </div>
              )}

              {/* Priority section */}
              {item.priority && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Priority</h3>
                  <Badge
                    variant={getPriorityColor(item.priority)}
                    className="text-sm"
                  >
                    {item.priority}
                  </Badge>
                </div>
              )}

              {/* Metadata */}
              <div className="grid grid-cols-2 gap-4 px-6">
                {item.assignedTo && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Assigned To
                    </h3>
                    <p className="text-sm text-muted-foreground">{item.assignedTo}</p>
                  </div>
                )}
                {item.createdAt && (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      Created
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                )}
              </div>

              {/* Acceptance Criteria */}
              {(() => {
                // Normalize acceptanceCriteria to always be an array
                let acceptanceCriteriaArray: any[] = [];
                
                if (item.acceptanceCriteria) {
                  if (Array.isArray(item.acceptanceCriteria)) {
                    acceptanceCriteriaArray = item.acceptanceCriteria;
                  } else if (typeof item.acceptanceCriteria === 'string') {
                    // If it's a string, try to parse it or split by newlines
                    const trimmed = item.acceptanceCriteria.trim();
                    if (trimmed) {
                      // Try splitting by newlines or semicolons
                      acceptanceCriteriaArray = trimmed
                        .split(/\n+|;+/)
                        .map((line: string) => line.trim())
                        .filter((line: string) => line.length > 0);
                    }
                  }
                }
                
                if (acceptanceCriteriaArray.length === 0) {
                  return null;
                }
                
                return (
                  <div className="px-6">
                    <h3 className="text-sm font-semibold mb-3">Acceptance Criteria</h3>
                    <div className="space-y-3">
                      {acceptanceCriteriaArray.map((ac: any, idx: number) => {
                        // Handle descriptive string format (new format)
                        let displayText = '';
                        
                        if (typeof ac === 'string') {
                          displayText = ac;
                        } else if (typeof ac === 'object' && ac !== null) {
                          // For backward compatibility, extract descriptive text
                          // If it has given/when/then, combine them into a descriptive statement
                          if (ac.given || ac.when || ac.then) {
                            const parts = [];
                            if (ac.given) parts.push(`Given ${ac.given}`);
                            if (ac.when) parts.push(`when ${ac.when}`);
                            if (ac.then) parts.push(`then ${ac.then}`);
                            if (ac.and) parts.push(`and ${ac.and}`);
                            displayText = parts.join(', ');
                          } else {
                            displayText = ac.title || ac.description || Object.values(ac).filter(v => typeof v === 'string' && v.trim()).join(' ') || `Acceptance Criterion ${idx + 1}`;
                          }
                        } else {
                          displayText = `Acceptance Criterion ${idx + 1}`;
                        }
                        
                        return (
                          <Card key={idx} className="bg-muted/30">
                            <CardHeader className="p-3 pb-2">
                              <CardTitle className="text-sm font-medium flex items-start gap-2">
                                <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600 flex-shrink-0" />
                                Acceptance Criterion {idx + 1}
                              </CardTitle>
                            </CardHeader>
                            <CardContent className="p-3 pt-0 text-sm">
                              <div 
                                className="text-foreground prose prose-sm max-w-none dark:prose-invert"
                                dangerouslySetInnerHTML={{ __html: displayText }}
                              />
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Subtasks */}
              {item.subtasks && item.subtasks.length > 0 && (
                <div className="px-6">
                  <h3 className="text-sm font-semibold mb-3">Subtasks</h3>
                  <div className="space-y-2">
                    {item.subtasks.map((subtask: any, idx: number) => {
                      // Handle both string and object subtasks
                      let subtaskText = '';
                      if (typeof subtask === 'string') {
                        subtaskText = subtask;
                      } else if (typeof subtask === 'object' && subtask !== null) {
                        // Extract text from object (handle various formats)
                        subtaskText = subtask.title || subtask.description || subtask.name || `Subtask ${idx + 1}`;
                      } else {
                        subtaskText = `Subtask ${idx + 1}`;
                      }
                      
                      return (
                        <div 
                          key={idx} 
                          className="flex items-start gap-2 text-sm p-2 rounded-md bg-muted/30"
                          data-testid={`subtask-${idx}`}
                        >
                          <CheckCircle2 className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                          <span className="text-muted-foreground">{subtaskText}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Content (for documents) */}
              {item.content && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 text-foreground/80">Content</h3>
                  <div className="text-sm leading-relaxed bg-muted/30 p-6 rounded-lg border border-border/50 hover:border-border transition-colors max-h-[400px] overflow-y-auto">
                    {formatContent(item.content)}
                  </div>
                </div>
              )}

              {/* Category (for requirements) */}
              {item.category && (
                <div className="px-6">
                  <h3 className="text-sm font-semibold mb-2">Category</h3>
                  <Badge variant="outline" className="break-words">{item.category}</Badge>
                </div>
              )}

              {/* Parent & Children sections - Hide for documents */}
              {itemType !== "document" && (
                <div className="space-y-4 pt-4 border-t border-border/50 mt-4 px-6">
                  {/* Parent section */}
                  <div className="rounded-lg border border-border bg-card/50 p-4">
                    <button
                      type="button"
                      className="flex items-center justify-between w-full mb-2 text-left"
                      onClick={() => setParentSectionExpanded((prev) => !prev)}
                    >
                      <div className="flex items-center gap-2">
                        {parentSectionExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                        <h4 className="text-sm font-semibold">Parent</h4>
                      </div>
                    </button>

                    {parentSectionExpanded && (
                      parent ? (
                        <div className="flex items-center gap-2 p-2 rounded-md bg-muted/40">
                          <Badge variant="outline" className="text-xs">
                            {parent.type}
                          </Badge>
                          <span className="text-sm font-medium flex-1">
                            {parent.title}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {parent.status}
                          </Badge>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No parent artifact
                        </p>
                      )
                    )}
                  </div>

                  {/* Children section */}
                  <div className="rounded-lg border border-border bg-card/50 p-4">
                    <button
                      type="button"
                      className="flex items-center justify-between w-full mb-2 text-left"
                      onClick={() => setChildrenSectionExpanded((prev) => !prev)}
                    >
                      <div className="flex items-center gap-2">
                        {childrenSectionExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        )}
                        <h4 className="text-sm font-semibold">
                          Children ({children.length})
                        </h4>
                      </div>
                    </button>

                    {childrenSectionExpanded && (
                      children.length > 0 ? (
                        <div className="space-y-2">
                          {children.map((child: any) => (
                            <div
                              key={child.id}
                              className="flex items-center gap-2 p-2 rounded-md bg-muted/40"
                            >
                              <Badge variant="outline" className="text-xs">
                                {child.type}
                              </Badge>
                              <span className="text-sm font-medium flex-1">
                                {child.title}
                              </span>
                              <Badge variant="secondary" className="text-xs">
                                {child.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No child artifacts
                        </p>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
