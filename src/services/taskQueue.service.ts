// src/services/taskQueue.service.ts
import 'reflect-metadata';
// THAY ĐỔI: Bỏ singleton, dùng injectable
import { injectable, inject } from 'tsyringe';
import PQueue from 'p-queue';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../utils/errorUtils';

@injectable() // <<< THAY ĐỔI Ở ĐÂY
export class TaskQueueService {
    private readonly logger: Logger;
    private readonly queue: PQueue;
    public readonly concurrency: number;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        // Logger này giờ sẽ là một phần của request-specific container,
        // nhưng để đơn giản, ta vẫn có thể tạo nó như cũ.
        this.logger = this.loggingService.getLogger('conference', { service: 'TaskQueueService' });

        // Đọc biến CRAWL_CONCURRENCY (giới hạn cho mỗi request)
        this.concurrency = this.configService.crawlConcurrency;

        // Khởi tạo PQueue cho request này
        this.queue = new PQueue({ concurrency: this.concurrency });
        this.logger.info({
            event: 'request_queue_init',
            concurrency: this.concurrency
        }, `Request-specific task queue initialized with concurrency: ${this.concurrency}.`);

        // Các event listener giữ nguyên, chúng sẽ log cho queue của request này
        this.queue.on('idle', () => {
            this.logger.debug({ event: 'request_queue_idle' }, 'Request-specific task queue is now idle.');
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