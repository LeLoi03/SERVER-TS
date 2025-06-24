import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from '../../logging.service';
import { ConferenceLogAnalysisResult } from '../../../types/logAnalysis';
import { getInitialLogAnalysisResult } from '../../../types/logAnalysis/initializers';
import * as ConferenceAnalysisMerger from '../../../utils/logAnalysisConference/conferenceAnalysisMerger.utils';

@singleton()
export class ConferenceAnalysisAggregatorService {
    private readonly serviceLogger: Logger;

    constructor(
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', { service: 'ConferenceAnalysisAggregatorService' });
    }

    /**
     * Merges an array of individual analysis results into a single aggregated result.
     * This service's sole responsibility is to merge pre-filtered data.
     * @param allSingleAnalyses An array of analysis results to be merged.
     */
    async aggregate(
        allSingleAnalyses: ConferenceLogAnalysisResult[]
    ): Promise<ConferenceLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'aggregate' });
        logger.info(`Merging ${allSingleAnalyses.length} individual analysis results into one.`);

        const aggregatedResults: ConferenceLogAnalysisResult = getInitialLogAnalysisResult(undefined);

        if (allSingleAnalyses.length === 0) {
            aggregatedResults.status = 'NoRequestsAnalyzed';
            aggregatedResults.errorMessage = 'No analysis results provided for aggregation.';
            this.finalizeAggregatedResult(aggregatedResults);
            return aggregatedResults;
        }

        for (const singleAnalysis of allSingleAnalyses) {
            // The filterRequestId from a single analysis is its own ID
            const reqId = singleAnalysis.filterRequestId;
            if (!reqId) continue;

            // Add request ID to the list of analyzed IDs
            if (!aggregatedResults.analyzedRequestIds.includes(reqId)) {
                aggregatedResults.analyzedRequestIds.push(reqId);
            }

            // Merge request-specific details (timings, status, etc.)
            if (singleAnalysis.requests[reqId]) {
                aggregatedResults.requests[reqId] = singleAnalysis.requests[reqId];
            }

            // Merge detailed analysis data for each conference
            Object.assign(aggregatedResults.conferenceAnalysis, singleAnalysis.conferenceAnalysis);

            // Merge all counters and statistical data using helper functions
            ConferenceAnalysisMerger.mergeOverallAnalysisCounters(aggregatedResults.overall, singleAnalysis.overall);
            ConferenceAnalysisMerger.mergeGoogleSearchAnalysis(aggregatedResults.googleSearch, singleAnalysis.googleSearch);
            ConferenceAnalysisMerger.mergePlaywrightAnalysis(aggregatedResults.playwright, singleAnalysis.playwright);
            ConferenceAnalysisMerger.mergeGeminiApiAnalysis(aggregatedResults.geminiApi, singleAnalysis.geminiApi);
            ConferenceAnalysisMerger.mergeBatchProcessingAnalysis(aggregatedResults.batchProcessing, singleAnalysis.batchProcessing);
            ConferenceAnalysisMerger.mergeFileOutputAnalysis(aggregatedResults.fileOutput, singleAnalysis.fileOutput);
            ConferenceAnalysisMerger.mergeValidationStats(aggregatedResults.validationStats, singleAnalysis.validationStats);

            // Merge error logs and counts
            aggregatedResults.errorLogCount += singleAnalysis.errorLogCount;
            aggregatedResults.fatalLogCount += singleAnalysis.fatalLogCount;
            for (const key in singleAnalysis.errorsAggregated) {
                aggregatedResults.errorsAggregated[key] = (aggregatedResults.errorsAggregated[key] || 0) + singleAnalysis.errorsAggregated[key];
            }
            singleAnalysis.logProcessingErrors.forEach(err_str => {
                if (!aggregatedResults.logProcessingErrors.includes(err_str)) {
                    aggregatedResults.logProcessingErrors.push(err_str);
                }
            });
        }

        // Calculate final overall metrics based on the merged data
        this.finalizeAggregatedResult(aggregatedResults);
        logger.info(`Merging finished. Final status: ${aggregatedResults.status}.`);
        return aggregatedResults;
    }

    /**
     * Helper function to calculate final metrics for an aggregated result.
     * This includes overall timings, status, and error messages.
     */
    private finalizeAggregatedResult(results: ConferenceLogAnalysisResult): void {
        if (results.analyzedRequestIds.length === 0) {
            // Set a default status if not already set
            if (!results.status) {
                results.status = 'NoRequestsAnalyzed';
                results.errorMessage = "No requests were found matching the filter criteria.";
            }
            results.analysisTimestamp = new Date().toISOString();
            return;
        }

        let overallMinStartTimeMs: number | null = null;
        let overallMaxEndTimeMs: number | null = null;
        let totalAggregatedDurationSeconds = 0;
        let failedOrErrorCount = 0;
        let processingCount = 0;

        for (const reqId of results.analyzedRequestIds) {
            const reqDetails = results.requests[reqId];
            if (reqDetails) {
                if (reqDetails.startTime) {
                    const reqStartMs = new Date(reqDetails.startTime).getTime();
                    overallMinStartTimeMs = Math.min(reqStartMs, overallMinStartTimeMs ?? Infinity);
                }
                if (reqDetails.endTime) {
                    const reqEndMs = new Date(reqDetails.endTime).getTime();
                    overallMaxEndTimeMs = Math.max(reqEndMs, overallMaxEndTimeMs ?? -Infinity);
                }
                if (typeof reqDetails.durationSeconds === 'number') {
                    totalAggregatedDurationSeconds += reqDetails.durationSeconds;
                }
                if (reqDetails.status === 'Failed' || reqDetails.status === 'CompletedWithErrors') {
                    failedOrErrorCount++;
                }
                if (reqDetails.status === 'Processing') {
                    processingCount++;
                }
            }
        }

        // Set overall timing information
        if (overallMinStartTimeMs) results.overall.startTime = new Date(overallMinStartTimeMs).toISOString();
        if (overallMaxEndTimeMs) results.overall.endTime = new Date(overallMaxEndTimeMs).toISOString();
        results.overall.durationSeconds = totalAggregatedDurationSeconds;
        results.overall.processedConferencesCount = Object.keys(results.conferenceAnalysis).length;

        // Determine the final overall status
        if (processingCount > 0) {
            results.status = 'Processing';
            results.errorMessage = 'One or more matching requests are still processing.';
        } else if (failedOrErrorCount > 0) {
            results.status = 'CompletedWithErrors';
            results.errorMessage = `${failedOrErrorCount} request(s) completed with errors or failed.`;
        } else {
            results.status = 'Completed';
            results.errorMessage = undefined; // No error message if everything is completed successfully
        }

        results.logFilePath = undefined;
        results.analysisTimestamp = new Date().toISOString();
    }
}