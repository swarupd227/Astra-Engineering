"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, LucideIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, ButtonProps } from "@/components/ui/button";

// Button configuration type for footer buttons
export interface ModalButtonConfig {
  label: string;
  onClick: () => void;
  variant?: ButtonProps["variant"];
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  "data-testid"?: string;
}

export interface GenericModalProps {
  // Visibility control
  open: boolean;
  onOpenChange: (open: boolean) => void;

  // Header configuration
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  headerActions?: React.ReactNode;

  // Content
  children: React.ReactNode;

  // Footer configuration
  footerButtons?: ModalButtonConfig[];
  footerContent?: React.ReactNode;
  showDefaultClose?: boolean; // Show default "Close" button if no custom buttons
  onClose?: () => void; // Custom close handler (optional, defaults to onOpenChange(false))

  // Size and styling
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
  width?: string; // e.g., "600px", "80vw" - overrides size if provided
  fullScreen?: boolean; // If true, modal takes entire viewport
  maxHeight?: string; // e.g., "90vh", "600px"
  className?: string;
  contentClassName?: string;

  // Behavior
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  preventClose?: boolean; // Prevent closing (useful for loading states)

  // Accessibility
  ariaLabel?: string;
  ariaDescribedBy?: string;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  full: "max-w-[95vw]",
};

export const GenericModal = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  GenericModalProps
>(
  (
    {
      open,
      onOpenChange,
      title,
      description,
      icon: Icon,
      iconClassName,
      headerActions,
      children,
      footerButtons = [],
      footerContent,
      showDefaultClose = false,
      onClose,
      size = "lg",
      width,
      maxHeight = "90vh",
      fullScreen = false,
      className,
      contentClassName,
      closeOnOverlayClick = true,
      closeOnEscape = true,
      preventClose = false,
      ariaLabel,
      ariaDescribedBy,
    },
    ref
  ) => {
    const handleClose = React.useCallback(() => {
      if (preventClose) return;
      if (onClose) {
        onClose();
      } else {
        onOpenChange(false);
      }
    }, [preventClose, onClose, onOpenChange]);

    const handleOpenChange = React.useCallback(
      (newOpen: boolean) => {
        if (preventClose && !newOpen) return;
        onOpenChange(newOpen);
      },
      [preventClose, onOpenChange]
    );

    // Determine if we should show footer
    const showFooter = footerButtons.length > 0 || showDefaultClose || !!footerContent;

    // Default close button if no custom buttons and showDefaultClose is true
    const defaultButtons: ModalButtonConfig[] =
      showDefaultClose && footerButtons.length === 0
        ? [
            {
              label: "Close",
              onClick: handleClose,
              variant: "outline",
            },
          ]
        : [];

    const allButtons = [...footerButtons, ...defaultButtons];

    // Determine the width to use: user-provided width, or default 1152px
    const modalWidth = width || "1152px";

      // Full screen positioning classes
    const positioningClasses = fullScreen
      ? "fixed inset-0 z-[100] flex flex-col h-screen w-screen border-0 bg-background shadow-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 rounded-none m-0 p-0"
      : "fixed left-[50%] top-[50%] z-50 flex flex-col translate-x-[-50%] translate-y-[-50%] gap-0 border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg";

    return (
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
               !closeOnOverlayClick && "pointer-events-none",
              fullScreen && "bg-background z-[90] opacity-100"
            )}
            onClick={closeOnOverlayClick ? handleClose : undefined}
          />
          <DialogPrimitive.Content
            ref={ref}
            className={cn(
             positioningClasses,
              // Only apply w-full and size classes if width is not provided and not fullScreen
              !width && !fullScreen && "w-full",
              !width && !fullScreen && sizeClasses[size],
              className
            )}
            style={fullScreen ? {
              width: "100vw",
              height: "100vh",
              maxWidth: "100vw",
              maxHeight: "100vh",
              minWidth: "100vw",
              minHeight: "100vh",
              left: 0,
              top: 0,
              right: 0,
              bottom: 0,
              transform: "none",
              margin: 0,
              padding: 0,
            } : {
              width: modalWidth,
              minWidth: modalWidth,
              maxWidth: modalWidth,
              maxHeight: maxHeight,
            }}
            aria-label={ariaLabel || title}
            aria-describedby={ariaDescribedBy}
            onEscapeKeyDown={(e) => {
              if (!closeOnEscape || preventClose) {
                e.preventDefault();
              }
            }}
            onInteractOutside={(e) => {
               // Allow interactions with Radix UI Select, Popover, and other dropdown components
              const target = e.target as HTMLElement;
              // Check if the click is on a Radix UI portal element (Select, Popover, etc.)
              const isRadixPortal = target.closest('[data-radix-portal]') ||
                target.closest('[data-radix-select-content]') ||
                target.closest('[data-radix-popper-content-wrapper]') ||
                target.closest('[role="listbox"]') ||
                target.closest('[data-radix-popover-content]') ||
                target.closest('[data-radix-select-viewport]') ||
                target.closest('[data-radix-select-item]') ||
                target.hasAttribute('data-radix-select-content') ||
                target.hasAttribute('data-radix-popover-content');
              
              if (isRadixPortal) {
                return; // Allow the interaction, don't prevent default
              }
              if (!closeOnOverlayClick || preventClose) {
                e.preventDefault();
              }
            }}
          >
            {/* Header - Fixed */}
       <div className={cn("flex-shrink-0 px-6 pt-6 pb-4 border-b", fullScreen && "pt-4")}>
              <div className="flex items-start gap-3">
                {Icon && (
                  <div
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 dark:bg-primary/20 flex-shrink-0",
                      iconClassName
                    )}
                  >
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight">
                    {title}
                  </DialogPrimitive.Title>
                  {description && (
                    <DialogPrimitive.Description className="mt-1.5 text-sm text-muted-foreground">
                      {description}
                    </DialogPrimitive.Description>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {headerActions}
                  {!preventClose && (
                    <DialogPrimitive.Close
                      className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
                      onClick={handleClose}
                      aria-label="Close dialog"
                    >
                      <X className="h-4 w-4" />
                      <span className="sr-only">Close</span>
                    </DialogPrimitive.Close>
                  )}
                </div>
              </div>
            </div>

            {/* Scrollable Content Area */}
            <div
              className={cn(
                "flex-1 overflow-y-auto px-6 py-4 scrollbar-thin focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                contentClassName
              )}
              style={fullScreen ? { 
                flex: "1 1 auto",
                height: "auto",
                minHeight: 0,
                overflowY: "auto"
              } : { 
                maxHeight: `calc(${maxHeight} - 180px)` 
              }} // Reserve space for header and footer
              tabIndex={0}
              role="region"
              aria-label="Modal content"
            >
              {children}
            </div>

            {/* Footer - Fixed */}
            {showFooter && (
              <div className="flex-shrink-0 px-6 pb-6 pt-4 border-t bg-muted/50">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  {footerContent ? (
                    <div className="min-w-0 flex-1">{footerContent}</div>
                  ) : (
                    <div className="hidden sm:block sm:flex-1" />
                  )}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-2">
                    {allButtons.map((button, index) => (
                      <Button
                        key={index}
                        variant={button.variant || "default"}
                        onClick={button.onClick}
                        disabled={
                          button.disabled || button.loading || preventClose
                        }
                        className={button.className}
                        data-testid={button["data-testid"]}
                      >
                        {button.loading && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        {button.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }
);

GenericModal.displayName = "GenericModal";
