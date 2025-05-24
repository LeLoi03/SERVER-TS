// src/services/apiKey.manager.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { Mutex } from 'async-mutex';
import { getErrorMessageAndStack } from '../utils/errorUtils'; // Import the error utility

/**
 * Interface representing the internal state and metadata for a single API key.
 */
interface ApiKeyInfo {
    /** The actual API key string. */
    key: string;
    /** The number of times this key has been used. */
    usageCount: number;
    /** The Unix timestamp (milliseconds) when this key was last used. */
    lastUsed: number;
    /** A flag indicating if this key is considered exhausted (e.g., hit usage limit or explicitly marked). */
    isExhausted: boolean;
}

/**
 * Manages a pool of Google Custom Search API keys, providing key rotation,
 * usage tracking, and handling of exhaustion and rotation delays.
 * Ensures thread-safe access to key management operations using a Mutex.
 */
@singleton()
export class ApiKeyManager {
    private keys: ApiKeyInfo[];
    private currentKeyIndex: number = -1; // -1 indicates no key has been selected yet
    private totalRequests: number = 0; // Total requests made across all keys
    private readonly maxUsagePerKey: number; // Max uses before a key is marked exhausted
    private readonly rotationDelay: number; // Minimum delay between consecutive uses of the same key (in ms)
    private readonly serviceBaseLogger: Logger;
    private readonly mutex = new Mutex(); // Ensures only one operation modifies key state at a time

    /**
     * Constructs an instance of ApiKeyManager.
     * Initializes the key pool based on configuration.
     *
     * @param {ConfigService} configService - Service for application configuration.
     * @param {LoggingService} loggingService - Service for logging operations.
     * @throws {Error} If no Google Search API keys are found in configuration.
     */
    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('main', { service: 'ApiKeyManagerBase' });

        const apiKeys = this.configService.config.GOOGLE_CUSTOM_SEARCH_API_KEYS;
        this.maxUsagePerKey = this.configService.config.MAX_USAGE_PER_KEY;
        this.rotationDelay = this.configService.config.KEY_ROTATION_DELAY_MS;

        if (!apiKeys || apiKeys.length === 0) {
            this.serviceBaseLogger.error({ event: 'api_key_manager_init_no_keys_error' }, 'Critical: No Google Search API keys found in configuration. Please set GOOGLE_CUSTOM_SEARCH_API_KEYS.');
            throw new Error('Google Search API keys are required for ApiKeyManager to function.');
        }

        this.keys = apiKeys.map(key => ({
            key,
            usageCount: 0,
            lastUsed: 0,
            isExhausted: false,
        }));

