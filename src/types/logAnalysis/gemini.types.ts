/**
 * @fileoverview Định nghĩa các kiểu dữ liệu cho phân tích chi tiết các tương tác API Gemini (hoặc API AI khác).
 * Cung cấp cái nhìn sâu sắc về hiệu suất, lỗi, và việc sử dụng tài nguyên của API.
 */

/**
 * @interface GeminiApiAnalysis
 * @description Phân tích chi tiết các tương tác API Gemini (hoặc API AI khác).
 */
export interface GeminiApiAnalysis {
    // --- Call Stats ---
    /**
     * @property {number} totalCalls - Tổng số cuộc gọi API được thực hiện tới Gemini (tổng số lần thử chính và dự phòng được tiến hành để gọi).
     */
    totalCalls: number;
    /**
     * @property {number} successfulCalls - Số lượng cuộc gọi API thành công (dẫn đến phản hồi có thể sử dụng được, dù là từ mô hình chính hay dự phòng).
     */
    successfulCalls: number;
    /**
     * @property {number} failedCalls - Số lượng cuộc gọi API thất bại (sau tất cả các lần thử lại cho một mô hình nhất định, và có thể sau khi thử mô hình dự phòng).
     */
    failedCalls: number;
    /**
     * @property {Record<string, number>} callsByType - Phân tích các cuộc gọi API theo loại API cụ thể (ví dụ: 'extract', 'determine', 'cfp').
     */
    callsByType: { [apiType: string]: number };
    /**
     * @property {Record<string, number>} callsByModel - Phân tích các cuộc gọi API theo tên mô hình (ví dụ: 'gemini-pro', 'my-tuned-model').
     */
    callsByModel: { [modelName: string]: number };

    // --- Retry Stats ---
    /**
     * @property {number} totalRetries - Tổng số lần thử lại cuộc gọi API (lần thử > 1 cho một cuộc gọi mô hình nhất định).
     */
    totalRetries: number;
    /**
     * @property {Record<string, number>} retriesByType - Phân tích các lần thử lại theo loại API.
     */
    retriesByType: { [apiType: string]: number };
    /**
     * @property {Record<string, number>} retriesByModel - Phân tích các lần thử lại theo tên mô hình.
     */
    retriesByModel: { [modelName: string]: number };

    // --- Model Usage by API Type and Crawl Model ---
    /**
     * @property {Record<string, Record<string, { calls: number; retries: number; successes: number; failures: number; tokens: number; safetyBlocks: number }>>} modelUsageByApiType -
     * Phân tích chi tiết việc sử dụng mô hình, bao gồm số lần gọi, thử lại, thành công, thất bại, token và các chặn an toàn,
     * được phân loại theo loại API và sau đó theo định danh mô hình cụ thể (tuned/non-tuned).
     * @example
     * {
     *   'extract': {
     *     'gemini-pro (non-tuned)': { calls: 10, retries: 2, successes: 8, failures: 2, tokens: 1000, safetyBlocks: 0 },
     *     'models/my-tuned-model (tuned)': { calls: 5, retries: 1, successes: 4, failures: 1, tokens: 500, safetyBlocks: 0 }
     *   }
     * }
     */
    modelUsageByApiType: {
        [apiType: string]: { // e.g., 'extract', 'determine', 'cfp'
            [modelIdentifier: string]: { // e.g., "gemini-pro (non-tuned)", "models/my-tuned-model (tuned)"
                /** Số lần mô hình cụ thể này được gọi (lần thử ban đầu). */
                calls: number;
                /** Số lần thử lại. */
                retries: number;
                /** Số lần thành công. */
                successes: number;
                /** Số lần thất bại. */
                failures: number;
                /** Số lượng token đã sử dụng. */
                tokens: number;
                /** Số lần bị chặn bởi bộ lọc an toàn. */
                safetyBlocks: number;
            };
        };
    };

