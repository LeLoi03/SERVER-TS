import { singleton } from 'tsyringe';
import { Logger } from 'pino';

@singleton()
export class CrawlProcessManagerService {
    // Sử dụng Map để lưu trạng thái dừng cho mỗi batchRequestId
    private stopFlags: Map<string, boolean> = new Map();

    /**
     * Gửi yêu cầu dừng một tiến trình crawl dựa trên batchRequestId.
     * @param batchRequestId ID của batch cần dừng.
     * @param logger Logger để ghi lại hành động.
     */
    public requestStop(batchRequestId: string, logger: Logger): void {
        logger.warn({ batchRequestId, event: 'stop_request_received' }, `Received stop request for batch ID: ${batchRequestId}.`);
        this.stopFlags.set(batchRequestId, true);
    }

    /**
     * Kiểm tra xem một tiến trình crawl có đang được yêu cầu dừng hay không.
     * @param batchRequestId ID của batch để kiểm tra.
     * @returns {boolean} True nếu có yêu cầu dừng, ngược lại là false.
     */
    public isStopRequested(batchRequestId: string): boolean {
        return this.stopFlags.get(batchRequestId) || false;
    }

    /**
     * Xóa cờ dừng sau khi tiến trình đã hoàn tất việc dừng.
     * @param batchRequestId ID của batch đã dừng.
     * @param logger Logger để ghi lại hành động.
     */
    public clearStopFlag(batchRequestId: string, logger: Logger): void {
        if (this.stopFlags.has(batchRequestId)) {
            logger.info({ batchRequestId, event: 'stop_flag_cleared' }, `Clearing stop flag for batch ID: ${batchRequestId}.`);
            this.stopFlags.delete(batchRequestId);
        }
    }
}