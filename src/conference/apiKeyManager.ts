import { logger } from './11_utils';


// ============================================
// Lớp quản lý API Key
// ============================================
export class ApiKeyManager {
    private readonly keys: readonly string[];
    private readonly maxUsagePerKey: number;
    private readonly rotationDelayMs: number;
    private readonly logger: typeof logger;

    private currentIndex: number = 0;
    private currentUsage: number = 0;
    private totalRequestsInternal: number = 0;
    private isExhausted: boolean = false;

    constructor(keys: string[] | undefined, maxUsage: number, delayMs: number, parentLogger: typeof logger) {
        this.keys = Object.freeze([...(keys || [])]); // Tạo bản sao không thể thay đổi
        this.maxUsagePerKey = maxUsage;
        this.rotationDelayMs = delayMs;
        this.logger = parentLogger.child({ service: 'ApiKeyManager' }); // Logger riêng

        if (this.keys.length === 0) {
            this.logger.error({ event: 'init_error' }, "CRITICAL: No Google API Keys provided to ApiKeyManager. Searches will fail.");
            this.isExhausted = true;
        } else {
            this.logger.info({ keyCount: this.keys.length, maxUsage: this.maxUsagePerKey, event: 'init_success' }, "ApiKeyManager initialized.");
        }
    }

    /**
     * Lấy API Key tiếp theo. Tự động xoay vòng khi đạt giới hạn sử dụng
     * hoặc khi được yêu cầu bởi forceRotate.
     * @returns API key hoặc null nếu tất cả các key đã hết hạn.
     */
    public async getNextKey(): Promise<string | null> {
        if (this.isExhausted) {
            // Log đã được ghi khi isExhausted được set
            return null;
        }

        // Kiểm tra giới hạn sử dụng và xoay vòng nếu cần
        if (this.currentUsage >= this.maxUsagePerKey && this.keys.length > 0) {
            this.logger.info({
                keyIndex: this.currentIndex + 1,
                usage: this.currentUsage,
                limit: this.maxUsagePerKey,
                event: 'usage_limit_reached'
            }, 'API key usage limit reached, attempting rotation.');

            const rotated = await this.rotate(false); // Xoay vòng bình thường
            if (!rotated) {
                // this.isExhausted đã được set bên trong rotate()
                return null;
            }

            // Áp dụng delay *sau khi* xoay vòng thành công (nếu được cấu hình)
            // Xem xét lại sự cần thiết của delay này ở đây
            if (this.rotationDelayMs > 0) {
                this.logger.info({
                    delaySeconds: this.rotationDelayMs / 1000,
                    nextKeyIndex: this.currentIndex + 1,
                    event: 'rotation_delay_start'
                }, `Waiting ${this.rotationDelayMs / 1000}s after normal key rotation...`);
                await new Promise(resolve => setTimeout(resolve, this.rotationDelayMs));
                this.logger.info({ newKeyIndex: this.currentIndex + 1, event: 'rotation_delay_end' }, `Finished waiting, proceeding with new key.`);
            }
        }

        // Lấy key hiện tại, tăng số lượt sử dụng và trả về
        const key = this.keys[this.currentIndex];
        this.currentUsage++;
        this.totalRequestsInternal++;

        this.logger.debug({
            keyIndex: this.currentIndex + 1,
            currentUsage: this.currentUsage,
            limit: this.maxUsagePerKey,
            totalRequests: this.totalRequestsInternal,
            event: 'key_provided'
        }, 'Providing API key');

        return key;
    }

    /**
     * Buộc xoay vòng sang API key tiếp theo, thường dùng khi gặp lỗi 429.
     * @returns true nếu xoay vòng thành công, false nếu đã hết key.
     */
    public async forceRotate(): Promise<boolean> {
        if (this.isExhausted) {
            this.logger.warn({ event: 'force_rotate_skipped' }, "Cannot force rotate key, all keys are already marked as exhausted.");
            return false;
        }
        // Log đã được thực hiện bên trong hàm rotate
        return this.rotate(true); // Gọi hàm xoay nội bộ (là force)
    }

    /**
     * Hàm nội bộ để xử lý logic xoay vòng key.
     * @param isForced Cho biết việc xoay vòng có phải do bị ép buộc (lỗi 429) hay không.
     * @returns true nếu xoay vòng thành công, false nếu hết key.
     */
    private async rotate(isForced: boolean): Promise<boolean> {
        const oldIndex = this.currentIndex;
        this.logger.warn({
            oldKeyIndex: oldIndex + 1,
            reason: isForced ? 'Error (e.g., 429)' : 'Usage Limit Reached',
            event: 'rotation_start'
        }, `Attempting ${isForced ? 'forced ' : ''}rotation to next API key.`);

        this.currentIndex++;
        this.currentUsage = 0; // Reset usage khi xoay

        if (this.currentIndex >= this.keys.length) {
            this.logger.warn({
                rotationType: isForced ? 'forced' : 'normal',
                event: 'rotation_failed_exhausted'
            }, "Rotation failed: Reached end of API key list. Marking all keys as exhausted.");
            this.isExhausted = true;
            return false;
        }

        this.logger.info({
            newKeyIndex: this.currentIndex + 1,
            rotationType: isForced ? 'forced' : 'normal',
            event: 'rotation_success'
        }, "Successfully rotated to new API key.");
        return true;
    }

    // --- Getters để lấy trạng thái (read-only) ---
    public getCurrentKeyIndex(): number {
        return this.currentIndex;
    }

    public getCurrentKeyUsage(): number {
        return this.currentUsage;
    }

    public getTotalRequests(): number {
        return this.totalRequestsInternal;
    }

    public areAllKeysExhausted(): boolean {
        return this.isExhausted;
    }
}
