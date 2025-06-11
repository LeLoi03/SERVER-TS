// src/utils/logAnalysis/taskLifecycleHandlers/index.ts

/**
 * This file serves as the single entry point for all task lifecycle related log event handlers.
 * It aggregates handlers from different modules into a single map for the main dispatcher.
 */

import { LogEventHandler } from '../index';
import { handleRecrawlDetected } from './info.handlers';
import {
    handleTaskStart,
    handleTaskFinish,
    handleTaskSkipped,
    handleTaskUnhandledError,
} from './status.handlers';

export const taskLifecycleEventHandlers: { [key: string]: LogEventHandler } = {
    'task_start': handleTaskStart,
    'task_finish': handleTaskFinish,
    'task_unhandled_error': handleTaskUnhandledError,
    'task_skipped': handleTaskSkipped,
    'recrawl_detected': handleRecrawlDetected,
};