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
