import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

const AI_QUOTES = [
  "The best way to predict the future is to invent it. - Alan Kay",
  "Any sufficiently advanced technology is indistinguishable from magic. - Arthur C. Clarke",
  "Testing leads to failure, and failure leads to understanding. - Burt Rutan",
  "Quality is not an act, it is a habit. - Aristotle",
  "The sooner you start to code, the longer the program will take. - Roy Carlson",
  "First, solve the problem. Then, write the code. - John Johnson",
  "Testing shows the presence, not the absence of bugs. - Edsger W. Dijkstra",
  "Automation is good, so long as you know exactly where to put the machine. - Eliyahu Goldratt",
  "The art of programming is the art of organizing complexity. - Edsger W. Dijkstra",
  "In theory, theory and practice are the same. In practice, they're not. - Yogi Berra",
  "The most disastrous thing that you can ever learn is your first programming language. - Alan Kay",
  "Make it work, make it right, make it fast. - Kent Beck",
  "Code never lies, comments sometimes do. - Ron Jeffries",
  "Simplicity is the soul of efficiency. - Austin Freeman",
  "If debugging is the process of removing bugs, then programming must be the process of putting them in. - Edsger W. Dijkstra",
];

interface AIQuotesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AIQuotesModal({ isOpen, onClose }: AIQuotesModalProps) {
  const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      setCurrentQuoteIndex((prev) => (prev + 1) % AI_QUOTES.length);
    }, 3000); // Change quote every 3 seconds

    return () => clearInterval(interval);
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="sm:max-w-[600px]" 
        data-testid="modal-ai-quotes"
      >
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center flex items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            Test Execution Agent
          </DialogTitle>
          <DialogDescription className="text-center text-base pt-4">
            Test execution agent is executing test cases in headless mode
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-8">
          <div className="relative min-h-[120px] flex items-center justify-center px-8">
            <div
              key={currentQuoteIndex}
              className="text-center animate-in fade-in-0 slide-in-from-bottom-4 duration-700"
              data-testid={`quote-${currentQuoteIndex}`}
            >
              <p className="text-lg italic text-muted-foreground leading-relaxed">
                "{AI_QUOTES[currentQuoteIndex]}"
              </p>
            </div>
          </div>
          
          <div className="flex justify-center gap-2 mt-6">
            {AI_QUOTES.map((_, index) => (
              <div
                key={index}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  index === currentQuoteIndex
                    ? "bg-primary w-8"
                    : "bg-muted-foreground/30"
                }`}
                data-testid={`quote-indicator-${index}`}
              />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
