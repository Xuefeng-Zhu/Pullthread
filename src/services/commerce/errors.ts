export class CommerceError extends Error {
  constructor(message: string, readonly code: 'unavailable' | 'busy' | 'invalid' | 'account' | 'network' | 'insufficient_points' = 'network',
    readonly operationId?: string) {
    super(message);
    this.name = 'CommerceError';
  }
}

/** Only this bound server refusal proves that the prepared intent did not debit. */
export function isInsufficientPointsError(error: unknown, operationId: string): boolean {
  return error instanceof CommerceError && error.code === 'insufficient_points' && error.operationId === operationId;
}

export function redemptionError(error: unknown, operationId: string): unknown {
  const failure = error as { code?: unknown; details?: { reason?: unknown; operationId?: unknown } } | null;
  if (failure?.code === 'functions/resource-exhausted' && failure.details?.reason === 'insufficient_points'
    && failure.details.operationId === operationId) {
    return new CommerceError('You need more points for this tool.', 'insufficient_points', operationId);
  }
  return error;
}

export function commerceErrorMessage(error: unknown): string {
  return error instanceof CommerceError ? error.message : 'We couldn’t confirm the latest balance. Please try again.';
}
