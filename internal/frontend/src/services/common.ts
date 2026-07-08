export class ApiError {
  readonly _tag = "ApiError";
  readonly message: string;
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    this.message = message;
    this.status = status;
    this.endpoint = endpoint;
  }
}

export function catchToApiError(endpoint: string): (e: unknown) => ApiError {
  return (e) => {
    if (
      typeof e === "object" &&
      e !== null &&
      "status" in e &&
      typeof (e as Record<string, unknown>).status === "number"
    ) {
      return new ApiError(String(e), (e as { status: number }).status, endpoint);
    }
    return new ApiError(String(e), 0, endpoint);
  };
}
