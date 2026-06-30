import { createContext, useContext, useState, type ReactNode } from "react";

interface ProcessingStatus {
  isProcessing: boolean;
  currentStage: string;
  setProcessingStatus: (processing: boolean, stage?: string) => void;
}

const ProcessingStatusContext = createContext<ProcessingStatus>({
  isProcessing: false,
  currentStage: "",
  setProcessingStatus: () => {},
});

export function ProcessingStatusProvider({ children }: { children: ReactNode }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStage, setCurrentStage] = useState("");

  const setProcessingStatus = (processing: boolean, stage?: string) => {
    setIsProcessing(processing);
    setCurrentStage(stage || "");
  };

  return (
    <ProcessingStatusContext.Provider value={{ isProcessing, currentStage, setProcessingStatus }}>
      {children}
    </ProcessingStatusContext.Provider>
  );
}

export function useProcessingStatus() {
  return useContext(ProcessingStatusContext);
}
