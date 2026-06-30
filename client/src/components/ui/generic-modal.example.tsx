/**
 * Example usage of GenericModal component
 *
 * This file demonstrates how to use the GenericModal component.
 * It is not imported anywhere - it's just for reference.
 */

import { useState } from "react";
import { GenericModal, ModalButtonConfig } from "@/components/ui/generic-modal";
import { FileText, Save, X } from "lucide-react";

// Example 1: Basic modal with default close button
export function BasicModalExample() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Open Basic Modal</button>
      <GenericModal
        open={open}
        onOpenChange={setOpen}
        title="Basic Modal"
        description="This is a basic modal with a default close button"
        showDefaultClose={true}
      >
        <p>
          This is the modal content. It will scroll if it exceeds the available
          space.
        </p>
      </GenericModal>
    </>
  );
}

// Example 2: Modal with custom footer buttons
export function CustomButtonsModalExample() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    // Simulate async operation
    await new Promise((resolve) => setTimeout(resolve, 2000));
    setLoading(false);
    setOpen(false);
  };

  const footerButtons: ModalButtonConfig[] = [
    {
      label: "Cancel",
      onClick: () => setOpen(false),
      variant: "outline",
    },
    {
      label: "Save",
      onClick: handleSave,
      variant: "default",
      loading: loading,
      "data-testid": "button-save",
    },
  ];

  return (
    <>
      <button onClick={() => setOpen(true)}>
        Open Modal with Custom Buttons
      </button>
      <GenericModal
        open={open}
        onOpenChange={setOpen}
        title="Save Changes"
        description="Are you sure you want to save these changes?"
        icon={FileText}
        footerButtons={footerButtons}
        size="md"
      >
        <div className="space-y-4">
          <p>This modal has custom footer buttons with loading states.</p>
        </div>
      </GenericModal>
    </>
  );
}

// Example 3: Large modal with icon and scrollable content
export function LargeModalExample() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Open Large Modal</button>
      <GenericModal
        open={open}
        onOpenChange={setOpen}
        title="Large Modal with Icon"
        description="This modal has an icon and scrollable content"
        icon={FileText}
        size="2xl"
        maxHeight="85vh"
        showDefaultClose={true}
      >
        <div className="space-y-4">
          {Array.from({ length: 50 }, (_, i) => (
            <div key={i} className="p-4 border rounded">
              <h3 className="font-semibold">Item {i + 1}</h3>
              <p className="text-sm text-muted-foreground">
                This is item number {i + 1}. The content area will scroll when
                it exceeds the maximum height.
              </p>
            </div>
          ))}
        </div>
      </GenericModal>
    </>
  );
}

// Example 4: Modal that prevents closing during operation
export function PreventCloseModalExample() {
  const [open, setOpen] = useState(false);
  const [processing, setProcessing] = useState(false);

  const handleProcess = async () => {
    setProcessing(true);
    // Simulate long-running operation
    await new Promise((resolve) => setTimeout(resolve, 5000));
    setProcessing(false);
    setOpen(false);
  };

  const footerButtons: ModalButtonConfig[] = [
    {
      label: "Process",
      onClick: handleProcess,
      variant: "default",
      loading: processing,
      disabled: processing,
    },
  ];

  return (
    <>
      <button onClick={() => setOpen(true)}>Open Prevent Close Modal</button>
      <GenericModal
        open={open}
        onOpenChange={setOpen}
        title="Processing"
        description="This modal cannot be closed while processing"
        preventClose={processing}
        closeOnEscape={!processing}
        closeOnOverlayClick={!processing}
        footerButtons={footerButtons}
      >
        <p>
          {processing
            ? "Processing... Please wait. The modal cannot be closed during this operation."
            : "Click Process to start. The modal will prevent closing during the operation."}
        </p>
      </GenericModal>
    </>
  );
}

// Example 5: Modal with custom styling
export function CustomStyledModalExample() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)}>Open Custom Styled Modal</button>
      <GenericModal
        open={open}
        onOpenChange={setOpen}
        title="Custom Styled Modal"
        description="This modal has custom styling"
        size="lg"
        className="border-2 border-primary"
        contentClassName="bg-muted/50"
        showDefaultClose={true}
      >
        <div className="space-y-4">
          <p>This modal has custom border and background styling.</p>
        </div>
      </GenericModal>
    </>
  );
}
