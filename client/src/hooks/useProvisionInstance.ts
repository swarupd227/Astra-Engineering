import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { provisioningService } from "@/services/provisioningService";
import type { CreateInstancePayload, ProvisionInstanceResponse } from "@shared/types/provisioning.types";

interface UseProvisionInstanceReturn {
  provision: (payload: CreateInstancePayload, armToken?: string) => void;
  loading: boolean;
  error: string | null;
  data: ProvisionInstanceResponse | null;
}

export const useProvisionInstance = (): UseProvisionInstanceReturn => {
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ payload, armToken }: { payload: CreateInstancePayload; armToken?: string }) =>
      provisioningService.createInstance(payload, armToken),
    onSuccess: () => {
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to provision instance");
    },
  });

  const provision = (payload: CreateInstancePayload, armToken?: string) => {
    setError(null);
    mutation.mutate({ payload, armToken });
  };

  return {
    provision,
    loading: mutation.isPending,
    error,
    data: mutation.data || null,
  };
};
