import { randomBytes } from 'node:crypto';
import type { Clock, IdGenerator } from '@indaba/core';

/** The wall clock. Decision code never reads it directly; it receives a Clock. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class RandomIdGenerator implements IdGenerator {
  next(hexLength: number): string {
    if (!Number.isInteger(hexLength) || hexLength < 1) {
      throw new RangeError('hexLength must be a positive integer.');
    }
    return randomBytes(Math.ceil(hexLength / 2))
      .toString('hex')
      .slice(0, hexLength);
  }
}
