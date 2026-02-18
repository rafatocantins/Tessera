export class SecureClawError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    context: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "SecureClawError";
    this.code = code;
    this.context = context;
    // Maintain proper stack trace in V8 (available in Node.js)
    const ErrorWithCapture = Error as typeof Error & {
      captureStackTrace?: (target: object, ctor: unknown) => void;
    };
    if (ErrorWithCapture.captureStackTrace) {
      ErrorWithCapture.captureStackTrace(this, this.constructor);
    }
  }
}
