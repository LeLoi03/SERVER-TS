// src/container.ts (or wherever you do your DI setup)
import 'reflect-metadata';
import { container } from 'tsyringe';

// Config and Core Services
import { ConfigService } from './config/config.service';
import { LoggingService } from './services/logging.service';
import { ApiKeyManager } from './services/apiKey.manager';
import { PlaywrightService } from './services/playwright.service';
import { FileSystemService } from './services/fileSystem.service';
import { TaskQueueService } from './services/taskQueue.service';

// --- Gemini API Service and its Sub-Services ---
import { GeminiApiService } from './services/geminiApi.service'; // The main refactored facade
import { GeminiClientManagerService } from './services/gemini/geminiClientManager.service';
import { GeminiCachePersistenceService } from './services/gemini/geminiCachePersistence.service';
import { GeminiContextCacheService } from './services/gemini/geminiContextCache.service';
import { GeminiRateLimiterService } from './services/gemini/geminiRateLimiter.service';
import { GeminiModelOrchestratorService } from './services/gemini/geminiModelOrchestrator.service';
import { GeminiResponseHandlerService } from './services/gemini/geminiResponseHandler.service';
// -------------------------------------------------

// --- Your Newly Refactored Batch Processing Sub-Services ---
import { PageContentExtractorService, IPageContentExtractorService } from './services/batchProcessingServiceChild/pageContentExtractor.service';
import { ConferenceLinkProcessorService, IConferenceLinkProcessorService } from './services/batchProcessingServiceChild/conferenceLinkProcessor.service';
import { ConferenceDeterminationService, IConferenceDeterminationService } from './services/batchProcessingServiceChild/conferenceDetermination.service';
import { ConferenceDataAggregatorService, IConferenceDataAggregatorService } from './services/batchProcessingServiceChild/conferenceDataAggregator.service';
// --- The Orchestrating BatchProcessingService ---
import { BatchProcessingService } from './services/batchProcessing.service';

// Other Application Services
import { HtmlPersistenceService } from './services/htmlPersistence.service';
import { ResultProcessingService } from './services/resultProcessing.service';
import { ConferenceProcessorService } from './services/conferenceProcessor.service';
import { CrawlOrchestratorService } from './services/crawlOrchestrator.service';
import { DatabasePersistenceService } from './services/databasePersistence.service';

// Register Core Services (assuming they are singletons)
container.registerSingleton(ConfigService);
container.registerSingleton(LoggingService);
container.registerSingleton(ApiKeyManager);
container.registerSingleton(PlaywrightService);
container.registerSingleton(FileSystemService);
container.registerSingleton(TaskQueueService);

// Register Gemini API Service and its Sub-Services (all are singletons via @singleton decorator)
// Explicit registration is good practice and provides clarity.
container.registerSingleton(GeminiClientManagerService);
container.registerSingleton(GeminiCachePersistenceService);
container.registerSingleton(GeminiContextCacheService);
container.registerSingleton(GeminiRateLimiterService);
container.registerSingleton(GeminiModelOrchestratorService);
container.registerSingleton(GeminiResponseHandlerService);
container.registerSingleton(GeminiApiService); // The main facade depends on the sub-services above

// Register New Batch Processing Sub-Services (usually as singletons if stateless or state is app-wide)
container.registerSingleton<IPageContentExtractorService>('IPageContentExtractorService', PageContentExtractorService);
container.registerSingleton<IConferenceLinkProcessorService>('IConferenceLinkProcessorService', ConferenceLinkProcessorService);
container.registerSingleton<IConferenceDeterminationService>('IConferenceDeterminationService', ConferenceDeterminationService);
container.registerSingleton<IConferenceDataAggregatorService>('IConferenceDataAggregatorService', ConferenceDataAggregatorService);

// Register the Orchestrating BatchProcessingService
container.registerSingleton(BatchProcessingService); // This will inject the sub-services above

// Register Other Application Services
container.registerSingleton(HtmlPersistenceService);
container.registerSingleton(ResultProcessingService);

// ConferenceProcessorService
// If ConferenceProcessorService is resolved dynamically per task as in your CrawlOrchestratorService
// using `container.resolve(ConferenceProcessorService)`, you just need to ensure it's @injectable()
// and its dependencies are registered. Explicit registration as transient is also fine.
container.register(ConferenceProcessorService, ConferenceProcessorService); // Registers for transient scope (new instance each time resolved)

container.registerSingleton(CrawlOrchestratorService);
container.registerSingleton(DatabasePersistenceService);


// Export the configured container if needed elsewhere, though usually not necessary
// as components will use @inject or container.resolve() directly.
export default container;