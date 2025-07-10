// src/services/journalLogAnalysis.service.ts
import 'reflect-metadata';
import { singleton, inject, delay } from 'tsyringe';
import fsSync from 'fs';
import { Logger } from 'pino';
import { JournalLogAnalysisResult } from '../types/logAnalysisJournal/logAnalysisJournal.types';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { LogAnalysisCacheService } from './logAnalysisCache.service';

// Import các service phụ đã được tách ra
import {
    JournalLogReaderService,
    SingleJournalRequestAnalyzerService,
    JournalAnalysisAggregatorService
} from './logAnalysis/journal';

@singleton()
export class JournalLogAnalysisService {
    private readonly serviceLogger: Logger;
    private readonly journalRequestLogBaseDir: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(delay(() => LogAnalysisCacheService)) private cacheService: LogAnalysisCacheService,
        // Inject các service phụ
        @inject(JournalLogReaderService) private logReader: JournalLogReaderService,
        @inject(SingleJournalRequestAnalyzerService) private singleAnalyzer: SingleJournalRequestAnalyzerService,
        @inject(JournalAnalysisAggregatorService) private aggregator: JournalAnalysisAggregatorService
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', {
            service: 'JournalLogAnalysisService'
        });
        this.journalRequestLogBaseDir = this.configService.appConfiguration.journalRequestLogDirectory;

        if (!fsSync.existsSync(this.journalRequestLogBaseDir)) {
            this.serviceLogger.warn({ event: 'journal_request_log_dir_not_found_on_init', dirPath: this.journalRequestLogBaseDir }, `Journal request log directory not found.`);
        }
    }

    /**
     * Điểm truy cập chính, điều phối việc phân tích hoặc tổng hợp.
     */
    public async performJournalAnalysisAndUpdate(
        filterStartTimeInput?: number, // Unix ms
        filterEndTimeInput?: number,   // Unix ms
        filterRequestId?: string
    ): Promise<JournalLogAnalysisResult> {
        if (filterRequestId) {
            // Trường hợp 1: Phân tích một request ID cụ thể
            return this.analyzeSingleRequest(filterRequestId, filterStartTimeInput, filterEndTimeInput);
        } else {
            // Trường hợp 2: Tổng hợp tất cả các request
            return this.aggregateAllRequests(filterStartTimeInput, filterEndTimeInput);
        }
    }

    /**
     * Xử lý logic cho một request duy nhất, bao gồm cả cache.
     */
    private async analyzeSingleRequest(
        batchRequestId: string,
        filterStartTimeInput?: number,
        filterEndTimeInput?: number
    ): Promise<JournalLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'analyzeSingleRequest', batchRequestId });
        const hasTimeFilter = filterStartTimeInput !== undefined || filterEndTimeInput !== undefined;
        const requestLogFilePath = this.configService.getRequestSpecificLogFilePath('journal', batchRequestId);

        // --- LOGIC ĐỌC CACHE (GIỮ NGUYÊN) ---
        if (this.configService.analysisCacheEnabled && !hasTimeFilter) {
            const cachedResult = await this.cacheService.readFromCache<JournalLogAnalysisResult>('journal', batchRequestId);
            // console.log(`Cached result for ${batchRequestId}:`, cachedResult);
            // Áp dụng sửa lỗi TypeScript
            if (cachedResult && cachedResult.status && !['Processing', 'Unknown'].includes(cachedResult.status)) {
                // logger.info(`Returning valid cached journal result for request ID: ${batchRequestId} with status: ${cachedResult.status}`);
                cachedResult.logFilePath = requestLogFilePath;
                cachedResult.analysisTimestamp = new Date().toISOString();
                return cachedResult;
            }
            logger.info(cachedResult ? `Cached journal result for ${batchRequestId} is '${cachedResult.status ?? 'undefined'}'. Performing live analysis.` : `No cache found for journal request ${batchRequestId}. Performing live analysis.`);
        }

        // --- PHÂN TÍCH LIVE (ỦY THÁC CHO SERVICE PHỤ) ---
        logger.info('Performing live analysis.');
        const analysisResult = await this.singleAnalyzer.analyze(
            batchRequestId,
            requestLogFilePath,
            filterStartTimeInput,
            filterEndTimeInput
        );

        // --- LOGIC GHI CACHE (GIỮ NGUYÊN) ---
        // Áp dụng sửa lỗi TypeScript
        if (this.configService.analysisCacheEnabled && !hasTimeFilter && analysisResult.status && !['Processing', 'Unknown'].includes(analysisResult.status)) {
            logger.info(`Caching live journal analysis result (generated without time filter) for ${batchRequestId} with status ${analysisResult.status}.`);
            await this.cacheService.writeToCache('journal', batchRequestId, analysisResult);
        }

        return analysisResult;
    }

    /**
     * Xử lý logic tổng hợp, ủy thác cho các service phụ.
     */
    private async aggregateAllRequests(
        filterStartTimeInput?: number,
        filterEndTimeInput?: number
    ): Promise<JournalLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'aggregateAllRequests' });

        // 1. Khám phá tất cả các ID request từ cache và file
        const cachedRequestIds = this.configService.analysisCacheEnabled
            ? await this.cacheService.getAllCachedRequestIds('journal')
            : [];
        const liveRequestIds = await this.logReader.discoverRequestIdsFromLogFiles();
        const allUniqueRequestIds = Array.from(new Set([...cachedRequestIds, ...liveRequestIds]));


        // 2. Định nghĩa một hàm "fetcher" để Aggregator sử dụng.
        const analysisFetcher = (reqId: string): Promise<JournalLogAnalysisResult> => {
            return this.analyzeSingleRequest(reqId, filterStartTimeInput, filterEndTimeInput);
        };

        // 3. Gọi service tổng hợp
        return this.aggregator.aggregate(allUniqueRequestIds, analysisFetcher);
    }
}