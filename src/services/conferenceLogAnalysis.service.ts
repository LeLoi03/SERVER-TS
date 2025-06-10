// src/services/conferenceLogAnalysis.service.ts
import 'reflect-metadata';
import { singleton, inject, delay } from 'tsyringe';
import fsSync from 'fs';
import { Logger } from 'pino';
import { ConferenceLogAnalysisResult } from '../types/logAnalysis';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { LogAnalysisCacheService } from './logAnalysisCache.service';
import { createConferenceKey } from '../utils/logAnalysisConference/helpers';

// Import các service phụ đã được tách ra
import {
    ConferenceLogReaderService,
    SingleConferenceRequestAnalyzerService,
    ConferenceAnalysisAggregatorService
} from './logAnalysis/conference';

@singleton()
export class ConferenceLogAnalysisService {
    private readonly serviceLogger: Logger;
    private readonly conferenceRequestLogBaseDir: string;
    private readonly saveConferenceEventsLogFilePath: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(delay(() => LogAnalysisCacheService)) private cacheService: LogAnalysisCacheService,
        // Inject các service phụ
        @inject(ConferenceLogReaderService) private logReader: ConferenceLogReaderService,
        @inject(SingleConferenceRequestAnalyzerService) private singleAnalyzer: SingleConferenceRequestAnalyzerService,
        @inject(ConferenceAnalysisAggregatorService) private aggregator: ConferenceAnalysisAggregatorService
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', {
            service: 'ConferenceLogAnalysisService'
        });
        this.conferenceRequestLogBaseDir = this.configService.appConfiguration.conferenceRequestLogDirectory;
        this.saveConferenceEventsLogFilePath = this.configService.getSaveConferenceEventLogFilePath();

        this.serviceLogger.info({
            event: 'conference_log_analysis_init_success',
            conferenceRequestLogBaseDir: this.conferenceRequestLogBaseDir,
            saveConferenceEventsLogFilePath: this.saveConferenceEventsLogFilePath
        }, `ConferenceLogAnalysisService (Orchestrator) initialized.`);

        // Logic khởi tạo vẫn giữ nguyên
        if (!fsSync.existsSync(this.conferenceRequestLogBaseDir)) {
            this.serviceLogger.warn({ event: 'conference_request_log_dir_not_found_on_init', dirPath: this.conferenceRequestLogBaseDir }, `Conference request log directory not found.`);
        }
        if (!fsSync.existsSync(this.saveConferenceEventsLogFilePath)) {
            this.serviceLogger.warn({ event: 'save_events_log_file_not_found_on_init', logFilePath: this.saveConferenceEventsLogFilePath }, `Save events log file not found.`);
        }
    }

    /**
     * Điểm truy cập chính, điều phối việc phân tích hoặc tổng hợp.
     */
    async performConferenceAnalysisAndUpdate(
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number,
        filterRequestId?: string // Đây là batchRequestId
    ): Promise<ConferenceLogAnalysisResult> {
        const logContext = {
            function: 'performConferenceAnalysisAndUpdate',
            filterRequestId,
            filterStartTime: filterStartTimeInput ? new Date(filterStartTimeInput).toISOString() : undefined,
            filterEndTime: filterEndTimeInput ? new Date(filterEndTimeInput).toISOString() : undefined
        };
        const logger = this.serviceLogger.child(logContext);

        if (filterRequestId) {
            // Trường hợp 1: Phân tích một request ID cụ thể
            logger.info(`Orchestrating analysis for single request ID: ${filterRequestId}`);
            return this.analyzeSingleRequest(filterRequestId, filterStartTimeInput, filterEndTimeInput);
        } else {
            // Trường hợp 2: Tổng hợp tất cả các request
            logger.info(`Orchestrating aggregation for all requests.`);
            return this.aggregateAllRequests(filterStartTimeInput, filterEndTimeInput);
        }
    }

    /**
     * Xử lý logic cho một request duy nhất, bao gồm cả cache.
     */
    private async analyzeSingleRequest(
        batchRequestId: string,
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number
    ): Promise<ConferenceLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'analyzeSingleRequest', batchRequestId });
        const hasTimeFilter = filterStartTimeInput !== undefined || filterEndTimeInput !== undefined;
        const requestLogFilePath = this.configService.getRequestSpecificLogFilePath('conference', batchRequestId);

        // --- LOGIC ĐỌC CACHE (GIỮ NGUYÊN) ---
        if (this.configService.analysisCacheEnabled && !hasTimeFilter) {
            const cachedResult = await this.cacheService.readFromCache<ConferenceLogAnalysisResult>('conference', batchRequestId);

            // Kiểm tra tính toàn vẹn của cache
            let isCacheValid = false;
            if (cachedResult && cachedResult.status && !['Processing', 'Unknown'].includes(cachedResult.status)) {
                // Nếu status là Failed hoặc CompletedWithErrors, nó PHẢI có conferenceAnalysis.
                if (['Failed', 'CompletedWithErrors'].includes(cachedResult.status)) {
                    // Kiểm tra xem có ít nhất một conference con thuộc về request này không
                    const hasConferenceData = Object.values(cachedResult.conferenceAnalysis || {}).some(
                        conf => conf.batchRequestId === batchRequestId
                    );
                    if (hasConferenceData) {
                        isCacheValid = true;
                    } else {
                        // Cache không hợp lệ vì nó báo lỗi nhưng không có chi tiết lỗi
                        logger.warn(`Invalid cache for ${batchRequestId}: Status is '${cachedResult.status}' but no conferenceAnalysis data found. Forcing live analysis.`);
                    }
                } else {
                    // Các trạng thái khác như Completed, Skipped có thể không có conferenceAnalysis (ví dụ request không có item nào)
                    isCacheValid = true;
                }
            }


            if (isCacheValid) {
                logger.info(`Valid cached result found for ${batchRequestId}. Decorating with latest save events.`);
                return this.decorateCachedResultWithSaveEvents(cachedResult!, requestLogFilePath);
            }

            logger.info(cachedResult ? `Cached result for ${batchRequestId} is invalid or stale. Performing live analysis.` : `No cache found for ${batchRequestId}. Performing live analysis.`);
        }

        // --- PHÂN TÍCH LIVE (ỦY THÁC CHO SERVICE PHỤ) ---
        logger.info('Performing live analysis.');
        // 1. Lấy dữ liệu save events
        const saveEventsMap = await this.logReader.readConferenceSaveEvents();
        // 2. Gọi service phân tích
        const analysisResult = await this.singleAnalyzer.analyze(
            batchRequestId,
            requestLogFilePath,
            saveEventsMap,
            filterStartTimeInput,
            filterEndTimeInput
        );

        // --- LOGIC GHI CACHE (GIỮ NGUYÊN) ---
        if (this.configService.analysisCacheEnabled && !hasTimeFilter && analysisResult.status && !['Processing', 'Unknown'].includes(analysisResult.status)) {
            logger.info(`Caching live analysis result for ${batchRequestId}.`);
            await this.cacheService.writeToCache('conference', batchRequestId, analysisResult);
        }

        return analysisResult;
    }

    /**
     * Xử lý logic tổng hợp, ủy thác cho các service phụ.
     */
    private async aggregateAllRequests(
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number
    ): Promise<ConferenceLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'aggregateAllRequests' });

        // 1. Khám phá tất cả các ID request từ cache và file
        const cachedRequestIds = this.configService.analysisCacheEnabled
            ? await this.cacheService.getAllCachedRequestIds('conference')
            : [];
        const liveRequestIds = await this.logReader.discoverRequestIdsFromLogFiles();
        const allUniqueRequestIds = Array.from(new Set([...cachedRequestIds, ...liveRequestIds]));

        logger.info(`Total unique request IDs to aggregate: ${allUniqueRequestIds.length}`);

        // 2. Định nghĩa một hàm "fetcher" để Aggregator sử dụng.
        // Hàm này chứa logic để lấy kết quả cho một ID (chính là hàm analyzeSingleRequest)
        const analysisFetcher = (reqId: string): Promise<ConferenceLogAnalysisResult> => {
            return this.analyzeSingleRequest(reqId, filterStartTimeInput, filterEndTimeInput);
        };

        // 3. Gọi service tổng hợp và truyền vào danh sách ID và hàm fetcher
        return this.aggregator.aggregate(allUniqueRequestIds, analysisFetcher);
    }

    /**
     * "Trang trí" kết quả từ cache với dữ liệu save events mới nhất.
     * Logic này được giữ nguyên từ bản gốc.
     */
    private async decorateCachedResultWithSaveEvents(
        cachedResult: ConferenceLogAnalysisResult,
        logFilePath: string
    ): Promise<ConferenceLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'decorateCachedResultWithSaveEvents', requestId: cachedResult.filterRequestId });
        cachedResult.logFilePath = logFilePath;
        cachedResult.analysisTimestamp = new Date().toISOString();

        const latestSaveEventsMap = await this.logReader.readConferenceSaveEvents();
        let updatedCount = 0;

        Object.values(cachedResult.conferenceAnalysis).forEach(detail => {
            const key = createConferenceKey(detail.batchRequestId, detail.acronym, detail.title);
            if (!key) return;

            const savedEventDetails = latestSaveEventsMap.get(key);
            if (savedEventDetails) {
                if (detail.persistedSaveStatus !== savedEventDetails.recordedStatus || detail.persistedSaveTimestamp !== savedEventDetails.clientTimestamp) {
                    detail.persistedSaveStatus = savedEventDetails.recordedStatus;
                    detail.persistedSaveTimestamp = savedEventDetails.clientTimestamp;
                    updatedCount++;
                }
            } else if (detail.persistedSaveStatus) {
                detail.persistedSaveStatus = undefined;
                detail.persistedSaveTimestamp = undefined;
                updatedCount++;
            }
        });

        if (updatedCount > 0) {
            logger.info(`Decorated ${updatedCount} conference details in cached result with latest save statuses.`);
        }
        return cachedResult;
    }
}