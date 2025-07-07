import 'reflect-metadata';
import { singleton } from 'tsyringe';
import PQueue from 'p-queue';
import { ConfigService } from '../config/config.service'; // Giả sử bạn lấy config từ đây
import { container } from 'tsyringe'; // Import container để resolve ConfigService
import { LoggingService } from './logging.service';

/**
 * A singleton service that provides a global concurrency gate.
 * All resource-intensive tasks (like individual conference processing)
 * should be wrapped by this manager's `run` method to ensure
 * the total number of concurrent tasks across all requests does not
 * exceed a global limit.
 */
@singleton()
export class GlobalConcurrencyManagerService {
    private readonly globalQueue: PQueue;
    private readonly logger; // Bạn có thể thêm logger nếu muốn

    constructor() {
        // Vì đây là singleton được tạo sớm, chúng ta cần resolve dependency thủ công
        // hoặc đảm bảo nó được inject đúng cách. Cách đơn giản là resolve trực tiếp.
        const configService = container.resolve(ConfigService);
        const loggingService = container.resolve(LoggingService); // Nếu cần log
        this.logger = loggingService.getLogger('app', { service: 'GlobalConcurrencyManager' });

        // Sử dụng một biến môi trường riêng cho giới hạn toàn cục để rõ ràng hơn
        const globalConcurrency = configService.globalCrawlConcurrency; // Ví dụ: CRAWL_CONCURRENCY_GLOBAL

        this.globalQueue = new PQueue({ concurrency: globalConcurrency });

        this.logger.info(
            { event: 'global_gate_init', concurrency: globalConcurrency },
            `Global concurrency gate initialized with a limit of ${globalConcurrency} tasks.`
        );

        // (Tùy chọn) Thêm listener để theo dõi queue toàn cục
        this.globalQueue.on('active', () => {
            this.logger.trace({
                event: 'global_queue_active',
                size: this.globalQueue.size,
                pending: this.globalQueue.pending
            }, `Global queue task active. Size: ${this.globalQueue.size}, Pending: ${this.globalQueue.pending}`);
        });
    }

    /**
    * Executes a task function through the global concurrency queue.
    * @param task The async function to execute.
    * @returns A promise that resolves with the task's result or void.
    */
    // THAY ĐỔI Ở ĐÂY: Kiểu trả về giờ là Promise<TaskResult | void>
    public run<TaskResult>(task: () => Promise<TaskResult>): Promise<TaskResult | void> {
        return this.globalQueue.add(task);
    }

    /**
     * Gets the number of tasks currently running in the global queue.
     */
    public get pending(): number {
        return this.globalQueue.pending;
    }

    /**
     * Gets the number of tasks waiting to run in the global queue.
     */
    public get size(): number {
        return this.globalQueue.size;
    }
}