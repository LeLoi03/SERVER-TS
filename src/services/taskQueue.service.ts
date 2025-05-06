// src/services/taskQueue.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import PQueue from 'p-queue';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';

@singleton()
export class TaskQueueService {
    private readonly logger: Logger;
    private readonly queue: PQueue;
    public readonly concurrency: number;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.logger = this.loggingService.getLogger({ service: 'TaskQueueService' });
        this.concurrency = this.configService.config.CRAWL_CONCURRENCY;
        this.queue = new PQueue({ concurrency: this.concurrency });
        this.logger.info(`Task queue initialized with concurrency: ${this.concurrency}`);

        // --- Event Listeners (remain the same) ---
        this.queue.on('active', () => {
            this.logger.trace({ size: this.queue.size, pending: this.queue.pending }, 'Queue task active');
        });
         this.queue.on('idle', () => {
             this.logger.debug('Task queue is now idle.');
         });
         this.queue.on('error', error => {
             // This catches errors thrown *by the task function* if not caught internally
             this.logger.error({ err: error }, 'Unhandled error occurred within a queued task');
         });
         this.queue.on('completed', (result) => {
              // Result here can be TaskResult or potentially undefined/void
              this.logger.trace({ result: result !== undefined ? result : '<void>' }, 'Queue task completed');
         });
         this.queue.on('add', () => {
             this.logger.trace({ size: this.queue.size, pending: this.queue.pending }, 'Task added to queue');
         });
    }

    /**
     * Adds a task function to the queue.
     * The task function should return a Promise resolving to TaskResult or void.
     * The returned Promise resolves with the task's result or void.
     */
    add<TaskResult>(task: () => Promise<TaskResult | void>): Promise<TaskResult | void> {
        // The return type now correctly reflects the potential void return
        // from p-queue or if TaskResult itself is void.
        return this.queue.add(task);
    }

    /**
     * Returns a Promise that resolves when the queue becomes empty and all tasks have completed.
     */
    async onIdle(): Promise<void> {
        this.logger.debug("Waiting for task queue to become idle...");
        // onIdle itself returns Promise<void>, so this is correct.
        return this.queue.onIdle();
    }

    /**
     * Gets the number of tasks waiting to run (pending).
     */
    get size(): number {
        return this.queue.size;
    }

    /**
     * Gets the number of tasks currently running.
     */
    get pending(): number {
         return this.queue.pending;
    }
}