        this.serviceBaseLogger.info(
            {
                keyCount: this.keys.length,
                maxUsagePerKey: this.maxUsagePerKey,
                rotationDelayMs: this.rotationDelay,
                event: 'api_key_manager_init_success'
            },
            `ApiKeyManager initialized with ${this.keys.length} API keys. Max usage per key: ${this.maxUsagePerKey}, Rotation delay: ${this.rotationDelay}ms.`
        );
    }

    /**
     * Helper to get a child logger with method context.
     * @param {Logger | undefined} parentLogger - An optional parent logger to inherit from.
     * @param {string} methodName - The name of the method for context.
     * @param {object} [additionalContext] - Optional: Additional context to add to the logger.
     * @returns {Logger} A new Logger instance with service method context.
     */
    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `ApiKeyManager.${methodName}`, ...additionalContext });
    }

    /**
     * Retrieves the next available API key from the pool.
     * This operation is thread-safe, ensuring only one consumer updates key state at a time.
     * It handles key rotation, usage limits, and delays.
     *
     * @param {Logger} [parentLogger] - An optional parent logger to inherit from.
     * @returns {Promise<string | null>} A Promise that resolves with an available API key string,
     *                                   or null if all keys are exhausted or unusable.
     */
    public async getNextKey(parentLogger?: Logger): Promise<string | null> {
        // `runExclusive` ensures that only one call to getNextKey can execute this block at a time.
        return this.mutex.runExclusive(async () => {
            const logger = this.getMethodLogger(parentLogger, 'getNextKey_locked');
            const initialKeyIndexAttempt = this.currentKeyIndex;

            // Determine the starting point for key search:
            // If no key was ever selected (-1), start from index 0.
            // Otherwise, start from the next key in a circular manner.
            const startIndex = (this.currentKeyIndex === -1) ? 0 : (this.currentKeyIndex + 1) % this.keys.length;

            for (let i = 0; i < this.keys.length; i++) {
                const keyIndexToTry = (startIndex + i) % this.keys.length;
                const keyInfo = this.keys[keyIndexToTry];
                const keyContext = { keyIndex: keyIndexToTry, currentUsage: keyInfo.usageCount, isExhaustedFlag: keyInfo.isExhausted };

                // 1. Skip if key is explicitly marked as exhausted
                if (keyInfo.isExhausted) {
                    logger.debug({ ...keyContext, event: 'key_check_skipped_exhausted_flag_locked' }, `Key at index ${keyIndexToTry} is marked exhausted. Skipping.`);
                    continue;
                }

                // 2. Check if key has reached its usage limit
                if (keyInfo.usageCount >= this.maxUsagePerKey) {
                    logger.warn({ ...keyContext, maxUsage: this.maxUsagePerKey, event: 'api_key_usage_limit_reached_locked' }, `Key at index ${keyIndexToTry} reached usage limit (${keyInfo.usageCount}/${this.maxUsagePerKey}). Marking as exhausted.`);
                    keyInfo.isExhausted = true; // Mark as exhausted within the lock
                    continue; // Try the next key
                }

                const now = Date.now();
                // 3. Apply rotation delay if:
                //    a) This is NOT the first key selection ever (currentKeyIndex !== -1)
                //    b) The key being tried IS the previously selected key (keyIndexToTry === this.currentKeyIndex)
                //    c) The time since last use is less than the required rotation delay
                //    d) A rotation delay is configured (> 0)
                if (
                    this.currentKeyIndex !== -1 && // A key has been used before
                    keyIndexToTry === this.currentKeyIndex && // We are checking the same key again immediately
                    (now - keyInfo.lastUsed) < this.rotationDelay &&
                    this.rotationDelay > 0
                ) {
                    const waitTime = this.rotationDelay - (now - keyInfo.lastUsed);
                    logger.debug({ ...keyContext, waitTimeMs: waitTime, event: 'key_rotation_delay_wait_locked' }, `Applying rotation delay of ${waitTime}ms for key ${keyIndexToTry}.`);
                    await new Promise(resolve => setTimeout(resolve, waitTime)); // Mutex remains held during this wait

                    // After waiting, re-check the key's status in case anything changed
                    // (less likely with a global mutex, but good defensive practice)
                    if (keyInfo.isExhausted || keyInfo.usageCount >= this.maxUsagePerKey) {
                        logger.warn({ ...keyContext, event: 'key_check_failed_after_delay_locked' }, `Key ${keyIndexToTry} became unusable after rotation delay. Trying next.`);
                        continue; // Try the next key
                    }
                }

                // If the key passes all checks, select it
                this.currentKeyIndex = keyIndexToTry;
                keyInfo.usageCount++; // Increment usage count
                keyInfo.lastUsed = Date.now(); // Update last used timestamp
                this.totalRequests++; // Increment total requests
                logger.info({
                     keyIndex: this.currentKeyIndex,
                     newUsageCount: keyInfo.usageCount,
                     totalRequestsAcrossAllKeys: this.totalRequests,
                     event: 'api_key_provided_locked'
                }, `Providing API key at index ${this.currentKeyIndex}. New usage: ${keyInfo.usageCount}.`);
                return keyInfo.key; // Return the selected key
            }

            // If the loop completes, it means all keys are exhausted or unusable
            logger.error({
                initialScanStartIndex: startIndex,
                checkedKeysCount: this.keys.length,
                currentKeyIndexAtLoopEnd: this.currentKeyIndex,
                keysStatus: this.keys.map(k => ({ keyPrefix: k.key.substring(0,5)+'...', usage: k.usageCount, exhausted: k.isExhausted })),
                event: 'api_keys_all_exhausted_checked_locked'
            }, "All API keys are exhausted or unusable after checking all available keys within the locked section.");
            return null; // All keys exhausted
        });
    }

    /**
     * Forcibly rotates the current API key (if one is active) by marking it as exhausted,
     * and then attempts to retrieve a new key. Useful for responding to external quota errors.
     * This operation is thread-safe.
     *
     * @param {Logger} [parentLogger] - An optional parent logger to inherit from.
     * @returns {Promise<boolean>} A Promise that resolves to true if a new key was successfully rotated to,
     *                             false otherwise (e.g., all keys are already exhausted).
     */
    public async forceRotate(parentLogger?: Logger): Promise<boolean> {
        return this.mutex.runExclusive(async () => {
            const logger = this.getMethodLogger(parentLogger, 'forceRotate_locked');
            const oldKeyIndex = this.currentKeyIndex;

            if (this.currentKeyIndex === -1) {
                 logger.warn({ event: 'force_rotate_no_active_key_locked' }, "Force rotate called but no API key was previously selected. Attempting to get a new key directly.");
            } else {
                const currentKeyInfo = this.keys[this.currentKeyIndex];
                if (!currentKeyInfo.isExhausted) {
                    logger.warn({ keyIndex: this.currentKeyIndex, currentUsage: currentKeyInfo.usageCount, event: 'force_rotate_marking_exhausted_locked' }, `Forcing current key (index ${this.currentKeyIndex}) to exhausted due to external error (e.g., quota exceeded).`);
                    currentKeyInfo.isExhausted = true; // Mark as exhausted
                } else {
                    logger.debug({ keyIndex: this.currentKeyIndex, event: 'force_rotate_already_exhausted_locked' }, `Current key (index ${this.currentKeyIndex}) was already marked exhausted. Proceeding to find next key.`);
                }
            }

            // Attempt to get the next available key. `getNextKey()` is also mutex-protected.
            // Since `runExclusive` is reentrant for the same async context, this nested call
            // will execute sequentially after the preceding logic in `forceRotate`.
            const nextKey = await this.getNextKey(logger); // Pass logger to maintain context

            if (nextKey) {
                // `this.currentKeyIndex` would have been updated by `getNextKey`
                logger.info({ oldKeyIndex, newKeyIndex: this.currentKeyIndex, event: 'api_key_force_rotated_success_locked' }, `Successfully rotated to a new key (index ${this.currentKeyIndex}) after force rotation.`);
                return true;
            } else {
                logger.error({ oldKeyIndex, event: 'api_key_force_rotated_fail_locked' }, `Failed to rotate to a new key after force rotation. All keys are likely exhausted.`);
                return false;
            }
        });
    }

    /**
     * Checks if all API keys in the pool are currently considered exhausted (either by usage limit or explicit marking).
     * This method does not acquire the mutex as it primarily reads state for logging or early exit conditions.
     * While technically there could be a slight race condition if `getNextKey` or `forceRotate` are modifying state,
     * for its intended purpose (general status check), it's acceptable.
     *
     * @param {Logger} [parentLogger] - An optional parent logger to inherit from.
     * @returns {boolean} True if all keys are exhausted, false otherwise.
     */
    public areAllKeysExhausted(parentLogger?: Logger): boolean {
        const logger = this.getMethodLogger(parentLogger, 'areAllKeysExhausted_check');
        const allExhausted = this.keys.every(k => k.isExhausted || k.usageCount >= this.maxUsagePerKey);
        if (allExhausted) {
             logger.warn({ event: 'api_keys_all_exhausted_status' }, "Check confirmed: All API keys are currently considered exhausted.");
        } else {
            logger.trace({ event: 'api_keys_not_all_exhausted_status' }, "Check: Not all keys are exhausted.");
        }
        return allExhausted;
    }

    /**
     * Returns the index of the currently active API key in the internal array.
     * @returns {number} The 0-based index of the current key, or -1 if no key has been selected yet.
     */
    public getCurrentKeyIndex(): number {
        return this.currentKeyIndex;
    }

    /**
     * Returns the current usage count of the currently active API key.
     * Returns 0 if no key is active.
     * @param {Logger} [parentLogger] - An optional parent logger to inherit from.
     * @returns {number} The usage count of the current key.
     */
    public getCurrentKeyUsage(parentLogger?: Logger): number {
        // No mutex acquired for this read-only operation.
        // The value returned here reflects the state *at the moment of read*.
        // It might be slightly stale if another `getNextKey` is mid-operation,
        // but for general monitoring/logging, this is acceptable.
        if (this.currentKeyIndex !== -1 && this.keys[this.currentKeyIndex]) {
            return this.keys[this.currentKeyIndex].usageCount;
        }
        return 0;
    }

    /**
     * Returns the total number of API requests made across all keys since initialization or last reset.
     * @returns {number} The total count of API requests.
     */
    public getTotalRequests(): number {
        return this.totalRequests;
    }

    /**
     * Resets the usage count and exhausted status for all API keys in the pool.
     * This is useful for daily resets when API quotas renew.
     * This operation is thread-safe.
     *
     * @param {Logger} [parentLogger] - An optional parent logger to inherit from.
     * @returns {Promise<void>} A Promise that resolves when all key states have been reset.
     */
     public async resetAllKeysState(parentLogger?: Logger): Promise<void> {
        return this.mutex.runExclusive(async () => {
            const logger = this.getMethodLogger(parentLogger, 'resetAllKeysState_locked');
            logger.info({ event: 'all_keys_state_reset_start_locked' }, "Initiating reset of state for all API keys.");
            this.keys.forEach(keyInfo => {
                keyInfo.usageCount = 0;
                keyInfo.isExhausted = false;
                keyInfo.lastUsed = 0; // Reset lastUsed as well to ensure rotation delay applies correctly after reset
            });
            this.currentKeyIndex = -1; // Force re-selection of a fresh key from the beginning
            this.totalRequests = 0; // Reset total requests count
            logger.info({
                keyCount: this.keys.length,
                event: 'all_keys_state_reset_finish_locked'
            }, "All API keys have been successfully reset. Next call to getNextKey will select a fresh key.");
        });
    }
}