    // --- Orchestration Stats ---
    /**
     * @property {object} primaryModelStats - Thống kê về mô hình chính.
     * @property {number} primaryModelStats.attempts - Số lần mô hình chính được chọn cho một cuộc gọi API.
     * @property {number} primaryModelStats.successes - Số lần mô hình chính thành công (trong lần thử đơn lẻ của nó).
     * @property {number} primaryModelStats.failures - Số lần mô hình chính thất bại (trong lần thử đơn lẻ của nó).
     * @property {number} primaryModelStats.preparationFailures - Số lần thất bại trong quá trình `prepareForApiCall` cho mô hình chính.
     * @property {number} primaryModelStats.skippedOrNotConfigured - Số lần bị bỏ qua hoặc không được cấu hình.
     */
    primaryModelStats: {
        attempts: number;
        successes: number;
        failures: number;
        preparationFailures: number;
        skippedOrNotConfigured: number;
    };
    /**
     * @property {object} fallbackModelStats - Thống kê về mô hình dự phòng.
     * @property {number} fallbackModelStats.attempts - Số lần mô hình dự phòng được chọn sau khi mô hình chính thất bại.
     * @property {number} fallbackModelStats.successes - Số lần mô hình dự phòng thành công (sau các lần thử lại của nó).
     * @property {number} fallbackModelStats.failures - Số lần mô hình dự phòng thất bại (sau các lần thử lại của nó).
     * @property {number} fallbackModelStats.preparationFailures - Số lần thất bại trong quá trình `prepareForApiCall` cho mô hình dự phòng.
     * @property {number} fallbackModelStats.notConfiguredWhenNeeded - Số lần mô hình chính thất bại nhưng không có mô hình dự phòng nào khả dụng.
     */
    fallbackModelStats: {
        attempts: number;
        successes: number;
        failures: number;
        preparationFailures: number;
        notConfiguredWhenNeeded: number;
    };
    /**
     * @property {object} fallbackLogic - (Không dùng nữa) Thống kê về logic dự phòng.
     * @deprecated Sử dụng `primaryModelStats` và `fallbackModelStats` thay thế.
     * @property {number} fallbackLogic.attemptsWithFallbackModel - Số lần thử với mô hình dự phòng.
     * @property {number} fallbackLogic.successWithFallbackModel - Số lần thành công với mô hình dự phòng.
     * @property {number} fallbackLogic.primaryModelFailuresLeadingToFallback - Số lần mô hình chính thất bại dẫn đến việc sử dụng mô hình dự phòng.
     * @property {number} fallbackLogic.noFallbackConfigured - Số lần không có mô hình dự phòng nào được cấu hình.
     * @property {number} fallbackLogic.failedAfterFallbackAttempts - Số lần thất bại sau khi thử lại với mô hình dự phòng.
     */
    fallbackLogic: {
        attemptsWithFallbackModel: number;
        successWithFallbackModel: number;
        primaryModelFailuresLeadingToFallback: number;
        noFallbackConfigured: number;
        failedAfterFallbackAttempts: number;
    };


    // --- Token Usage ---
    /**
     * @property {number} totalTokens - Tổng số token đã tiêu thụ trên tất cả các cuộc gọi API Gemini.
     */
    totalTokens: number;

    // --- Error & Limit Stats ---
    /**
     * @property {number} blockedBySafety - Số lượng phản hồi bị chặn do bộ lọc an toàn.
     */
    blockedBySafety: number;
    /**
     * @property {number} rateLimitWaits - Số lần hệ thống phải chờ do giới hạn tốc độ (nội bộ hoặc SDK).
     */
    rateLimitWaits: number;
    /**
     * @property {number} intermediateErrors - Số lượng lỗi trung gian xảy ra trong các cuộc gọi API nhưng có khả năng được thử lại.
     */
    intermediateErrors: number;
    /**
     * @property {Record<string, number>} errorsByType - Một bản đồ các loại lỗi với số lượng của chúng, trong đó các khóa là các chuỗi lỗi đã được chuẩn hóa.
     */
    errorsByType: { [normalizedErrorKey: string]: number };

