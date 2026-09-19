export class RoleRunError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly subtype?: string,
  ) {
    super(message);
    this.name = 'RoleRunError';
  }
}

export class RoleOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleOutputError';
  }
}
