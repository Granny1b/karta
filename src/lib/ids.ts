import { ulid } from 'ulid';
import type { Id } from '@/domain/board';

/** Monotonic, lexicographically sortable id. 26 chars. */
export const newId = (): Id => ulid();