    // --- Service & Client Initialization ---
    /**
     * @property {object} serviceInitialization - Thống kê về khởi tạo dịch vụ và client.
     * @property {number} serviceInitialization.starts - Số lần khởi tạo không đồng bộ của GeminiApiService bắt đầu.
     * @property {number} serviceInitialization.completes - Số lần khởi tạo không đồng bộ của GeminiApiService hoàn thành.
     * @property {number} serviceInitialization.failures - Số lần khởi tạo không đồng bộ của GeminiApiService thất bại.
     * @property {number} serviceInitialization.lazyAttempts - Số lần thử khởi tạo lười (lazy initialization).
     * @property {number} serviceInitialization.criticallyUninitialized - Số lần không được khởi tạo nghiêm trọng.
     * @property {number} serviceInitialization.clientInitAttempts - Số lần thử khởi tạo client (đối với GeminiClientManagerService cho mỗi khóa).
     * @property {number} serviceInitialization.clientGenAiSuccesses - Số lần khởi tạo client GenAI thành công.
     * @property {number} serviceInitialization.clientCacheManagerSuccesses - Số lần khởi tạo client Cache Manager thành công.
     * @property {number} serviceInitialization.clientInitFailures - Tổng số lần thất bại trong GeminiClientManagerService.
     * @property {number} serviceInitialization.noApiKeysConfigured - Số lần không có khóa API nào được cấu hình.
     * @property {number} serviceInitialization.noClientsInitializedOverall - Tổng số lần không có client nào được khởi tạo.
     */
    serviceInitialization: {
        starts: number;
        completes: number;
        failures: number;
        lazyAttempts: number;
        criticallyUninitialized: number;
        clientInitAttempts: number;
        clientGenAiSuccesses: number;
        clientCacheManagerSuccesses: number;
        clientInitFailures: number;
        noApiKeysConfigured: number;
        noClientsInitializedOverall: number;
    };
    /**
     * @property {number} apiCallSetupFailures - Số lần thất bại cụ thể trong quá trình thiết lập cuộc gọi API (trước khi gọi `generateContent` thực tế).
     */
    apiCallSetupFailures: number;

    // --- Model Preparation (from GeminiModelOrchestratorService) ---
    /**
     * @property {object} modelPreparationStats - Thống kê về chuẩn bị mô hình.
     * @property {number} modelPreparationStats.attempts - Số lần gọi đến `modelOrchestrator.prepareModel`.
     * @property {number} modelPreparationStats.successes - Số lần thành công.
     * @property {number} modelPreparationStats.failures - Số lần thất bại chung trong `modelOrchestrator.prepareModel`.
     * @property {number} modelPreparationStats.criticalFailures - Số lần thất bại nghiêm trọng (ví dụ: `model_orchestration_critical_failure_final_check`).
     */
    modelPreparationStats: {
        attempts: number;
        successes: number;
        failures: number;
        criticalFailures: number;
    };

    // --- API Key Management (from GeminiClientManagerService) ---
    /**
     * @property {object} apiKeyManagement - Thống kê về quản lý khóa API.
     * @property {number} apiKeyManagement.unhandledApiTypeSelections - Số lần lựa chọn loại API không được xử lý.
     * @property {number} apiKeyManagement.noKeysAvailableSelections - Số lần không có khóa nào khả dụng.
     * @property {number} apiKeyManagement.indexOutOfBoundsSelections - Số lần chỉ mục nằm ngoài phạm vi.
     */
    apiKeyManagement: {
        unhandledApiTypeSelections: number;
        noKeysAvailableSelections: number;
        indexOutOfBoundsSelections: number;
    };

    // --- Rate Limiter Setup (from GeminiRateLimiterService) ---
    /**
     * @property {object} rateLimiterSetup - Thống kê về thiết lập bộ giới hạn tốc độ.
     * @property {number} rateLimiterSetup.creationAttempts - Số lần thử tạo.
     * @property {number} rateLimiterSetup.creationSuccesses - Số lần tạo thành công.
     * @property {number} rateLimiterSetup.creationFailures - Số lần tạo thất bại.
     */
    rateLimiterSetup: {
        creationAttempts: number;
        creationSuccesses: number;
        creationFailures: number;
    };

