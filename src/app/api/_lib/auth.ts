import { getCurrentOrganizationId } from "@/lib/auth-utils";

import { ApiError } from "./responses";

export async function getOrganizationId() {
  try {
    return await getCurrentOrganizationId();
  } catch {
    throw new ApiError("No autorizado", 401);
  }
}
