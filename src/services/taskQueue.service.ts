// src/services/taskQueue.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import PQueue from 'p-queue'; // Import PQueue library
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../utils/errorUtils'; // Import the error utility

/**
 * Service that manages a task queue using `p-queue` to control concurrency
 * for various asynchronous operations (e.g., conference processing tasks).
 * It logs queue status and errors.
 */
@singleton()
export class TaskQueueService {
    private readonly logger: Logger;
    private readonly queue: PQueue; // The underlying PQueue instance
    public readonly concurrency: number; // Configured concurrency limit

    /**
     * Constructs an instance of TaskQueueService.
     * @param {ConfigService} configService - The injected configuration service to get `CRAWL_CONCURRENCY`.
     * @param {LoggingService} loggingService - The injected logging service to obtain a logger instance.
     */
    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.logger = this.loggingService.getLogger('conference', { service: 'TaskQueueService' });
        // Retrieve the concurrency limit from application configuration
        this.concurrency = this.configService.crawlConcurrency;

        // Initialize the PQueue instance with the configured concurrency
        this.queue = new PQueue({ concurrency: this.concurrency });
        this.logger.info({ event: 'task_queue_init_success', concurrency: this.concurrency }, `Task queue initialized with concurrency: ${this.concurrency}.`);

        // --- Event Listeners for PQueue (names are kept consistent with p-queue events) ---
        // 'active' event: Fired when a task starts running.
        this.queue.on('active', () => {
            this.logger.trace({ size: this.queue.size, pending: this.queue.pending, event: 'queue_task_active' }, 'Queue task active. Queue size: %d, pending: %d.', this.queue.size, this.queue.pending);
        });
        // 'idle' event: Fired when the queue becomes empty and all tasks have completed.
        this.queue.on('idle', () => {
            this.logger.debug({ event: 'queue_idle' }, 'Task queue is now idle. All tasks completed.');
        });
        // 'error' event: Fired when a task function throws an uncaught error.
        this.queue.on('error', (error: unknown) => { // Catch as unknown for type safety
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            this.logger.error({ err: { message: errorMessage, stack: errorStack }, event: 'queue_unhandled_task_error' }, `Unhandled error occurred within a queued task: "${errorMessage}".`);
        });
        // 'completed' event: Fired when a task completes successfully (resolves).
        this.queue.on('completed', (result: unknown) => { // Result can be any type or void
            this.logger.trace({ result: result !== undefined ? String(result).substring(0, 100) : '<void>', event: 'queue_task_completed' }, 'Queue task completed.');
        });
        // 'add' event: Fired when a task is added to the queue.
        this.queue.on('add', () => {
            this.logger.trace({ size: this.queue.size, pending: this.queue.pending, event: 'queue_task_added' }, 'Task added to queue. New queue size: %d, pending: %d.', this.queue.size, this.queue.pending);
        });
    }

    /**
     * Adds an asynchronous task function to the queue. The task will be executed
     * when concurrency allows.
     *
     * @template TaskResult The expected return type of the task function.
     * @param {() => Promise<TaskResult | void>} task - An asynchronous function that performs the task.
     *                                                  It should return a Promise resolving to `TaskResult` or `void`.
     * @returns {Promise<TaskResult | void>} A Promise that resolves with the task's result
     *                                      or `void` when the task completes.
     */
    add<TaskResult>(task: () => Promise<TaskResult | void>): Promise<TaskResult | void> {
        this.logger.debug({ event: 'add_task_to_queue', currentSize: this.queue.size, currentPending: this.queue.pending }, 'Adding new task to queue.');
        return this.queue.add(task);
    }

    /**
     * Returns a Promise that resolves when the queue becomes empty and all tasks have completed.
     * This is useful for waiting for all operations to finish before proceeding.
     * @returns {Promise<void>} A Promise that resolves when the queue is idle.
     */
    async onIdle(): Promise<void> {
        this.logger.info({ event: 'queue_waiting_for_idle' }, "Waiting for task queue to become idle...");
        return this.queue.onIdle();
    }

    /**
     * Gets the number of tasks currently waiting to run (queued but not yet executing).
     * @returns {number} The number of pending tasks.
     */
    get size(): number {
        return this.queue.size;
    }

    /**
     * Gets the number of tasks currently running (executing).
     * @returns {number} The number of running tasks.
     */
    get pending(): number {
        return this.queue.pending;
    }
}