    // --- Few-Shot Preparation ---
    /**
     * @property {object} fewShotPreparation - Thống kê về chuẩn bị Few-Shot.
     * @property {number} fewShotPreparation.attempts - Số lần thử.
     * @property {number} fewShotPreparation.successes - Số lần thành công.
     * @property {object} fewShotPreparation.failures - Số lần thất bại.
     * @property {number} fewShotPreparation.failures.oddPartsCount - Số lần số lượng `Part` lẻ.
     * @property {number} fewShotPreparation.failures.processingError - Số lần lỗi xử lý.
     * @property {object} fewShotPreparation.warnings - Số lần cảnh báo.
     * @property {number} fewShotPreparation.warnings.missingInput - Số lần thiếu đầu vào.
     * @property {number} fewShotPreparation.warnings.missingOutput - Số lần thiếu đầu ra.
     * @property {number} fewShotPreparation.warnings.emptyResult - Số lần kết quả trống.
     * @property {number} fewShotPreparation.configuredButNoData - Số lần được cấu hình nhưng không có dữ liệu.
     * @property {number} fewShotPreparation.disabledByConfig - Số lần bị vô hiệu hóa bởi cấu hình.
     */
    fewShotPreparation: {
        attempts: number;
        successes: number;
        failures: {
            oddPartsCount: number;
            processingError: number;
        };
        warnings: {
            missingInput: number;
            missingOutput: number;
            emptyResult: number;
        };
        configuredButNoData: number;
        disabledByConfig: number;
    };

    // --- Request Payload Logging ---
    /**
     * @property {object} requestPayloadLogging - Thống kê về ghi nhật ký payload yêu cầu.
     * @property {number} requestPayloadLogging.successes - Số lần ghi nhật ký thành công.
     * @property {number} requestPayloadLogging.failures - Số lần ghi nhật ký thất bại.
     */
    requestPayloadLogging: {
        successes: number;
        failures: number;
    };

    // --- Generate Content (model.generateContent() calls) ---
    /**
     * @property {object} generateContentInternal - Thống kê về các cuộc gọi `model.generateContent()`.
     * @property {number} generateContentInternal.attempts - Số lần thử.
     * @property {number} generateContentInternal.successes - Số lần thành công.
     * (Các thất bại thường được `RetryHandler` xử lý và ghi nhật ký là lỗi trung gian/cuối cùng.)
     */
    generateContentInternal: {
        attempts: number;
        successes: number;
    };

    // --- Cache Specifics ---
    /**
     * @property {object} cacheDecisionStats - Thống kê quyết định sử dụng cache.
     * @property {number} cacheDecisionStats.cacheUsageAttempts - Số lần cache được xem xét sử dụng (`shouldUseCache` là true trong `prepareModel`).
     * @property {number} cacheDecisionStats.cacheExplicitlyDisabled - Số lần cache bị tắt rõ ràng cho một cuộc gọi (`shouldUseCache` là false).
     */
    cacheDecisionStats: {
        cacheUsageAttempts: number;
        cacheExplicitlyDisabled: number;
    };
    /**
     * @property {number} cacheContextHits - Số lần sử dụng thành công thực tế của một mô hình đã được cache.
     */
    cacheContextHits: number;
    /**
     * @property {number} cacheContextAttempts - Số lần gọi `getOrCreateContext`.
     */
    cacheContextAttempts: number;
    /**
     * @property {number} cacheContextCreationSuccess - Số lần cache mới được tạo thành công thông qua SDK.
     */
    cacheContextCreationSuccess: number;
    /**
     * @property {number} cacheContextRetrievalSuccess - Số lần cache hiện có được truy xuất thành công thông qua SDK (một phần của `getOrCreateContext`).
     */
    cacheContextRetrievalSuccess: number;
    /**
     * @property {number} cacheContextMisses - (Không dùng nữa) Số lần bỏ lỡ cache context.
     * @deprecated Đã được bao gồm bởi `cacheContextCreationSuccess + cacheContextRetrievalSuccess` so với `cacheContextAttempts`.
     */
    cacheContextMisses: number;
    /**
     * @property {number} cacheContextCreationFailed - Số lần thất bại trong `getOrCreateContext` (SDK hoặc logic).
     */
    cacheContextCreationFailed: number;
    /**
     * @property {number} cacheContextInvalidations - Số lần cache context bị vô hiệu hóa.
     */
    cacheContextInvalidations: number;
    /**
     * @property {number} cacheContextRetrievalFailures - Số lần thất bại trong `getSdkCache`.
     */
    cacheContextRetrievalFailures: number;
    /**
     * @property {number} cacheMapLoadAttempts - Số lần thử tải bản đồ cache.
     */
    cacheMapLoadAttempts: number;
    /**
     * @property {number} cacheMapLoadFailures - Số lần tải bản đồ cache thất bại.
     */
    cacheMapLoadFailures: number;
    /**
     * @property {boolean | null} [cacheMapLoadSuccess] - Cho biết liệu việc tải bản đồ cache có thành công hay không.
     */
    cacheMapLoadSuccess?: boolean | null;
    /**
     * @property {number} cacheMapWriteAttempts - Số lần thử ghi bản đồ cache.
     */
    cacheMapWriteAttempts: number;
    /**
     * @property {number} cacheMapWriteSuccessCount - Số lần ghi bản đồ cache thành công.
     */
    cacheMapWriteSuccessCount: number;
    /**
     * @property {number} cacheMapWriteFailures - Số lần ghi bản đồ cache thất bại.
     */
    cacheMapWriteFailures: number;
    /**
     * @property {number} cacheManagerCreateFailures - (Không dùng nữa) Số lần tạo Cache Manager thất bại.
     * @deprecated Đã được bao gồm bởi `serviceInitialization.clientInitFailures` hoặc các lỗi Cache Manager cụ thể.
     */
    cacheManagerCreateFailures: number;


