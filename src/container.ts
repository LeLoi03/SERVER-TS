// src/container.ts
import 'reflect-metadata';
import { container } from 'tsyringe';

// --- Core Application Services and Configurations ---
import { ConfigService } from './config/config.service';
import { LoggingService } from './services/logging.service';
import { ApiKeyManager } from './services/apiKey.manager';
import { PlaywrightService } from './services/playwright.service';
import { FileSystemService } from './services/fileSystem.service';
import { TaskQueueService } from './services/taskQueue.service';

// --- Gemini API Service and its Specialized Sub-Services ---
import { GeminiApiService } from './services/geminiApi.service';
import { GeminiClientManagerService } from './services/gemini/geminiClientManager.service';
import { GeminiCachePersistenceService } from './services/gemini/geminiCachePersistence.service';
import { GeminiContextCacheService } from './services/gemini/geminiContextCache.service';
import { GeminiRateLimiterService } from './services/gemini/geminiRateLimiter.service';
import { GeminiModelOrchestratorService } from './services/gemini/geminiModelOrchestrator.service';
import { GeminiResponseHandlerService } from './services/gemini/geminiResponseHandler.service';
import { GeminiApiOrchestratorService } from './services/gemini/geminiApiOrchestrator.service';
import { GeminiSdkExecutorService } from './services/gemini/geminiSdkExecutor.service';
import { GeminiRetryHandlerService } from './services/gemini/geminiRetryHandler.service';

// --- Batch Processing Feature Services ---
import { PageContentExtractorService, IPageContentExtractorService } from './services/batchProcessing/pageContentExtractor.service';
import { ConferenceLinkProcessorService, IConferenceLinkProcessorService } from './services/batchProcessing/conferenceLinkProcessor.service';
import { ConferenceDeterminationService, IConferenceDeterminationService } from './services/batchProcessing/conferenceDetermination.service';
import { ConferenceDataAggregatorService, IConferenceDataAggregatorService } from './services/batchProcessing/conferenceDataAggregator.service';
import { BatchProcessingOrchestratorService } from './services/batchProcessingOrchestrator.service';
import { IFinalExtractionApiService, FinalExtractionApiService } from './services/batchProcessing/finalExtractionApi.service';
import { IFinalRecordAppenderService, FinalRecordAppenderService } from './services/batchProcessing/finalRecordAppender.service';
import { IUpdateTaskExecutorService, UpdateTaskExecutorService } from './services/batchProcessing/updateTaskExecutor.service';
import { ISaveTaskExecutorService, SaveTaskExecutorService } from './services/batchProcessing/saveTaskExecutor.service';

// --- Request-Scoped Services ---
// <<< IMPORT MỚI >>>
import { RequestStateService } from './services/requestState.service';
import { InMemoryResultCollectorService } from './services/inMemoryResultCollector.service'; // <<< IMPORT MỚI

// --- Other General Application Services ---
import { HtmlPersistenceService } from './services/htmlPersistence.service';
import { ResultProcessingService } from './services/resultProcessing.service';
import { ConferenceProcessorService } from './services/conferenceProcessor.service';
import { CrawlOrchestratorService } from './services/crawlOrchestrator.service';
import { JournalImportService } from './services/journalImport.service';

/**
 * Configure the Tsyringe IoC container by registering all application services.
 */

// --- 1. Register Core Application Services (Singletons) ---
container.registerSingleton(ConfigService);
container.registerSingleton(LoggingService);
container.registerSingleton(ApiKeyManager);
container.registerSingleton(PlaywrightService);
container.registerSingleton(FileSystemService);
container.registerSingleton(TaskQueueService);
container.registerSingleton(BatchProcessingOrchestratorService);

// --- 2. Register Gemini API Service and its Dependencies (Singletons) ---
container.registerSingleton(GeminiClientManagerService);
container.registerSingleton(GeminiCachePersistenceService);
container.registerSingleton(GeminiContextCacheService);
container.registerSingleton(GeminiRateLimiterService);
container.registerSingleton(GeminiModelOrchestratorService);
container.registerSingleton(GeminiResponseHandlerService);
container.registerSingleton(GeminiApiOrchestratorService);
container.registerSingleton(GeminiRetryHandlerService);
container.registerSingleton(GeminiSdkExecutorService);
container.registerSingleton(GeminiApiService);

// --- 3. Register Batch Processing Sub-Services (Interfaces and Implementations) ---
container.registerSingleton<IPageContentExtractorService>('IPageContentExtractorService', PageContentExtractorService);
container.registerSingleton<IConferenceLinkProcessorService>('IConferenceLinkProcessorService', ConferenceLinkProcessorService);
container.registerSingleton<IConferenceDeterminationService>('IConferenceDeterminationService', ConferenceDeterminationService);
container.registerSingleton<IConferenceDataAggregatorService>('IConferenceDataAggregatorService', ConferenceDataAggregatorService);
// Các service thực thi task thường là transient (mặc định của .register) hoặc resolution-scoped
container.register<IFinalExtractionApiService>('IFinalExtractionApiService', { useClass: FinalExtractionApiService });
container.register<IFinalRecordAppenderService>('IFinalRecordAppenderService', { useClass: FinalRecordAppenderService });
container.register<IUpdateTaskExecutorService>('IUpdateTaskExecutorService', { useClass: UpdateTaskExecutorService });
container.register<ISaveTaskExecutorService>('ISaveTaskExecutorService', { useClass: SaveTaskExecutorService });

// --- 4. Register Request-Scoped Services ---
// These services have a lifecycle tied to a specific request or resolution.
// The @scoped decorator on the class handles the lifecycle, but explicit registration here is good practice.
// <<< ĐĂNG KÝ MỚI >>>
container.register(RequestStateService, RequestStateService);
container.registerSingleton(InMemoryResultCollectorService); // <<< ĐĂNG KÝ MỚI

// --- 5. Register Other General and Task-Specific Services ---
container.registerSingleton(HtmlPersistenceService);
container.registerSingleton(ResultProcessingService);
container.registerSingleton(JournalImportService);

// ConferenceProcessorService is registered as transient (new instance each time resolved)
// because it may hold state for a single conference processing task.
container.register(ConferenceProcessorService, ConferenceProcessorService);

// CrawlOrchestratorService is a singleton as it orchestrates the entire application flow.
container.registerSingleton(CrawlOrchestratorService);

/**
 * Exports the configured Tsyringe container instance.
 */
export default container;