"use client";

import { toastError, toastSuccess } from "@/components/Toast";
import {
  ActionError,
  type ServerActionResponse,
  captureException,
  isActionError,
} from "@/utils/error";

export function handleActionResult<T>(
  result: ServerActionResponse<T>,
  successMessage: string,
) {
  if (isActionError(result)) {
    toastError({ description: result.error });
  } else {
    toastSuccess({ description: successMessage });
  }
}

export async function handleActionCall<T, E = {}>(
  actionName: string,
  actionFn: () => Promise<ServerActionResponse<T, E>>,
): Promise<ServerActionResponse<T, E>> {
  let result: ServerActionResponse<T, E>;

  try {
    result = await actionFn();
  } catch (error) {
    captureException(error, { extra: { actionName } });
    return { error: String(error) } as ActionError<E>;
  }

  if (isActionError(result)) return result;

  if (!result) {
    captureException("The request did not complete", { extra: { actionName } });
    return { error: "The request did not complete" } as ActionError<E>;
  }

  return result;
}
