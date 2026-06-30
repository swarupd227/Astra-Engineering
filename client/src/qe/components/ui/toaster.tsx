import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { CheckCircle2, AlertCircle, Info, Loader2 } from "lucide-react"

const TOAST_DURATION = 5000

function ToastProgressBar({ variant }: { variant?: string | null }) {
  const barColor =
    variant === 'destructive'
      ? 'bg-red-500'
      : variant === 'success'
      ? 'bg-emerald-500'
      : 'bg-blue-500'

  return (
    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/5 dark:bg-white/5">
      <div
        className={`h-full ${barColor} opacity-60`}
        style={{
          animation: `toast-progress ${TOAST_DURATION}ms linear forwards`,
        }}
      />
      <style>{`
        @keyframes toast-progress {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  )
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, duration, ...props }) {
        const isLogFormat = typeof description === 'string' && description.includes('\n');
        const isPersistent = duration === Infinity;

        const iconClass = "flex-shrink-0 mt-0.5"
        const icon = variant === 'destructive'
          ? <AlertCircle className={`h-5 w-5 text-red-500 dark:text-red-400 ${iconClass}`} />
          : variant === 'success'
          ? <CheckCircle2 className={`h-5 w-5 text-emerald-500 dark:text-emerald-400 ${iconClass}`} />
          : isPersistent
          ? <Loader2 className={`h-5 w-5 text-blue-500 dark:text-blue-400 animate-spin ${iconClass}`} />
          : <Info className={`h-5 w-5 text-blue-500 dark:text-blue-400 ${iconClass}`} />;

        return (
          <Toast key={id} variant={variant} duration={duration} {...props} className={isLogFormat ? "max-h-[400px]" : ""}>
            {icon}
            <div className="grid gap-0.5 flex-1" aria-live="polite">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription
                  className={isLogFormat ? "max-h-[300px] overflow-y-auto font-mono text-xs whitespace-pre-wrap break-words" : ""}
                >
                  {description}
                </ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
            {!isPersistent && <ToastProgressBar variant={variant} />}
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