    // --- Response Processing (from GeminiResponseHandlerService & GeminiApiService) ---
    /**
     * @property {object} responseProcessingStats - Thống kê về xử lý phản hồi.
     * @property {number} responseProcessingStats.markdownStripped - Số lần thao tác loại bỏ markdown thành công.
     * @property {number} responseProcessingStats.jsonValidationsSucceededInternal - Số lần xác thực JSON thành công bởi `ResponseHandler.processResponse`.
     * @property {number} responseProcessingStats.jsonValidationFailedInternal - Số lần xác thực JSON thất bại bởi `ResponseHandler.processResponse` (những lỗi này thường gây ra ngoại lệ và dẫn đến thử lại).
     * @property {number} responseProcessingStats.jsonCleaningSuccessesPublic - Số lần làm sạch JSON cuối cùng thành công bởi `GeminiApiService.cleanJsonResponse`.
     * @property {number} responseProcessingStats.emptyAfterProcessingInternal - Số lần văn bản phản hồi trống sau khi xử lý nội bộ (loại bỏ markdown, v.v.).
     * @property {number} responseProcessingStats.publicMethodFinishes - Số lần một phương thức API công khai (extract, determine, cfp) hoàn thành thành công.
     * @property {number} responseProcessingStats.trailingCommasFixed - Số lần dấu phẩy thừa được sửa.
     * @property {number} responseProcessingStats.blockedBySafetyInResponseHandler - Số lần phản hồi bị chặn bởi cài đặt an toàn (được phát hiện trong `ResponseHandler`).
     * @property {number} responseProcessingStats.responseFileWrites - Số lần ghi tệp cho phản hồi.
     * @property {number} responseProcessingStats.responseFileWriteFailures - Số lần ghi tệp phản hồi thất bại.
     */
    responseProcessingStats: {
        markdownStripped: number;
        jsonValidationsSucceededInternal: number;
        jsonValidationFailedInternal: number;
        jsonCleaningSuccessesPublic: number;
        emptyAfterProcessingInternal: number;
        publicMethodFinishes: number;
        trailingCommasFixed: number;
        blockedBySafetyInResponseHandler: number;
        responseFileWrites: number;
        responseFileWriteFailures: number;
    };

    // --- Config Errors ---
    /**
     * @property {number} serviceInitializationFailures - (Không dùng nữa) Số lần khởi tạo dịch vụ thất bại.
     * @deprecated Đã được bao gồm bởi `serviceInitialization` hoặc các bộ đếm lỗi cấu hình cụ thể.
     */
    serviceInitializationFailures: number;
    /**
     * @property {object} configErrors - Các lỗi cấu hình.
     * @property {number} configErrors.modelListMissing - Số lần danh sách mô hình bị thiếu (cho một loại API cụ thể).
     * @property {number} configErrors.apiTypeConfigMissing - Số lần cấu hình chung cho một loại API không tìm thấy.
     * (Các lỗi cấu hình cụ thể khác có thể được thêm vào đây)
     */
    configErrors: {
        modelListMissing: number;
        apiTypeConfigMissing: number;
    };
}